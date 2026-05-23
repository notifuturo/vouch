import { describe, it, expect } from "vitest";
import app from "../src/index.js";
import { InMemoryReputationRepo, D1ReputationRepo } from "../src/db/repo.js";

describe("D1ReputationRepo.recordReport de-duplication (anti-poisoning)", () => {
  // Mock D1 that captures batch sizes and can simulate a recent duplicate.
  function mockDb() {
    const batches: number[] = [];
    const sqls: string[][] = [];
    let dup = false;
    const db = {
      prepare(sql: string) {
        const stmt = {
          sql,
          bind() {
            return stmt;
          },
          async first() {
            return dup ? { 1: 1 } : null;
          },
          async run() {
            return {};
          },
        };
        return stmt;
      },
      async batch(stmts: { sql: string }[]) {
        batches.push(stmts.length);
        sqls.push(stmts.map((s) => s.sql));
        return [];
      },
    } as unknown as D1Database;
    return { db, batches, sqls, setDup: (v: boolean) => (dup = v) };
  }

  it("counts the first report from a source but NOT a repeat within the window", async () => {
    const m = mockDb();
    const repo = new D1ReputationRepo(m.db);
    await repo.recordReport("evil.com", "flag", { source: "src1" }); // first → counts
    m.setDup(true);
    await repo.recordReport("evil.com", "flag", { source: "src1" }); // repeat → audit only
    expect(m.batches).toEqual([2, 1]);
    expect(m.sqls[0].some((s) => s.includes("reputation"))).toBe(true);
    expect(m.sqls[1].some((s) => s.includes("reputation"))).toBe(false);
  });

  it("always counts when no source key is provided", async () => {
    const m = mockDb();
    const repo = new D1ReputationRepo(m.db);
    await repo.recordReport("x.com", "flag", {});
    expect(m.batches).toEqual([2]);
  });
});

describe("InMemoryReputationRepo.stats", () => {
  it("aggregates checks, flags, vouches and distinct host count", async () => {
    const repo = new InMemoryReputationRepo();
    await repo.recordCheck("a.com");
    await repo.recordCheck("a.com");
    await repo.recordCheck("b.com");
    await repo.recordReport("b.com", "flag");
    await repo.recordReport("c.com", "vouch");
    expect(await repo.stats()).toEqual({ hosts: 3, checks: 3, flags: 1, vouches: 1 });
  });

  it("returns zeros for an empty store", async () => {
    expect(await new InMemoryReputationRepo().stats()).toEqual({
      hosts: 0,
      checks: 0,
      flags: 0,
      vouches: 0,
    });
  });
});

describe("GET /v1/stats", () => {
  it("returns aggregate stats as JSON (free, ungated)", async () => {
    const env = {
      // Minimal D1 stub: stats() does prepare(sql).first().
      DB: {
        prepare: () => ({ first: async () => ({ hosts: 4, checks: 9, flags: 2, vouches: 1 }) }),
      } as unknown as D1Database,
      X402_NETWORK: "base-sepolia",
      X402_FACILITATOR_URL: "https://x402.org/facilitator",
      PRICE_CHECK_USDC: "0.001",
      PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
    };
    const res = await app.request("/v1/stats", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hosts: 4, checks: 9, flags: 2, vouches: 1 });
  });
});
