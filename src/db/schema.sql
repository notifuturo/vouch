-- Vouch reputation store (Cloudflare D1 / SQLite).
-- The compounding dataset: every check and report accretes here.

CREATE TABLE IF NOT EXISTS reputation (
  host         TEXT PRIMARY KEY,
  checks       INTEGER NOT NULL DEFAULT 0,
  flags        INTEGER NOT NULL DEFAULT 0,
  vouches      INTEGER NOT NULL DEFAULT 0,
  -- Reporter-standing-weighted totals (REAL): each counted report adds a
  -- fraction in (0,1] by source tenure. The scoring signal uses these; the
  -- integer counts above stay as the raw audit/stats view. See repo.ts.
  flag_weight  REAL NOT NULL DEFAULT 0,
  vouch_weight REAL NOT NULL DEFAULT 0,
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL
);

-- Settlement ledger: one row per settled payment (app-level idempotency so a
-- replayed payment proof can't double-count side effects). See settlements.ts.
CREATE TABLE IF NOT EXISTS settlements (
  payment_id TEXT PRIMARY KEY,
  host       TEXT,
  settled_at TEXT NOT NULL
);

-- Append-only log of community reports, for auditability and abuse review.
CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  host       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('flag', 'vouch')),
  reason     TEXT,
  reporter   TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_host ON reports (host);
