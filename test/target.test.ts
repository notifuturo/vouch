import { describe, it, expect } from "vitest";
import { parseTarget } from "../src/scoring/target.js";

describe("parseTarget", () => {
  it("parses full https URLs", () => {
    const t = parseTarget("https://Shop.Example.com/checkout");
    expect(t.host).toBe("shop.example.com");
    expect(t.secure).toBe(true);
  });

  it("flags http as not secure", () => {
    const t = parseTarget("http://example.com");
    expect(t.host).toBe("example.com");
    expect(t.secure).toBe(false);
  });

  it("extracts host from bare hostnames but marks insecure (no scheme given)", () => {
    const t = parseTarget("api.merchant.io");
    expect(t.host).toBe("api.merchant.io");
    expect(t.secure).toBe(false);
  });

  it("handles empty and garbage input without throwing", () => {
    expect(parseTarget("").host).toBeNull();
    expect(parseTarget("   ").host).toBeNull();
    expect(parseTarget("::::").host).toBeNull();
  });
});
