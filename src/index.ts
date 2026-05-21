import { Hono } from "hono";
import { assess } from "./scoring/assess.js";
import { parseTarget } from "./scoring/target.js";
import { D1ReputationRepo, type ReportKind } from "./db/repo.js";
import { createDenylist } from "./db/denylist.js";
import { createPaymentGate } from "./payments.js";

export interface Env {
  DB: D1Database;
  X402_NETWORK: string;
  X402_FACILITATOR_URL: string;
  PRICE_CHECK_USDC: string;
  PAY_TO_ADDRESS: string;
  /** Optional free threat-feed URL (newline-delimited hosts). */
  THREAT_FEED_URL?: string;
}

const app = new Hono<{ Bindings: Env }>();

// --- x402 payment gate (lazily built once per isolate) ---
let gateInstalled = false;
app.use("*", async (c, next) => {
  if (!gateInstalled) {
    const gate = createPaymentGate({
      network: c.env.X402_NETWORK,
      facilitatorUrl: c.env.X402_FACILITATOR_URL,
      payTo: c.env.PAY_TO_ADDRESS,
      priceUsdc: c.env.PRICE_CHECK_USDC,
    });
    app.use("*", gate);
    gateInstalled = true;
  }
  await next();
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

// --- Paid: trust check ---
app.post("/v1/check", async (c) => {
  const body = await c.req
    .json<{ target?: string }>()
    .catch((): { target?: string } => ({}));
  const target = body.target?.trim();
  if (!target) {
    return c.json({ error: "Missing 'target' in request body." }, 400);
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
  type ReportBody = { target?: string; kind?: ReportKind; reason?: string; reporter?: string };
  const body = await c.req.json<ReportBody>().catch((): ReportBody => ({}));
  const { host } = parseTarget(body.target ?? "");
  if (!host) {
    return c.json({ error: "Missing or invalid 'target'." }, 400);
  }
  if (body.kind !== "flag" && body.kind !== "vouch") {
    return c.json({ error: "'kind' must be 'flag' or 'vouch'." }, 400);
  }

  const repo = new D1ReputationRepo(c.env.DB);
  await repo.recordReport(host, body.kind, body.reason, body.reporter);
  return c.json({ ok: true, host, kind: body.kind });
});

export default app;
