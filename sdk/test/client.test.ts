import { describe, it, expect } from "vitest";
import { VouchClient, assertTrusted, VouchBlockedError } from "../src/index.js";

/** Build a fake fetch that returns a fixed JSON body for asserted paths. */
function stubFetch(status: number, body: unknown, seen?: { url?: string; init?: RequestInit }) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (seen) {
      seen.url = String(url);
      seen.init = init;
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("VouchClient", () => {
  it("score() POSTs the target to /v1/score and returns the body", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const client = new VouchClient({
      baseUrl: "https://v.test/",
      fetch: stubFetch(200, { target: "https://x.com", host: "x.com", score: 91, risk: "low" }, seen),
    });
    const r = await client.score("https://x.com");
    expect(seen.url).toBe("https://v.test/v1/score"); // trailing slash trimmed
    expect(r.score).toBe(91);
    expect(r.risk).toBe("low");
  });

  it("isSafe() compares against the threshold", async () => {
    const client = new VouchClient({
      fetch: stubFetch(200, { target: "t", host: "t", score: 60, risk: "medium" }),
    });
    expect(await client.isSafe("t", 70)).toBe(false);
    expect(await client.isSafe("t", 50)).toBe(true);
  });

  it("throws on non-OK HTTP", async () => {
    const client = new VouchClient({ fetch: stubFetch(429, {}) });
    await expect(client.score("t")).rejects.toThrow(/HTTP 429/);
  });
});

describe("assertTrusted", () => {
  it("resolves when score >= minScore", async () => {
    const client = new VouchClient({
      fetch: stubFetch(200, { target: "t", host: "t", score: 80, risk: "low" }),
    });
    const r = await assertTrusted("t", { client, minScore: 75 });
    expect(r.score).toBe(80);
  });

  it("throws VouchBlockedError when below minScore", async () => {
    const client = new VouchClient({
      fetch: stubFetch(200, { target: "t", host: "t", score: 40, risk: "high" }),
    });
    await expect(assertTrusted("t", { client, minScore: 70 })).rejects.toBeInstanceOf(VouchBlockedError);
  });
});
