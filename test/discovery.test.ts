import { describe, it, expect } from "vitest";
import {
  buildX402Descriptor,
  buildMcpToolManifest,
  usdcBaseUnits,
  type DiscoveryConfig,
} from "../src/discovery.js";

const cfg: DiscoveryConfig = {
  network: "base-sepolia",
  priceUsdc: "0.001",
  baseUrl: "https://vouch.example.com",
};

describe("usdcBaseUnits", () => {
  it("converts decimal USDC strings to 6-decimal base units without float error", () => {
    expect(usdcBaseUnits("0.001")).toBe("1000");
    expect(usdcBaseUnits("1")).toBe("1000000");
    expect(usdcBaseUnits("0.000001")).toBe("1");
    expect(usdcBaseUnits("2.5")).toBe("2500000");
  });

  it("handles zero and pads short fractions", () => {
    expect(usdcBaseUnits("0")).toBe("0");
    expect(usdcBaseUnits("0.0")).toBe("0");
    expect(usdcBaseUnits("0.5")).toBe("500000");
    expect(usdcBaseUnits("10")).toBe("10000000");
  });

  it("truncates fractions more precise than 6 decimals (toward zero)", () => {
    expect(usdcBaseUnits("0.0000019")).toBe("1");
    expect(usdcBaseUnits("1.2345678")).toBe("1234567");
  });
});

describe("buildX402Descriptor (canonical x402 v2)", () => {
  it("declares x402Version 2 at the top level and per-resource", () => {
    const d = buildX402Descriptor(cfg);
    expect(d.x402Version).toBe(2);
    expect(d.resources).toHaveLength(1);
    expect(d.resources[0].x402Version).toBe(2);
  });

  it("exposes the http /v1/check resource with metadata and a timestamp", () => {
    const r = buildX402Descriptor(cfg).resources[0];
    expect(r.resource).toBe("https://vouch.example.com/v1/check");
    expect(r.type).toBe("http");
    expect(r.metadata).toEqual({});
    expect(typeof r.lastUpdated).toBe("string");
    // ISO-8601 timestamp.
    expect(new Date(r.lastUpdated).toISOString()).toBe(r.lastUpdated);
  });

  it("prices the resource in USDC base units on the configured network", () => {
    const accept = buildX402Descriptor(cfg).resources[0].accepts[0];
    expect(accept.scheme).toBe("exact");
    expect(accept.network).toBe("eip155:84532");
    expect(accept.maxAmountRequired).toBe("1000"); // 0.001 USDC -> 1000 base units
    expect(accept.payTo).toBe("");
    expect(accept.maxTimeoutSeconds).toBe(300);
    expect(accept.mimeType).toBe("application/json");
    expect(accept.resource).toBe("https://vouch.example.com/v1/check");
  });

  it("references the sepolia USDC asset address and EIP-712 name", () => {
    const accept = buildX402Descriptor(cfg).resources[0].accepts[0];
    expect(accept.asset).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    expect(accept.extra).toEqual({ name: "USDC", version: "2" });
  });

  it("maps mainnet to its CAIP-2 id, mainnet USDC, and 'USD Coin' name", () => {
    const accept = buildX402Descriptor({ ...cfg, network: "base" }).resources[0]
      .accepts[0];
    expect(accept.network).toBe("eip155:8453");
    expect(accept.asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(accept.extra).toEqual({ name: "USD Coin", version: "2" });
  });

  it("computes mainnet base units from the configured price", () => {
    const accept = buildX402Descriptor({
      ...cfg,
      network: "base",
      priceUsdc: "2.5",
    }).resources[0].accepts[0];
    expect(accept.maxAmountRequired).toBe("2500000");
  });

  it("returns null network/asset/extra for unknown networks (fails closed, no throw)", () => {
    const accept = buildX402Descriptor({ ...cfg, network: "solana" }).resources[0]
      .accepts[0];
    expect(accept.network).toBeNull();
    expect(accept.asset).toBeNull();
    expect(accept.extra).toBeNull();
    // Amount is still computed from the price (network-independent).
    expect(accept.maxAmountRequired).toBe("1000");
  });

  it("declares the canonical outputSchema.input as a POST json body", () => {
    const input = buildX402Descriptor(cfg).resources[0].accepts[0].outputSchema
      .input;
    expect(input.type).toBe("http");
    expect(input.method).toBe("POST");
    expect(input.bodyType).toBe("json");
    expect(input.body.properties.target.type).toBe("string");
    expect(input.body.required).toContain("target");
  });

  it("declares the canonical outputSchema.output with a json example", () => {
    const output = buildX402Descriptor(cfg).resources[0].accepts[0].outputSchema
      .output;
    expect(output.type).toBe("json");
    expect(output.format).toBe("application/json");
    expect(output.example.score).toBe(87);
    expect(output.example.risk).toBe("low");
    expect(output.example.reasons).toContain("Host uses HTTPS");
    // The full JSON Schema is also carried for stricter consumers.
    expect(Object.keys(output.schema.properties)).toEqual([
      "score",
      "risk",
      "reasons",
    ]);
  });

  it("normalizes a trailing slash in baseUrl", () => {
    const d = buildX402Descriptor({
      ...cfg,
      baseUrl: "https://vouch.example.com/",
    });
    expect(d.resources[0].resource).toBe("https://vouch.example.com/v1/check");
    expect(d.resources[0].accepts[0].resource).toBe(
      "https://vouch.example.com/v1/check",
    );
  });
});

describe("buildMcpToolManifest", () => {
  it("exposes a single vouch_check tool", () => {
    const m = buildMcpToolManifest(cfg);
    expect(m.tools).toHaveLength(1);
    expect(m.tools[0].name).toBe("vouch_check");
  });

  it("provides a JSON Schema input for { target }", () => {
    const tool = buildMcpToolManifest(cfg).tools[0];
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.properties.target.type).toBe("string");
    expect(tool.inputSchema.required).toContain("target");
  });

  it("flags the tool as x402 v2 paid with base-unit price and resource URL", () => {
    const x402 = buildMcpToolManifest(cfg).tools[0].x402;
    expect(x402.paid).toBe(true);
    expect(x402.x402Version).toBe(2);
    expect(x402.scheme).toBe("exact");
    expect(x402.method).toBe("POST");
    expect(x402.priceUsdc).toBe("0.001");
    expect(x402.maxAmountRequired).toBe("1000");
    expect(x402.network).toBe("eip155:84532");
    expect(x402.asset).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    expect(x402.resource).toBe("https://vouch.example.com/v1/check");
  });

  it("mentions x402 payment in the description so agents know it costs money", () => {
    const desc = buildMcpToolManifest(cfg).tools[0].description.toLowerCase();
    expect(desc).toContain("x402");
  });
});
