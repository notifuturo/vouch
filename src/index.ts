import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { assess } from "./scoring/assess.js";
import { parseTarget } from "./scoring/target.js";
import { D1ReputationRepo } from "./db/repo.js";
import { createDenylist } from "./db/denylist.js";
import { createPaymentGate } from "./payments.js";
import { buildX402Descriptor, buildMcpToolManifest } from "./discovery.js";
import { reportLimiter, clientKey, type Limiter } from "./ratelimit.js";

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
}

const app = new Hono<{ Bindings: Env }>();

// --- x402 payment gate ---
// Built lazily (env is only available per-request) but INVOKED INLINE in the
// current request chain. We must not call app.use() mid-request: Hono freezes
// the matched handler chain before middleware runs, so a route added mid-flight
// would only gate *future* requests — leaving the first request per isolate
// unpaid. Invoking the gate directly closes that bypass.
let gate: MiddlewareHandler | null = null;
app.use("*", (c, next) => {
  gate ??= createPaymentGate({
    network: c.env.X402_NETWORK,
    facilitatorUrl: c.env.X402_FACILITATOR_URL,
    payTo: c.env.PAY_TO_ADDRESS,
    priceUsdc: c.env.PRICE_CHECK_USDC,
  });
  return gate(c, next);
});

// Shared per-isolate denylist (hydrated lazily, cached with TTL).
let denylist: ReturnType<typeof createDenylist> | null = null;

app.get("/", (c) =>
  c.json({
    name: "Vouch",
    description: "Per-call payment trust & reputation API for AI agents (x402-monetized).",
    endpoints: {
      "POST /v1/check": "Assess a counterparty. Paid via x402.",
      "POST /v1/report": "Report a host as flag|vouch. Free.",
      "GET /health": "Liveness.",
    },
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

// --- Discovery (free, ungated) ---
// Lets AI agents and the Agnic/Coinbase registries auto-discover the paid
// `/v1/check` capability and its x402 price without any out-of-band docs.
const discoveryConfig = (c: { env: Env; req: { url: string } }) => ({
  network: c.env.X402_NETWORK,
  priceUsdc: c.env.PRICE_CHECK_USDC,
  baseUrl: new URL(c.req.url).origin,
});

// x402 "bazaar"-style resource list.
app.get("/.well-known/x402", (c) => c.json(buildX402Descriptor(discoveryConfig(c))));

// MCP-style tool manifest (static descriptor, no MCP transport).
app.get("/mcp/tools", (c) => c.json(buildMcpToolManifest(discoveryConfig(c))));

// Input bounds (validated at the HTTP boundary; both endpoints are public).
const MAX_TARGET = 255;
const MAX_REASON = 500;
const MAX_REPORTER = 128;

// --- Paid: trust check ---
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
  if (result.host) {
    c.executionCtx.waitUntil(repo.recordCheck(result.host));
  }

  return c.json(result);
});

// --- Free: community report ---
app.post("/v1/report", async (c) => {
  // Throttle per client IP to blunt reputation-poisoning spam.
  const limiter = reportLimiter(c.env.REPORT_LIMITER);
  const { success } = await limiter.limit({ key: clientKey(c.req.header("cf-connecting-ip")) });
  if (!success) {
    return c.json({ error: "Rate limit exceeded. Slow down." }, 429);
  }

  type ReportBody = { target?: unknown; kind?: unknown; reason?: unknown; reporter?: unknown };
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
  // Bound free-text fields before they reach D1.
  const reason = typeof body.reason === "string" ? body.reason.slice(0, MAX_REASON) : undefined;
  const reporter =
    typeof body.reporter === "string" ? body.reporter.slice(0, MAX_REPORTER) : undefined;

  const repo = new D1ReputationRepo(c.env.DB);
  await repo.recordReport(host, body.kind, reason, reporter);
  return c.json({ ok: true, host, kind: body.kind });
});

export default app;
