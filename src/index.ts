import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { assess } from "./scoring/assess.js";
import { parseTarget } from "./scoring/target.js";
import { D1ReputationRepo } from "./db/repo.js";
import { D1SettlementStore, paymentIdFromHeaders } from "./db/settlements.js";
import { createDenylist } from "./db/denylist.js";
import { createPaymentGate } from "./payments.js";
import { buildX402Descriptor, buildMcpToolManifest } from "./discovery.js";
import { resolveLimiter, clientKey, sourceKey, type Limiter } from "./ratelimit.js";
import { landingPage } from "./landing.js";
import { handleMcpBody, rpcError } from "./mcp.js";
import { signAttestation, attestationPublicJwk } from "./attest.js";

export interface Env {
  DB: D1Database;
  X402_NETWORK: string;
  X402_FACILITATOR_URL: string;
  PRICE_CHECK_USDC: string;
  PAY_TO_ADDRESS: string;
  /** Optional free threat-feed URL (newline-delimited hosts). */
  THREAT_FEED_URL?: string;
  /** Cloudflare Rate Limiting binding for /v1/report (optional locally). */
  REPORT_LIMITER?: Limiter;
  /** Cloudflare Rate Limiting binding for the free /v1/score tier (optional locally). */
  SCORE_LIMITER?: Limiter;
  /** Agnic merchant id (from app.agnic.ai/monetize). Optional until registered. */
  AGNIC_MERCHANT_ID?: string;
  /** Agnic USDC payout wallet address. Optional until registered. */
  AGNIC_MERCHANT_WALLET?: string;
  /** Agnic merchant margin/fee percent. Optional until registered. */
  AGNIC_FEE_PERCENT?: string;
  /** Coinbase CDP API key id — when set (with secret), settle via CDP facilitator. */
  CDP_API_KEY_ID?: string;
  /** Coinbase CDP API key secret (Worker secret). */
  CDP_API_KEY_SECRET?: string;
  /** Ed25519 signing seed (base64, 32 bytes) for paid attestations. Optional. */
  VOUCH_SIGNING_KEY?: string;
}

const app = new Hono<{ Bindings: Env }>();

// --- CORS + Agnic merchant headers (runs BEFORE the gate, wraps everything) ---
// Manual headers, NOT hono/cors: hono/cors wrapping the x402-gated POST hangs
// the request. This runs first (outermost) so it sets response headers on the
// way out even when the gate short-circuits with a 402 — otherwise the 402
// would lack Access-Control-Allow-Origin and browser agents couldn't read it.
// OPTIONS preflight is answered here directly (204). Agnic merchant headers are
// emitted only when their env vars are set.
const CORS_EXPOSE = "PAYMENT-REQUIRED, X-PAYMENT-RESPONSE, PAYMENT-RESPONSE, WWW-Authenticate";
// Allow both the x402 v1 (X-PAYMENT/PAYMENT) and v2 (Payment-Signature /
// X-Payment-Signature / X-Payment-Response) request headers, so a browser v2
// client clears preflight and can send the signature/response headers on its
// 402 retry. The @x402 middleware reads `payment-signature` and `x-payment`.
const CORS_ALLOW_HEADERS =
  "Content-Type, Authorization, X-PAYMENT, PAYMENT, Payment-Signature, X-Payment-Signature, X-Payment-Response";
app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
      "Access-Control-Max-Age": "86400",
    });
  }
  await next();
  // ACAO:* is intentional — this is a fully PUBLIC, credential-free API (no
  // cookies/sessions), so there's no cross-origin data to protect. If any
  // credentialed/cookie flow is ever added, this MUST become a specific origin.
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Expose-Headers", CORS_EXPOSE);
  // Baseline security headers (the `/` landing page is browser-facing).
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  // Payment challenges/verdicts must never be cached (replay/spend-map safety).
  if (c.req.path.startsWith("/v1/")) c.header("Cache-Control", "no-store");
  const merchant: Record<string, string | undefined> = {
    "X-Merchant-Id": c.env.AGNIC_MERCHANT_ID,
    "X-Merchant-Wallet": c.env.AGNIC_MERCHANT_WALLET,
    "X-Merchant-Fee-Percent": c.env.AGNIC_FEE_PERCENT,
  };
  for (const [name, value] of Object.entries(merchant)) {
    if (value) c.header(name, value);
  }
  return;
});

// --- x402 payment gate ---
// Built lazily (env is only available per-request) but INVOKED INLINE in the
// current request chain. We must not call app.use() mid-request: Hono freezes
// the matched handler chain before middleware runs, so a route added mid-flight
// would only gate *future* requests — leaving the first request per isolate
// unpaid. Invoking the gate directly closes that bypass.
let gate: MiddlewareHandler | null = null;
app.use("*", async (c, next) => {
  // Only the EXACT canonical route is payable. Reject look-alikes
  // (/v1/CHECK, /v1/check/, //v1/check) here, BEFORE the gate, so they can't
  // mint a payable 402 that then 404s post-payment (facilitator-quota griefing
  // + resource.url drift). The x402 matcher is case/slash-insensitive; Hono's
  // handler is not, hence the mismatch we're closing.
  const path = c.req.path;
  const canon = path.replace(/\/+/g, "/").replace(/\/+$/, "").toLowerCase();
  if (canon.endsWith("/v1/check") && path !== "/v1/check") {
    return c.json({ error: "Not found. The payable resource is exactly /v1/check." }, 404);
  }
  gate ??= createPaymentGate({
    network: c.env.X402_NETWORK,
    facilitatorUrl: c.env.X402_FACILITATOR_URL,
    payTo: c.env.PAY_TO_ADDRESS,
    priceUsdc: c.env.PRICE_CHECK_USDC,
    cdpApiKeyId: c.env.CDP_API_KEY_ID,
    cdpApiKeySecret: c.env.CDP_API_KEY_SECRET,
    supportedDb: c.env.DB,
  });
  return gate(c, next);
});

// Shared per-isolate denylist (hydrated lazily, cached with TTL).
let denylist: ReturnType<typeof createDenylist> | null = null;

app.get("/", (c) => {
  // Browsers get the landing page; API clients get JSON.
  if ((c.req.header("accept") ?? "").includes("text/html")) {
    return c.html(
      landingPage({
        priceUsdc: c.env.PRICE_CHECK_USDC,
        network: c.env.X402_NETWORK,
        baseUrl: new URL(c.req.url).origin,
      }),
    );
  }
  return c.json({
    name: "Vouch",
    description: "Per-call payment trust & reputation API for AI agents (x402-monetized).",
    endpoints: {
      "POST /v1/check": "Full verdict (score + risk + reasons) + signed attestation. Paid via x402.",
      "POST /v1/score": "Score + risk only. Free (rate-limited).",
      "GET /v1/attestation/pubkey": "Ed25519 public key to verify attestations. Free.",
      "POST /v1/report": "Report a host as flag|vouch. Free.",
      "GET /v1/stats": "Aggregate reputation totals. Free.",
      "GET /health": "Liveness.",
    },
  });
}
);

app.get("/health", (c) => c.json({ ok: true }));

// --- Discovery (free, ungated) ---
// Lets AI agents and the Agnic/Coinbase registries auto-discover the paid
// `/v1/check` capability and its x402 price without any out-of-band docs.
const discoveryConfig = (c: { env: Env; req: { url: string } }) => ({
  network: c.env.X402_NETWORK,
  priceUsdc: c.env.PRICE_CHECK_USDC,
  baseUrl: new URL(c.req.url).origin,
  payTo: c.env.PAY_TO_ADDRESS,
});

// x402 "bazaar"-style resource list.
app.get("/.well-known/x402", (c) => c.json(buildX402Descriptor(discoveryConfig(c))));

// MCP-style tool manifest (static descriptor; human/registry-readable).
app.get("/mcp/tools", (c) => c.json(buildMcpToolManifest(discoveryConfig(c))));

// Real MCP server over Streamable HTTP (JSON-RPC 2.0). Free tools only
// (vouch_score, vouch_report) — paid reasons stay on x402 /v1/check.
app.post("/mcp", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (body === null) return c.json(rpcError(null, -32700, "Parse error"), 400);
  denylist ??= createDenylist(c.env.THREAT_FEED_URL);
  const ip = c.req.header("cf-connecting-ip");
  const res = await handleMcpBody(body, {
    db: c.env.DB,
    isDenied: denylist,
    waitUntil: (p) => c.executionCtx.waitUntil(p),
    scoreLimitOk: async () =>
      (await resolveLimiter(c.env.SCORE_LIMITER).limit({ key: clientKey(ip) })).success,
    reportLimitOk: async () =>
      (await resolveLimiter(c.env.REPORT_LIMITER, { failClosed: true }).limit({ key: clientKey(ip) })).success,
    source: sourceKey(ip),
  });
  return res === null ? c.body(null, 202) : c.json(res);
});
// This transport is POST-only (stateless); no server->client SSE stream.
app.get("/mcp", (c) => c.body(null, 405, { Allow: "POST" }));

// Aggregate reputation stats (free) — surfaces the compounding dataset.
app.get("/v1/stats", async (c) => {
  const stats = await new D1ReputationRepo(c.env.DB).stats();
  return c.json(stats);
});

// Input bounds (validated at the HTTP boundary; both endpoints are public).
const MAX_TARGET = 255;
const MAX_REASON = 500;

// --- Paid: trust check ---
// GET is POST-only here; return 405 (not 404) so generic buyer probes learn the method.
app.get("/v1/check", (c) =>
  c.json({ error: "Method Not Allowed — POST /v1/check (paid via x402)." }, 405, { Allow: "POST" }),
);
app.post("/v1/check", async (c) => {
  const body = await c.req
    .json<{ target?: unknown }>()
    .catch((): { target?: unknown } => ({}));
  if (typeof body.target !== "string") {
    return c.json({ error: "'target' must be a string." }, 400);
  }
  const target = body.target.trim();
  if (!target || target.length > MAX_TARGET) {
    return c.json({ error: `'target' must be 1-${MAX_TARGET} characters.` }, 400);
  }
  // Fail closed on unparseable input: a paid endpoint must not emit an
  // authoritative-looking score for garbage it could not resolve to a host.
  if (!parseTarget(target).host) {
    return c.json({ error: "'target' did not resolve to a valid host." }, 400);
  }

  denylist ??= createDenylist(c.env.THREAT_FEED_URL);
  const repo = new D1ReputationRepo(c.env.DB);

  const result = await assess(target, {
    isDenied: denylist,
    getReputation: (host) => repo.get(host),
  });

  // Record the check asynchronously (compounds the dataset, never blocks).
  // Settlement idempotency: this handler only runs after a payment settled, so
  // tie the check counter to the settling payment's id and record EXACTLY ONCE
  // — a replayed proof must not double-count. The id derivation + ledger write
  // both run in the background so the paid response stays fast.
  if (result.host) {
    const host = result.host;
    c.executionCtx.waitUntil(
      (async () => {
        const pid = await paymentIdFromHeaders((n) => c.req.header(n));
        if (pid === null) {
          // No payment header (e.g. local/ungated invocation): record directly.
          await repo.recordCheck(host);
          return;
        }
        const fresh = await new D1SettlementStore(c.env.DB).markIfNew(pid, host);
        if (fresh) await repo.recordCheck(host);
      })(),
    );
  }

  // Paid-tier differentiator: a signed, verifiable attestation the agent can
  // keep as proof of due diligence (free /v1/score never includes this).
  if (c.env.VOUCH_SIGNING_KEY && result.host) {
    const attestation = signAttestation(c.env.VOUCH_SIGNING_KEY, {
      subject: result.host,
      score: result.score,
      risk: result.risk,
      target: result.target,
    });
    return c.json({ ...result, attestation });
  }
  return c.json(result);
});

// Public key to verify /v1/check attestations (free, ungated).
app.get("/v1/attestation/pubkey", (c) => {
  if (!c.env.VOUCH_SIGNING_KEY) {
    return c.json({ error: "Attestations not configured." }, 503);
  }
  return c.json({
    alg: "EdDSA",
    keys: [attestationPublicJwk(c.env.VOUCH_SIGNING_KEY)],
    note: "Verify the EdDSA JWT in /v1/check's `attestation` field against this Ed25519 public key.",
  });
});

// --- Free tier: score only (no reasons) ---
// Top-of-funnel wedge: returns just the number + band, like competitors' free
// basic tier. The explainable `reasons` + `signals` stay paid (/v1/check) —
// you pay for the *why*. Every free check still records and feeds the moat.
app.post("/v1/score", async (c) => {
  const limiter = resolveLimiter(c.env.SCORE_LIMITER);
  const { success } = await limiter.limit({ key: clientKey(c.req.header("cf-connecting-ip")) });
  if (!success) {
    return c.json({ error: "Rate limit exceeded on the free tier. Use POST /v1/check (paid) for higher volume." }, 429);
  }

  const body = await c.req.json<{ target?: unknown }>().catch((): { target?: unknown } => ({}));
  if (typeof body.target !== "string") {
    return c.json({ error: "'target' must be a string." }, 400);
  }
  const target = body.target.trim();
  if (!target || target.length > MAX_TARGET || !parseTarget(target).host) {
    return c.json({ error: `'target' must be a valid host (1-${MAX_TARGET} chars).` }, 400);
  }

  denylist ??= createDenylist(c.env.THREAT_FEED_URL);
  const repo = new D1ReputationRepo(c.env.DB);
  const result = await assess(target, {
    isDenied: denylist,
    getReputation: (host) => repo.get(host),
  });
  if (result.host) {
    c.executionCtx.waitUntil(repo.recordCheck(result.host));
  }
  // Free tier returns score + risk only; reasons/signals are the paid upgrade.
  return c.json({ target: result.target, host: result.host, score: result.score, risk: result.risk });
});

// --- Free: community report ---
app.post("/v1/report", async (c) => {
  // Throttle per client IP to blunt reputation-poisoning spam. Fail CLOSED:
  // this is an abuse-controlled write path, so a missing limiter binding in
  // production must deny rather than silently disable throttling.
  const ip = c.req.header("cf-connecting-ip");
  const limiter = resolveLimiter(c.env.REPORT_LIMITER, { failClosed: true });
  const { success } = await limiter.limit({ key: clientKey(ip) });
  if (!success) {
    return c.json({ error: "Rate limit exceeded. Slow down." }, 429);
  }

  type ReportBody = { target?: unknown; kind?: unknown; reason?: unknown };
  const body = await c.req.json<ReportBody>().catch((): ReportBody => ({}));

  const targetStr = typeof body.target === "string" ? body.target : "";
  if (targetStr.length > MAX_TARGET) {
    return c.json({ error: `'target' must be at most ${MAX_TARGET} characters.` }, 400);
  }
  const { host } = parseTarget(targetStr);
  if (!host) {
    return c.json({ error: "Missing or invalid 'target'." }, 400);
  }
  if (body.kind !== "flag" && body.kind !== "vouch") {
    return c.json({ error: "'kind' must be 'flag' or 'vouch'." }, 400);
  }
  // Bound the free-text reason before it reaches D1. The reputation counter is
  // de-duplicated per source so one reporter can't inflate a host's score.
  const reason = typeof body.reason === "string" ? body.reason.slice(0, MAX_REASON) : undefined;

  const repo = new D1ReputationRepo(c.env.DB);
  await repo.recordReport(host, body.kind, { reason, source: sourceKey(ip) });
  return c.json({ ok: true, host, kind: body.kind });
});

export default app;
