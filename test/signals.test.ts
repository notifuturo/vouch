import { describe, it, expect } from "vitest";
import { parseTarget } from "../src/scoring/target.js";
import { transportSignal } from "../src/scoring/signals/transport.js";
import { domainHeuristicsSignal } from "../src/scoring/signals/domainHeuristics.js";
import { reputationSignal } from "../src/scoring/signals/reputation.js";
import type { ReputationRecord } from "../src/types.js";

describe("transportSignal", () => {
  it("rewards https", () => {
    expect(transportSignal(parseTarget("https://x.com")).score).toBe(1);
  });
  it("penalizes missing host hard", () => {
    expect(transportSignal(parseTarget("")).score).toBe(0);
  });
});

describe("domainHeuristicsSignal", () => {
  it("treats a plain domain as unremarkable", () => {
    expect(domainHeuristicsSignal(parseTarget("https://stripe.com")).score).toBe(1);
  });
  it("penalizes punycode", () => {
    expect(domainHeuristicsSignal(parseTarget("https://xn--80ak6aa92e.com")).score).toBeLessThan(1);
  });
  it("penalizes raw IPs and high-abuse TLDs", () => {
    expect(domainHeuristicsSignal(parseTarget("http://203.0.113.7")).score).toBeLessThan(1);
    expect(domainHeuristicsSignal(parseTarget("https://free-money.zip")).score).toBeLessThan(1);
  });
});

describe("reputationSignal", () => {
  const base: ReputationRecord = {
    host: "h",
    checks: 0,
    flags: 0,
    vouches: 0,
    firstSeen: "",
    lastSeen: "",
  };

  it("is neutral for unknown hosts", () => {
    expect(reputationSignal(null).score).toBe(0.5);
    expect(reputationSignal({ ...base }).score).toBe(0.5);
  });

  it("drops sharply with flags", () => {
    const flagged = reputationSignal({ ...base, checks: 5, flags: 3 });
    expect(flagged.score).toBeLessThan(0.1);
  });

  it("rises modestly with vouches", () => {
    const vouched = reputationSignal({ ...base, checks: 10, vouches: 10 });
    expect(vouched.score).toBeGreaterThan(0.6);
  });
});
