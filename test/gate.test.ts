import { describe, it, expect } from "vitest";
import app from "../src/index.js";

// Minimal env; the 402 challenge is generated before any handler/DB access.
const env = {
  DB: {} as unknown as D1Database,
  X402_NETWORK: "base-sepolia",
  X402_FACILITATOR_URL: "https://x402.org/facilitator",
  PRICE_CHECK_USDC: "0.001",
  PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
};

describe("payment gate", () => {
  it("returns 402 on the FIRST unpaid POST /v1/check (no first-request bypass)", async () => {
    const res = await app.request(
      "/v1/check",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "https://stripe.com" }),
      },
      env,
    );
    expect(res.status).toBe(402);
  });

  it("leaves the free discovery route ungated", async () => {
    const res = await app.request("/.well-known/x402", {}, env);
    expect(res.status).toBe(200);
  });
});
