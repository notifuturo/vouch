import { describe, it, expect } from "vitest";
import app from "../src/index.js";

const env = {
  DB: {} as unknown as D1Database,
  X402_NETWORK: "base",
  X402_FACILITATOR_URL: "https://x402.org/facilitator",
  PRICE_CHECK_USDC: "0.01",
  PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
};
const execCtx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

describe("/v1/check method + cache headers (PR #414 polish)", () => {
  it("GET /v1/check returns 405 (not 404) with Allow: POST", async () => {
    const res = await app.request("/v1/check", { method: "GET" }, env, execCtx);
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("payment endpoints set Cache-Control: no-store", async () => {
    const res = await app.request("/v1/check", { method: "GET" }, env, execCtx);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
