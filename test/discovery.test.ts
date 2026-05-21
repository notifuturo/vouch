import { describe, it, expect } from "vitest";
import {
  buildX402Descriptor,
  buildMcpToolManifest,
  type DiscoveryConfig,
} from "../src/discovery.js";

const cfg: DiscoveryConfig = {
  network: "base-sepolia",
  priceUsdc: "0.001",
  baseUrl: "https://vouch.example.com",
};

describe("buildX402Descriptor", () => {
  it("exposes the paid /v1/check resource with method POST", () => {
    const d = buildX402Descriptor(cfg);
    expect(d.resources).toHaveLength(1);
    const r = d.resources[0];
    expect(r.path).toBe("/v1/check");
    expect(r.method).toBe("POST");
    expect(r.resource).toBe("https://vouch.example.com/v1/check");
  });

  it("prices the resource in USDC on the configured network", () => {
    const accept = buildX402Descriptor(cfg).resources[0].accepts[0];
    expect(accept.scheme).toBe("exact");
    expect(accept.price).toBe("$0.001");
    expect(accept.priceUsdc).toBe("0.001");
    expect(accept.network).toBe("eip155:84532");
    expect(accept.asset.symbol).toBe("USDC");
    expect(accept.asset.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("maps mainnet to its CAIP-2 id and mainnet USDC", () => {
    const accept = buildX402Descriptor({ ...cfg, network: "base" }).resources[0]
      .accepts[0];
    expect(accept.network).toBe("eip155:8453");
    expect(accept.asset.address).toBe(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    );
  });

  it("returns null network/asset for unknown networks (fails closed, no throw)", () => {
    const accept = buildX402Descriptor({ ...cfg, network: "solana" }).resources[0]
      .accepts[0];
    expect(accept.network).toBeNull();
    expect(accept.asset.address).toBeNull();
  });

  it("declares the input schema { target: string } as required", () => {
    const schema = buildX402Descriptor(cfg).resources[0].input.schema;
    expect(schema.properties.target.type).toBe("string");
    expect(schema.required).toContain("target");
    expect(schema.additionalProperties).toBe(false);
  });

  it("declares the output schema { score, risk, reasons }", () => {
    const schema = buildX402Descriptor(cfg).resources[0].output.schema;
    expect(Object.keys(schema.properties)).toEqual(["score", "risk", "reasons"]);
    expect(schema.properties.reasons.type).toBe("array");
    expect(schema.properties.risk.enum).toContain("critical");
  });

  it("normalizes a trailing slash in baseUrl", () => {
    const d = buildX402Descriptor({ ...cfg, baseUrl: "https://vouch.example.com/" });
    expect(d.resources[0].resource).toBe("https://vouch.example.com/v1/check");
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

  it("flags the tool as x402-paid with price and resource URL", () => {
    const x402 = buildMcpToolManifest(cfg).tools[0].x402;
    expect(x402.paid).toBe(true);
    expect(x402.method).toBe("POST");
    expect(x402.price).toBe("$0.001");
    expect(x402.network).toBe("eip155:84532");
    expect(x402.asset).toBe("USDC");
    expect(x402.resource).toBe("https://vouch.example.com/v1/check");
  });

  it("mentions x402 payment in the description so agents know it costs money", () => {
    const desc = buildMcpToolManifest(cfg).tools[0].description.toLowerCase();
    expect(desc).toContain("x402");
  });
});
