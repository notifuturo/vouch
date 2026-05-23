import { describe, it, expect } from "vitest";
import { parseTarget, canonicalHost } from "../src/scoring/target.js";

describe("parseTarget", () => {
  it("rejects userinfo so the visible string can't diverge from the assessed host", () => {
    // https://good.com@evil.io resolves to host evil.io — refuse it outright.
    expect(parseTarget("https://good.com@evil.io").host).toBeNull();
    expect(parseTarget("https://user:pass@example.com").host).toBeNull();
  });

  it("rejects non-http(s) schemes", () => {
    expect(parseTarget("ftp://internal.host/x").host).toBeNull();
    expect(parseTarget("ws://example.com").host).toBeNull();
    expect(parseTarget("gopher://example.com").host).toBeNull();
  });

  it("strips trailing dots (FQDN form is the same host)", () => {
    expect(parseTarget("evil.com.").host).toBe("evil.com");
    expect(parseTarget("https://evil.com./pay").host).toBe("evil.com");
  });

  it("canonicalizes IP-literal encodings to dotted-quad", () => {
    expect(parseTarget("2130706433").host).toBe("127.0.0.1");
    expect(parseTarget("http://0x7f000001").host).toBe("127.0.0.1");
  });
});

describe("canonicalHost", () => {
  it("produces the same form for input and feed representations", () => {
    expect(canonicalHost("EVIL.com.")).toBe("evil.com");
    expect(canonicalHost("0x7f000001")).toBe("127.0.0.1");
    expect(canonicalHost("2130706433")).toBe(parseTarget("2130706433").host);
  });
  it("rejects non-host strings (paths, userinfo, garbage)", () => {
    expect(canonicalHost("evil.com/path")).toBeNull();
    expect(canonicalHost("a@b.com")).toBeNull();
    expect(canonicalHost("# comment")).toBeNull();
    expect(canonicalHost("")).toBeNull();
  });
});

describe("parseTarget (existing)", () => {
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
