import { describe, it, expect } from "vitest";
import { aggregate, toRiskBand } from "../src/scoring/engine.js";
import type { Signal } from "../src/types.js";

const sig = (score: number, weight = 1, id = "s"): Signal => ({
  id,
  weight,
  score,
  detail: "",
});

describe("toRiskBand", () => {
  it("maps scores to bands", () => {
    expect(toRiskBand(90)).toBe("low");
    expect(toRiskBand(60)).toBe("medium");
    expect(toRiskBand(30)).toBe("high");
    expect(toRiskBand(10)).toBe("critical");
  });
});

describe("aggregate", () => {
  it("returns neutral 50 when there is no evidence", () => {
    expect(aggregate([])).toBe(50);
    expect(aggregate([sig(1, 0)])).toBe(50); // zero-weight ignored
  });

  it("computes a weighted average", () => {
    // (1*1 + 0*1) / 2 = 0.5 -> 50
    expect(aggregate([sig(1), sig(0.0)])).toBeLessThanOrEqual(50);
    // all safe -> 100
    expect(aggregate([sig(1), sig(1)])).toBe(100);
  });

  it("respects weights", () => {
    // heavy safe signal dominates a light risky one
    expect(aggregate([sig(1, 9), sig(0.5, 1)])).toBeGreaterThan(90);
  });

  it("caps the score when an AUTHORITATIVE signal is a hard negative", () => {
    // Without the cap this would be ~75; an authoritative hard negative forces <= 15.
    const score = aggregate([sig(1, 3, "transport"), sig(0, 1, "threat_feed")]);
    expect(score).toBeLessThanOrEqual(15);
  });

  it("does NOT hard-cap on a non-authoritative hard negative (poisoning resistance)", () => {
    // A zero-scoring crowd 'reputation' signal pulls the average down but must
    // not unilaterally force critical.
    const score = aggregate([sig(1, 3, "threat_feed"), sig(0, 2, "reputation")]);
    expect(score).toBeGreaterThan(15);
  });

  it("clamps NaN scores to safe lower bound", () => {
    expect(aggregate([sig(Number.NaN)])).toBeLessThanOrEqual(15);
  });
});
