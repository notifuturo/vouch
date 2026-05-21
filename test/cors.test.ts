import { describe, it, expect } from "vitest";
import app from "../src/index.js";

const env = {
  DB: {} as unknown as D1Database,
  X402_NETWORK: "base-sepolia",
  X402_FACILITATOR_URL: "https://x402.org/facilitator",
  PRICE_CHECK_USDC: "0.001",
  PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
};

describe("CORS", () => {
  it("answers OPTIONS /v1/check preflight (not 404) with CORS headers", async () => {
    const res = await app.request(
      "/v1/check",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://agent.example.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,x-payment",
        },
      },
      env,
    );
    expect(res.status).toBeLessThan(300); // 204/200, never 404
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("adds Access-Control-Allow-Origin to normal responses", async () => {
    const res = await app.request("/health", { headers: { Origin: "https://agent.example.com" } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
