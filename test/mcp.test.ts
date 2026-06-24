import { describe, it, expect } from "vitest";
import app from "../src/index.js";

const execCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;

const env = {
  DB: {
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
};

function rpc(body: unknown) {
  return app.request(
    "/mcp",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    env,
    execCtx,
  );
}

describe("MCP server (/mcp)", () => {
  it("handles initialize", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.result.protocolVersion).toBeDefined();
    expect(j.result.serverInfo.name).toBe("vouch");
    expect(j.result.capabilities.tools).toBeDefined();
  });

  it("returns model-facing `instructions` that name both tools and the pre-payment use case", async () => {
    const j = (await (
      await rpc({ jsonrpc: "2.0", id: 6, method: "initialize", params: {} })
    ).json()) as any;
    const instr = j.result.instructions as string;
    expect(typeof instr).toBe("string");
    expect(instr.length).toBeGreaterThan(0);
    expect(instr).toContain("vouch_score");
    expect(instr).toContain("vouch_report");
    // The whole point: tell the model to check BEFORE it pays.
    expect(instr.toLowerCase()).toMatch(/before .*pay|pay.*counterparty/);
  });

  it("lists the free tools", async () => {
    const j = (await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as any;
    const names = j.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("vouch_score");
    expect(names).toContain("vouch_report");
  });

  it("calls vouch_score and returns score + risk (no reasons)", async () => {
    const j = (await (
      await rpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "vouch_score", arguments: { target: "https://stripe.com" } },
      })
    ).json()) as any;
    expect(j.result.isError).toBe(false);
    expect(j.result.structuredContent.host).toBe("stripe.com");
    expect(typeof j.result.structuredContent.score).toBe("number");
    expect(typeof j.result.structuredContent.risk).toBe("string");
    expect(j.result.structuredContent).not.toHaveProperty("reasons");
  });

  it("returns isError for an unknown tool", async () => {
    const j = (await (
      await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } })
    ).json()) as any;
    expect(j.result.isError).toBe(true);
  });

  it("returns method-not-found error for unknown method", async () => {
    const j = (await (await rpc({ jsonrpc: "2.0", id: 5, method: "bogus" })).json()) as any;
    expect(j.error.code).toBe(-32601);
  });

  it("accepts notifications with 202 (no body)", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
  });

  it("rejects GET with 405", async () => {
    const res = await app.request("/mcp", {}, env, execCtx);
    expect(res.status).toBe(405);
  });
});
