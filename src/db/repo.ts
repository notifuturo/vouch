import type { ReputationRecord } from "../types.js";

export type ReportKind = "flag" | "vouch";

/** Aggregate view of the reputation dataset (the compounding moat). */
export interface RepoStats {
  /** Distinct hosts ever seen. */
  hosts: number;
  /** Total checks performed across all hosts. */
  checks: number;
  /** Total flag reports. */
  flags: number;
  /** Total vouch reports. */
  vouches: number;
}

/** Storage abstraction so the scoring core never depends on D1 directly. */
export interface ReputationRepo {
  get(host: string): Promise<ReputationRecord | null>;
  /** Record that a check occurred (increments `checks`, upserts the row). */
  recordCheck(host: string): Promise<void>;
  /** Record a community report and bump the matching counter. */
  recordReport(host: string, kind: ReportKind, reason?: string, reporter?: string): Promise<void>;
  /** Aggregate totals across the whole dataset. */
  stats(): Promise<RepoStats>;
}

interface Row {
  host: string;
  checks: number;
  flags: number;
  vouches: number;
  first_seen: string;
  last_seen: string;
}

/** Cloudflare D1-backed implementation. */
export class D1ReputationRepo implements ReputationRepo {
  constructor(private readonly db: D1Database) {}

  async get(host: string): Promise<ReputationRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM reputation WHERE host = ?")
      .bind(host)
      .first<Row>();
    return row ? toRecord(row) : null;
  }

  async stats(): Promise<RepoStats> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS hosts,
                COALESCE(SUM(checks), 0)  AS checks,
                COALESCE(SUM(flags), 0)   AS flags,
                COALESCE(SUM(vouches), 0) AS vouches
         FROM reputation`,
      )
      .first<RepoStats>();
    return row ?? { hosts: 0, checks: 0, flags: 0, vouches: 0 };
  }

  async recordCheck(host: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO reputation (host, checks, first_seen, last_seen)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(host) DO UPDATE SET
           checks = checks + 1,
           last_seen = excluded.last_seen`,
      )
      .bind(host, now, now)
      .run();
  }

  async recordReport(
    host: string,
    kind: ReportKind,
    reason?: string,
    reporter?: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const column = kind === "flag" ? "flags" : "vouches";
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO reports (host, kind, reason, reporter, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(host, kind, reason ?? null, reporter ?? null, now),
      this.db
        .prepare(
          `INSERT INTO reputation (host, ${column}, first_seen, last_seen)
           VALUES (?, 1, ?, ?)
           ON CONFLICT(host) DO UPDATE SET
             ${column} = ${column} + 1,
             last_seen = excluded.last_seen`,
        )
        .bind(host, now, now),
    ]);
  }
}

/** In-memory implementation for tests and local reasoning. */
export class InMemoryReputationRepo implements ReputationRepo {
  private readonly store = new Map<string, ReputationRecord>();

  async get(host: string): Promise<ReputationRecord | null> {
    return this.store.get(host) ?? null;
  }

  async recordCheck(host: string): Promise<void> {
    const rec = this.upsert(host);
    rec.checks += 1;
  }

  async recordReport(host: string, kind: ReportKind): Promise<void> {
    const rec = this.upsert(host);
    if (kind === "flag") rec.flags += 1;
    else rec.vouches += 1;
  }

  async stats(): Promise<RepoStats> {
    let checks = 0;
    let flags = 0;
    let vouches = 0;
    for (const r of this.store.values()) {
      checks += r.checks;
      flags += r.flags;
      vouches += r.vouches;
    }
    return { hosts: this.store.size, checks, flags, vouches };
  }

  private upsert(host: string): ReputationRecord {
    const now = new Date().toISOString();
    let rec = this.store.get(host);
    if (!rec) {
      rec = { host, checks: 0, flags: 0, vouches: 0, firstSeen: now, lastSeen: now };
      this.store.set(host, rec);
    }
    rec.lastSeen = now;
    return rec;
  }
}

function toRecord(row: Row): ReputationRecord {
  return {
    host: row.host,
    checks: row.checks,
    flags: row.flags,
    vouches: row.vouches,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  };
}
