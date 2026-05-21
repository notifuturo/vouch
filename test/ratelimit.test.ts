import { describe, it, expect } from "vitest";
import app from "../src/index.js";
import { reportLimiter, clientKey } from "../src/ratelimit.js";

describe("reportLimiter helper", () => {
  it("falls back to allow-all when no binding is bound", async () => {
    const { success } = await reportLimiter(undefined).limit({ key: "x" });
    expect(success).toBe(true);
  });
  it("derives a stable client key with anon fallback", () => {
    expect(clientKey("1.2.3.4")).toBe("1.2.3.4");
    expect(clientKey(undefined)).toBe("anon");
    expect(clientKey("")).toBe("anon");
  });
});

describe("POST /v1/report rate limiting", () => {
  const baseEnv = {
    DB: {} as unknown as D1Database,
    X402_NETWORK: "base-sepolia",
    X402_FACILITATOR_URL: "https://x402.org/facilitator",
    PRICE_CHECK_USDC: "0.001",
    PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
  };

  it("returns 429 when the limiter denies (before any DB access)", async () => {
    const env = { ...baseEnv, REPORT_LIMITER: { limit: async () => ({ success: false }) } };
    const res = await app.request(
      "/v1/report",
      {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9" },
        body: JSON.stringify({ target: "https://evil.example.com", kind: "flag" }),
      },
      env,
    );
    expect(res.status).toBe(429);
  });
});
