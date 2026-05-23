import { describe, it, expect } from "vitest";
import { reporterWeight, InMemoryReputationRepo } from "../src/db/repo.js";
import { reputationSignal } from "../src/scoring/signals/reputation.js";
import type { ReputationRecord } from "../src/types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 0, 30);
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

describe("reporterWeight (anti-poisoning standing)", () => {
  it("gives a brand-new / anonymous source the floor weight", () => {
    expect(reporterWeight(null, now)).toBe(0.3);
    expect(reporterWeight(iso(0), now)).toBe(0.3); // age 0
  });

  it("ramps linearly to full weight over the establishment window", () => {
    expect(reporterWeight(iso(3.5 * DAY_MS), now)).toBeCloseTo(0.65, 5); // halfway
    expect(reporterWeight(iso(7 * DAY_MS), now)).toBe(1); // established
  });

  it("caps at 1.0 for long-tenured sources and ignores garbage timestamps", () => {
    expect(reporterWeight(iso(90 * DAY_MS), now)).toBe(1);
    expect(reporterWeight("not-a-date", now)).toBe(0.3);
  });
});

describe("reputationSignal uses weighted totals when present", () => {
  const base: ReputationRecord = {
    host: "h", checks: 5, flags: 0, vouches: 0, firstSeen: "", lastSeen: "",
  };

  it("three full-weight flags hard-tank the score (unchanged behavior)", () => {
    const s = reputationSignal({ ...base, flags: 3, flagWeight: 3 });
    expect(s.score).toBeLessThan(0.1);
  });

  it("three flags from fresh sources bite far less than three from established ones", () => {
    const fresh = reputationSignal({ ...base, flags: 3, flagWeight: 0.9 }); // 3 x 0.3
    const established = reputationSignal({ ...base, flags: 3, flagWeight: 3 });
    expect(fresh.score).toBeGreaterThan(established.score);
    expect(fresh.score).toBeGreaterThan(0.25); // poisoning by fresh sybils is blunted
  });

  it("falls back to raw counts when no weight is recorded (legacy rows)", () => {
    const s = reputationSignal({ ...base, flags: 3 }); // flagWeight undefined
    expect(s.score).toBeLessThan(0.1);
  });
});

describe("InMemoryReputationRepo accrues weighted flags by source standing", () => {
  it("a first-time source contributes only the floor weight", async () => {
    const repo = new InMemoryReputationRepo();
    await repo.recordReport("evil.com", "flag", { source: "new-src" });
    const rec = await repo.get("evil.com");
    expect(rec?.flags).toBe(1);
    expect(rec?.flagWeight).toBeCloseTo(0.3, 5);
  });

  it("raw count and weighted total diverge for low-standing reporters", async () => {
    const repo = new InMemoryReputationRepo();
    // Three different fresh sources each flag once.
    for (const s of ["a", "b", "c"]) await repo.recordReport("evil.com", "flag", { source: s });
    const rec = await repo.get("evil.com");
    expect(rec?.flags).toBe(3);
    expect(rec?.flagWeight).toBeCloseTo(0.9, 5); // 3 x 0.3 — not enough to fully tank
    expect(reputationSignal(rec).score).toBeGreaterThan(0.25);
  });
});
