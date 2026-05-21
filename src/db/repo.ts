import type { ReputationRecord } from "../types.js";

export type ReportKind = "flag" | "vouch";

/** Storage abstraction so the scoring core never depends on D1 directly. */
export interface ReputationRepo {
  get(host: string): Promise<ReputationRecord | null>;
  /** Record that a check occurred (increments `checks`, upserts the row). */
  recordCheck(host: string): Promise<void>;
  /** Record a community report and bump the matching counter. */
  recordReport(host: string, kind: ReportKind, reason?: string, reporter?: string): Promise<void>;
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
