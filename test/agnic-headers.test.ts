import { describe, it, expect } from "vitest";
import app from "../src/index.js";

// /health is free (ungated), so no x402 payment is needed to reach a 200.
const baseEnv = {
  DB: {} as unknown as D1Database,
  X402_NETWORK: "base-sepolia",
  X402_FACILITATOR_URL: "https://x402.org/facilitator",
  PRICE_CHECK_USDC: "0.001",
  PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
};

describe("Agnic merchant headers", () => {
  it("emits all three X-Merchant-* headers when the env vars are set", async () => {
    const env = {
      ...baseEnv,
      AGNIC_MERCHANT_ID: "merchant_abc123",
      AGNIC_MERCHANT_WALLET: "0x84877c232FB62CBf2028A97828507428cf82dC1a",
      AGNIC_FEE_PERCENT: "2.5",
    };
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Merchant-Id")).toBe("merchant_abc123");
    expect(res.headers.get("X-Merchant-Wallet")).toBe(
      "0x84877c232FB62CBf2028A97828507428cf82dC1a",
    );
    expect(res.headers.get("X-Merchant-Fee-Percent")).toBe("2.5");
  });

  it("omits the headers entirely when the env vars are not set", async () => {
    const res = await app.request("/health", {}, baseEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Merchant-Id")).toBeNull();
    expect(res.headers.get("X-Merchant-Wallet")).toBeNull();
    expect(res.headers.get("X-Merchant-Fee-Percent")).toBeNull();
  });
});
