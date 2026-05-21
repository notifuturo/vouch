import { describe, it, expect } from "vitest";
import app from "../src/index.js";

// Workers always provide an ExecutionContext; the test harness does not, so stub
// it (the handler uses ctx.waitUntil to record the check asynchronously).
const execCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;

const baseEnv = {
  DB: {
    // /v1/score reads reputation (get -> null) and records a check (no-op stub).
    prepare: () => ({
      bind: () => ({ first: async () => null, run: async () => ({}) }),
      first: async () => null,
      run: async () => ({}),
    }),
    batch: async () => [],
  } as unknown as D1Database,
  X402_NETWORK: "base-sepolia",
  X402_FACILITATOR_URL: "https://x402.org/facilitator",
  PRICE_CHECK_USDC: "0.001",
  PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
  // No THREAT_FEED_URL -> denylist is empty (deny-nothing), no network in tests.
};

describe("POST /v1/score (free tier)", () => {
  it("returns score + risk but NOT reasons/signals", async () => {
    const res = await app.request(
      "/v1/score",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "https://stripe.com" }),
      },
      baseEnv,
      execCtx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.score).toBe("number");
    expect(typeof body.risk).toBe("string");
    expect(body.host).toBe("stripe.com");
    expect(body).not.toHaveProperty("reasons");
    expect(body).not.toHaveProperty("signals");
  });

  it("rejects invalid target with 400", async () => {
    const res = await app.request(
      "/v1/score",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: "::::" }) },
      baseEnv,
      execCtx,
    );
    expect(res.status).toBe(400);
  });

  it("returns 429 when the free-tier limiter denies", async () => {
    const env = { ...baseEnv, SCORE_LIMITER: { limit: async () => ({ success: false }) } };
    const res = await app.request(
      "/v1/score",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: "https://stripe.com" }) },
      env,
      execCtx,
    );
    expect(res.status).toBe(429);
  });
});
