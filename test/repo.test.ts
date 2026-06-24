import { describe, it, expect } from "vitest";
import app from "../src/index.js";
import { InMemoryReputationRepo, D1ReputationRepo } from "../src/db/repo.js";

describe("D1ReputationRepo.recordReport de-duplication (anti-poisoning)", () => {
  // Faithful mock of the report_dedup conditional UPSERT: a single-writer store
  // that claims (reporter, host, kind) atomically and reports changes=1 only on
  // a fresh claim (new row, or prior claim older than the window). The dedup
  // run() body mutates state synchronously (no internal await) so concurrent
  // recordReport calls serialize through it — mirroring SQLite's single writer.
  function mockDb({ windowMs = 24 * 60 * 60 * 1000 } = {}) {
    const claimed = new Map<string, number>(); // reporter|host|kind -> last_counted_at
    const batches: number[] = [];
    const sqls: string[][] = [];
    const db = {
      prepare(sql: string) {
        let args: unknown[] = [];
        const stmt = {
          sql,
          bind(...a: unknown[]) {
            args = a;
            return stmt;
          },
          async first() {
            // The standing-weight query: no prior reports → floor weight.
            return { first_seen: null };
          },
          async run() {
            if (sql.includes("report_dedup")) {
              const [reporter, host, kind, nowMs] = args as [string, string, string, number];
              const key = `${reporter}|${host}|${kind}`;
              const last = claimed.get(key);
              const fresh = last === undefined || nowMs - last >= windowMs;
              if (fresh) claimed.set(key, nowMs);
              return { meta: { changes: fresh ? 1 : 0 } };
            }
            return { meta: { changes: 1 } };
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
    return { db, batches, sqls };
  }

  it("counts the first report from a source but NOT a repeat within the window", async () => {
    const m = mockDb();
    const repo = new D1ReputationRepo(m.db);
    await repo.recordReport("evil.com", "flag", { source: "src1" }); // first → counts
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

  it("counts EXACTLY ONCE under a concurrent burst from one source (no TOCTOU)", async () => {
    const m = mockDb();
    const repo = new D1ReputationRepo(m.db);
    // 25 simultaneous identical reports — the old read-then-write let many of
    // these slip past the de-dup; the atomic claim lets exactly one count.
    await Promise.all(
      Array.from({ length: 25 }, () => repo.recordReport("evil.com", "flag", { source: "spammer" })),
    );
    const counted = m.sqls.filter((stmts) => stmts.some((s) => s.includes("reputation"))).length;
    expect(counted).toBe(1);
    // Every attempt is still logged to the append-only audit trail.
    expect(m.batches).toHaveLength(25);
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
