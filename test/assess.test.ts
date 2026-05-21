import { describe, it, expect } from "vitest";
import { assess } from "../src/scoring/assess.js";
import { InMemoryReputationRepo } from "../src/db/repo.js";

const noDenylist = () => false;

describe("assess (end-to-end scoring)", () => {
  it("scores a clean, well-known https host as low risk", async () => {
    const repo = new InMemoryReputationRepo();
    const result = await assess("https://stripe.com", {
      isDenied: noDenylist,
      getReputation: (h) => repo.get(h),
    });
    expect(result.host).toBe("stripe.com");
    expect(result.risk).toBe("low");
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("forces critical risk when a threat feed flags the host", async () => {
    const repo = new InMemoryReputationRepo();
    const result = await assess("https://stripe.com", {
      isDenied: (h) => h === "stripe.com",
      getReputation: (h) => repo.get(h),
    });
    expect(result.risk).toBe("critical");
    expect(result.score).toBeLessThanOrEqual(15);
  });

  it("downgrades a host with community flags", async () => {
    const repo = new InMemoryReputationRepo();
    await repo.recordReport("scam.example.com", "flag");
    await repo.recordReport("scam.example.com", "flag");
    await repo.recordReport("scam.example.com", "flag");
    const result = await assess("https://scam.example.com", {
      isDenied: noDenylist,
      getReputation: (h) => repo.get(h),
    });
    expect(["high", "critical"]).toContain(result.risk);
  });

  it("handles invalid input without throwing", async () => {
    const repo = new InMemoryReputationRepo();
    const result = await assess("not a url", {
      isDenied: noDenylist,
      getReputation: (h) => repo.get(h),
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
