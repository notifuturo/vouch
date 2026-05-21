-- Vouch reputation store (Cloudflare D1 / SQLite).
-- The compounding dataset: every check and report accretes here.

CREATE TABLE IF NOT EXISTS reputation (
  host       TEXT PRIMARY KEY,
  checks     INTEGER NOT NULL DEFAULT 0,
  flags      INTEGER NOT NULL DEFAULT 0,
  vouches    INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
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
