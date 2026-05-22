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
const GET_SUPPORTED_TIMEOUT_MS = 12_000;

/** Reject after `ms` so a slow CDP /supported call can't hang a cold isolate. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("getSupported timed out")), ms),
    ),
  ]);
}

/**
 * Wrap a facilitator client's getSupported() with a D1 cache so a COLD isolate
 * reads the (real, previously-fetched) supported-kinds from D1 instead of
 * blocking on a slow CDP /supported round-trip — the cold-start timeout we saw.
 * verify/settle are untouched, and we only ever cache the REAL response (no
 * fabricated payment terms). On a cache miss the live call is bounded by a
 * timeout and we fall back to a stale row if one exists.
 */
function cacheGetSupported<T extends { getSupported: () => Promise<unknown> }>(
  client: T,
  db: D1Database,
): T {
  const real = client.getSupported.bind(client);
  let tableReady: Promise<unknown> | null = null;
  const ensureTable = () =>
    (tableReady ??= db.exec(
      "CREATE TABLE IF NOT EXISTS facilitator_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    ));

  client.getSupported = (async () => {
    try {
      await ensureTable();
      const row = await db
        .prepare("SELECT value, updated_at FROM facilitator_cache WHERE key = ?")
        .bind(SUPPORTED_CACHE_KEY)
        .first<{ value: string; updated_at: number }>();

      if (row && Date.now() - row.updated_at < SUPPORTED_TTL_MS) {
        return JSON.parse(row.value);
      }

      // Miss or stale: fetch fresh (bounded), persist, and return.
      try {
        const fresh = await withTimeout(real(), GET_SUPPORTED_TIMEOUT_MS);
        await db
          .prepare(
            "INSERT INTO facilitator_cache (key, value, updated_at) VALUES (?, ?, ?) " +
              "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
          )
          .bind(SUPPORTED_CACHE_KEY, JSON.stringify(fresh), Date.now())
          .run();
        return fresh;
      } catch (err) {
        // CDP slow/unreachable: serve a stale cached value if we have one.
        if (row) return JSON.parse(row.value);
        throw err;
      }
    } catch {
      // D1 itself failed — fall back to the live call (best effort).
      return real();
    }
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
  // Cache getSupported on the concrete client BEFORE withBazaar wraps it, so the
  // override reliably sticks (and any bazaar layer delegates through it).
  if (cfg.supportedDb) cacheGetSupported(baseClient, cfg.supportedDb);
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
