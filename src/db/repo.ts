import type { ReputationRecord } from "../types.js";

export type ReportKind = "flag" | "vouch";

export interface ReportOptions {
  /** Bounded free-text reason (stored for audit). */
  reason?: string | undefined;
  /** Opaque per-reporter key (see ratelimit.sourceKey) used for de-duplication. */
  source?: string | undefined;
}

/** A source may move a host's reputation counter at most once per this window. */
const REPORT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

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
  /** Record a community report and bump the matching counter — unless `source`
   *  already reported the same (host, kind) within the de-dup window, in which
   *  case the report is logged for audit but does not inflate the counter. */
  recordReport(host: string, kind: ReportKind, opts?: ReportOptions): Promise<void>;
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

  async recordReport(host: string, kind: ReportKind, opts: ReportOptions = {}): Promise<void> {
    const now = new Date().toISOString();
    const column = kind === "flag" ? "flags" : "vouches";
    const source = opts.source ?? null;

    // De-dup: a given source moves a host's counter at most once per window.
    // We still log every report row (append-only audit trail).
    let countsTowardReputation = true;
    if (source) {
      const windowStart = new Date(Date.now() - REPORT_DEDUP_WINDOW_MS).toISOString();
      const dup = await this.db
        .prepare(
          "SELECT 1 FROM reports WHERE host = ? AND kind = ? AND reporter = ? AND created_at >= ? LIMIT 1",
        )
        .bind(host, kind, source, windowStart)
        .first();
      if (dup) countsTowardReputation = false;
    }

    const statements = [
      this.db
        .prepare(
          "INSERT INTO reports (host, kind, reason, reporter, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(host, kind, opts.reason ?? null, source, now),
    ];
    if (countsTowardReputation) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO reputation (host, ${column}, first_seen, last_seen)
             VALUES (?, 1, ?, ?)
             ON CONFLICT(host) DO UPDATE SET
               ${column} = ${column} + 1,
               last_seen = excluded.last_seen`,
          )
          .bind(host, now, now),
      );
    }
    await this.db.batch(statements);
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

  async recordReport(host: string, kind: ReportKind, _opts: ReportOptions = {}): Promise<void> {
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
