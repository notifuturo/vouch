import { describe, it, expect } from "vitest";
import app from "../src/index.js";
import { landingPage } from "../src/landing.js";

const env = {
  DB: {} as unknown as D1Database,
  X402_NETWORK: "base-sepolia",
  X402_FACILITATOR_URL: "https://x402.org/facilitator",
  PRICE_CHECK_USDC: "0.001",
  PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
};

describe("landingPage", () => {
  it("renders HTML with the configured price and network", () => {
    const html = landingPage({ priceUsdc: "0.002", network: "base", baseUrl: "https://v.test" });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("0.002");
    expect(html).toContain("base");
    expect(html).toContain("https://v.test/.well-known/x402");
  });
});

describe("GET / content negotiation", () => {
  it("serves HTML to browsers", async () => {
    const res = await app.request("/", { headers: { accept: "text/html" } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    expect(await res.text()).toContain("<!doctype html>");
  });

  it("serves JSON to API clients", async () => {
    const res = await app.request("/", { headers: { accept: "application/json" } }, env);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    expect(await res.json()).toMatchObject({ name: "Vouch" });
  });
});
