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

/** Weight floor for a brand-new or anonymous reporting source. */
const NEW_REPORTER_WEIGHT = 0.3;
/** Days of sustained reporting a source needs before it reaches full weight. */
const ESTABLISHED_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Standing weight in (0,1] for a reporting source, from how long it has been
 * reporting. A first-ever or anonymous source counts at {@link NEW_REPORTER_WEIGHT};
 * weight ramps linearly to 1.0 once the source has been active for
 * {@link ESTABLISHED_DAYS}. This is the anti-poisoning lever: spinning up fresh
 * identities only buys fractional influence, so forcing a bad verdict costs
 * proportionally more sybils — and sustained over time — than with one reporter.
 *
 * @param firstSeenIso  the source's earliest prior report timestamp, or null if
 *                      it has never reported before (or is anonymous).
 */
export function reporterWeight(firstSeenIso: string | null, now: number = Date.now()): number {
  if (!firstSeenIso) return NEW_REPORTER_WEIGHT;
  const firstSeenMs = Date.parse(firstSeenIso);
  if (Number.isNaN(firstSeenMs)) return NEW_REPORTER_WEIGHT;
  const ageDays = (now - firstSeenMs) / DAY_MS;
  if (ageDays <= 0) return NEW_REPORTER_WEIGHT;
  const ramp = Math.min(1, ageDays / ESTABLISHED_DAYS);
  return Math.min(1, NEW_REPORTER_WEIGHT + (1 - NEW_REPORTER_WEIGHT) * ramp);
}

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
  flag_weight: number;
  vouch_weight: number;
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
    const weightColumn = kind === "flag" ? "flag_weight" : "vouch_weight";
    const source = opts.source ?? null;

    // De-dup: a given source moves a host's counter at most once per window.
    // Claim the (reporter, host, kind) slot with a single conditional UPSERT so
    // the decision is ATOMIC — SQLite's single writer serializes it, so two
    // concurrent reports from one source can't both count (a read-then-write
    // check could). `changes === 1` means we claimed it (new row, or the prior
    // claim is older than the window); 0 means a duplicate inside the window.
    // Anonymous reports (no source) have no identity to de-dup on, so they
    // always count. We still log every report row (append-only audit trail).
    let countsTowardReputation = true;
    if (source) {
      const res = await this.db
        .prepare(
          `INSERT INTO report_dedup (reporter, host, kind, last_counted_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(reporter, host, kind) DO UPDATE SET
             last_counted_at = excluded.last_counted_at
             WHERE excluded.last_counted_at - report_dedup.last_counted_at >= ?`,
        )
        .bind(source, host, kind, Date.now(), REPORT_DEDUP_WINDOW_MS)
        .run();
      countsTowardReputation = (res.meta?.changes ?? 0) === 1;
    }

    // Weight this report by the source's standing (tenure). Anonymous reports
    // (no source key) get the new-reporter floor. Computed from the source's
    // earliest PRIOR report, before this row is inserted.
    let weight = NEW_REPORTER_WEIGHT;
    if (countsTowardReputation && source) {
      const hist = await this.db
        .prepare("SELECT MIN(created_at) AS first_seen FROM reports WHERE reporter = ?")
        .bind(source)
        .first<{ first_seen: string | null }>();
      weight = reporterWeight(hist?.first_seen ?? null);
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
            `INSERT INTO reputation (host, ${column}, ${weightColumn}, first_seen, last_seen)
             VALUES (?, 1, ?, ?, ?)
             ON CONFLICT(host) DO UPDATE SET
               ${column} = ${column} + 1,
               ${weightColumn} = ${weightColumn} + excluded.${weightColumn},
               last_seen = excluded.last_seen`,
          )
          .bind(host, weight, now, now),
      );
    }
    await this.db.batch(statements);
  }
}

/** In-memory implementation for tests and local reasoning. */
export class InMemoryReputationRepo implements ReputationRepo {
  private readonly store = new Map<string, ReputationRecord>();
  /** Earliest report timestamp (ms) per source, for standing weight. */
  private readonly reporterFirstSeen = new Map<string, number>();
  /** Last time `reporter|host|kind` moved the counter (ms), for de-dup parity
   *  with D1's report_dedup ledger. */
  private readonly dedup = new Map<string, number>();

  async get(host: string): Promise<ReputationRecord | null> {
    return this.store.get(host) ?? null;
  }

  async recordCheck(host: string): Promise<void> {
    const rec = this.upsert(host);
    rec.checks += 1;
  }

  async recordReport(host: string, kind: ReportKind, opts: ReportOptions = {}): Promise<void> {
    const rec = this.upsert(host);
    const source = opts.source;
    // De-dup parity with D1: a source moves a host's counter at most once per
    // window. Anonymous reports (no source) always count. The host row is still
    // upserted above (it mirrors recording the audit/last_seen).
    if (source) {
      const key = `${source}|${host}|${kind}`;
      const last = this.dedup.get(key);
      const nowMs = Date.now();
      if (last !== undefined && nowMs - last < REPORT_DEDUP_WINDOW_MS) return;
      this.dedup.set(key, nowMs);
    }
    // Compute standing from the source's PRIOR first-seen, then record this one.
    const priorFirstSeen = source ? this.reporterFirstSeen.get(source) : undefined;
    const weight = reporterWeight(priorFirstSeen ? new Date(priorFirstSeen).toISOString() : null);
    if (source && priorFirstSeen === undefined) this.reporterFirstSeen.set(source, Date.now());
    if (kind === "flag") {
      rec.flags += 1;
      rec.flagWeight = (rec.flagWeight ?? 0) + weight;
    } else {
      rec.vouches += 1;
      rec.vouchWeight = (rec.vouchWeight ?? 0) + weight;
    }
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
      rec = { host, checks: 0, flags: 0, vouches: 0, flagWeight: 0, vouchWeight: 0, firstSeen: now, lastSeen: now };
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
    // `?? undefined` so a DB without the weight columns yet (pre-migration)
    // leaves the signal to fall back to raw counts rather than read 0.
    flagWeight: row.flag_weight ?? undefined,
    vouchWeight: row.vouch_weight ?? undefined,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  };
}
