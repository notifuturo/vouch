import { describe, it, expect, vi, afterEach } from "vitest";
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
  afterEach(() => vi.restoreAllMocks());

  it("emits 402 with NO facilitator/DB dependency (cold-isolate hang regression)", async () => {
    // Simulate the cold-start failure mode that used to hang ~20s: the facilitator
    // /supported fetch never resolves AND D1 is unusable. The static in-memory seed
    // must still let us build the 402 — synchronously, off the request path.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => new Promise(() => {})); // never resolves
    const hostileDb = {
      exec: () => Promise.reject(new Error("D1 down")),
      prepare: () => {
        throw new Error("D1 down");
      },
    } as unknown as D1Database;

    const res = await Promise.race([
      app.request(
        "/v1/check",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target: "https://stripe.com" }),
        },
        { ...env, DB: hostileDb },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("gate hung on cold start")), 2000),
      ),
    ]);

    expect(res.status).toBe(402);
    expect(fetchSpy).not.toHaveBeenCalled(); // never on the request path
  });

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
