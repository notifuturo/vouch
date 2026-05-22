import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { withBazaar, declareDiscoveryExtension } from "@x402/extensions";
import { createCdpFacilitatorConfig } from "./cdpAuth.js";
import {
  CHECK_INPUT_SCHEMA,
  CHECK_OUTPUT_SCHEMA,
  CHECK_OUTPUT_EXAMPLE,
  CHECK_DESCRIPTION,
} from "./discovery.js";
import type { MiddlewareHandler } from "hono";

const BASE_MAINNET = "eip155:8453";

/** Map a human network name to its CAIP-2 chain id. */
const NETWORKS: Record<string, `${string}:${string}`> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

export interface PaymentConfig {
  network: string;
  facilitatorUrl: string;
  payTo: string;
  /** USDC price as a decimal string, e.g. "0.001". */
  priceUsdc: string;
  /** Coinbase CDP API key id — when set (with secret), settle via the CDP facilitator. */
  cdpApiKeyId?: string | undefined;
  /** Coinbase CDP API key secret. */
  cdpApiKeySecret?: string | undefined;
  /** D1 database used to cache the facilitator's supported-kinds across cold isolates. */
  supportedDb?: D1Database | undefined;
}

const SUPPORTED_CACHE_KEY = "facilitator-supported";
const SUPPORTED_TTL_MS = 3600_000; // 1h
const REAL_TIMEOUT_MS = 8_000; // bound the background CDP /supported fetch
const D1_TIMEOUT_MS = 3_000; // bound the background D1 read
const REFRESH_BACKOFF_MS = 30_000; // re-arm a failed refresh after this

/**
 * Known-good supported-kinds for the networks Vouch advertises (Base + Base
 * Sepolia, x402 v1 + v2). This is the EXACT shape the facilitator's /supported
 * returns for our scheme/networks — verified against the live CDP response —
 * trimmed to what we actually register. It seeds an instant, network-free answer
 * so a COLD isolate can build the 402 challenge without ever blocking on the
 * facilitator round-trip. The full live response is fetched in the background
 * (below) and replaces this for any later reads. verify/settle are untouched —
 * this only affects how the 402 challenge is assembled.
 */
const STATIC_SUPPORTED = {
  kinds: [
    { x402Version: 1, scheme: "exact", network: "base-sepolia" },
    { x402Version: 1, scheme: "exact", network: "base" },
    { x402Version: 2, scheme: "exact", network: "eip155:84532" },
    { x402Version: 2, scheme: "exact", network: "eip155:8453" },
  ],
};

// Per-isolate in-memory cache. Seeded with the static value so getSupported()
// NEVER awaits I/O on the request path — the cold-start hang is structurally
// impossible. `memFreshUntil === 0` means we're still on the static seed and
// should attempt a background refresh on the next call.
let memSupported: unknown = STATIC_SUPPORTED;
let memFreshUntil = 0;
let refreshing: Promise<void> | null = null;

/** Reject after `ms` so a slow upstream call can't hang the (background) refresh. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Refresh the in-memory supported-kinds in the BACKGROUND (never awaited on the
 * request path). Prefers the D1-cached real response (shared across isolates),
 * else fetches live and persists it. Every external call is bounded; on failure
 * we keep whatever we already have (static seed or last-good) and back off. A
 * dangling timed-out fetch here is harmless — it blocks no response.
 */
function refreshSupported(
  real: () => Promise<unknown>,
  db: D1Database | undefined,
): Promise<void> {
  return (refreshing ??= (async () => {
    try {
      if (db) {
        await db
          .exec(
            "CREATE TABLE IF NOT EXISTS facilitator_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
          )
          .catch(() => undefined);
        const row = await withTimeout(
          db
            .prepare("SELECT value, updated_at FROM facilitator_cache WHERE key = ?")
            .bind(SUPPORTED_CACHE_KEY)
            .first<{ value: string; updated_at: number }>(),
          D1_TIMEOUT_MS,
        );
        if (row && Date.now() - row.updated_at < SUPPORTED_TTL_MS) {
          memSupported = JSON.parse(row.value);
          memFreshUntil = Date.now() + SUPPORTED_TTL_MS;
          return;
        }
      }
      // Cache miss/stale: fetch the live, real response (bounded) and persist it.
      const fresh = await withTimeout(real(), REAL_TIMEOUT_MS);
      memSupported = fresh;
      memFreshUntil = Date.now() + SUPPORTED_TTL_MS;
      if (db) {
        await db
          .prepare(
            "INSERT INTO facilitator_cache (key, value, updated_at) VALUES (?, ?, ?) " +
              "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
          )
          .bind(SUPPORTED_CACHE_KEY, JSON.stringify(fresh), Date.now())
          .run()
          .catch(() => undefined);
      }
    } catch {
      // Keep the static/last-good value; re-arm a refresh after a short backoff.
      memFreshUntil = Date.now() + REFRESH_BACKOFF_MS;
    } finally {
      refreshing = null;
    }
  })());
}

/**
 * Wrap a facilitator client's getSupported() so it answers SYNCHRONOUSLY from an
 * in-memory cache (seeded with a verified static value) and only ever refreshes
 * via D1 / the live facilitator in the background. This removes the facilitator
 * /supported round-trip from the cold-isolate 402 path entirely — the source of
 * the ~20s cold-start hang. We only ever serve the REAL response (or the static
 * seed that mirrors it); no fabricated payment terms. verify/settle untouched.
 */
function cacheGetSupported<T extends { getSupported: () => Promise<unknown> }>(
  client: T,
  db: D1Database | undefined,
): T {
  const real = client.getSupported.bind(client);
  client.getSupported = (async () => {
    if (Date.now() >= memFreshUntil) void refreshSupported(real, db);
    return memSupported;
  }) as T["getSupported"];
  return client;
}

/**
 * Build the x402 payment middleware that gates `POST /v1/check`. Routes not
 * listed here pass through free (health, reporting, info).
 *
 * Facilitator selection: if CDP API credentials are present, settle through the
 * reliable Coinbase CDP facilitator (`createFacilitatorConfig` builds its
 * CDP-JWT auth headers). Otherwise fall back to the configured public
 * facilitator URL (the testnet reference facilitator).
 */
export function createPaymentGate(cfg: PaymentConfig): MiddlewareHandler {
  const caip2 = NETWORKS[cfg.network];
  if (!caip2) {
    throw new Error(`Unsupported X402_NETWORK "${cfg.network}" (use base-sepolia or base)`);
  }

  const facilitatorConfig =
    cfg.cdpApiKeyId && cfg.cdpApiKeySecret
      ? createCdpFacilitatorConfig(cfg.cdpApiKeyId, cfg.cdpApiKeySecret)
      : { url: cfg.facilitatorUrl };

  // Bazaar discovery is enabled ONLY on mainnet: the wrapper sits on the
  // facilitator's verify/settle/getSupported path, so we keep the testnet gate's
  // code path untouched. On mainnet, withBazaar + the route discovery extension
  // make Vouch auto-index into the x402 Bazaar (-> Agentic.Market + AWS Bedrock)
  // the first time a payment settles.
  const onMainnet = caip2 === BASE_MAINNET;

  const baseClient = new HTTPFacilitatorClient(facilitatorConfig);
  // Always wrap getSupported with the in-memory/static cache BEFORE withBazaar
  // wraps the client, so the override reliably sticks. This keeps the facilitator
  // /supported round-trip off the request path even when D1 is unavailable (the
  // static seed alone is enough to emit our 402); D1 just shares the real
  // response across cold isolates when present.
  cacheGetSupported(baseClient, cfg.supportedDb);
  const facilitator = onMainnet ? withBazaar(baseClient) : baseClient;
  const server = new x402ResourceServer(facilitator).register(caip2, new ExactEvmScheme());

  const route: Record<string, unknown> = {
    accepts: [
      {
        scheme: "exact",
        price: `$${cfg.priceUsdc}`,
        network: caip2,
        payTo: cfg.payTo,
      },
    ],
    description: CHECK_DESCRIPTION,
    mimeType: "application/json",
  };
  if (onMainnet) {
    route.extensions = declareDiscoveryExtension({
      bodyType: "json",
      inputSchema: CHECK_INPUT_SCHEMA as unknown as Record<string, unknown>,
      output: {
        schema: CHECK_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        example: CHECK_OUTPUT_EXAMPLE,
      },
    });
  }

  return paymentMiddleware({ "POST /v1/check": route } as never, server);
}
