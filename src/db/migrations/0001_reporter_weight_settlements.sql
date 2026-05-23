-- Migration 0001 — reporter-standing weighting + settlement idempotency.
-- Apply to an EXISTING database (schema.sql already has these for fresh DBs):
--   wrangler d1 execute vouch --remote --file=./src/db/migrations/0001_reporter_weight_settlements.sql
-- ALTER TABLE ADD COLUMN with a constant DEFAULT is a metadata-only, non-locking
-- op in SQLite/D1; the backfill below preserves existing verdicts by treating
-- all historical reports as full weight (so already-flagged hosts keep their
-- penalty under the new weighted signal).

ALTER TABLE reputation ADD COLUMN flag_weight  REAL NOT NULL DEFAULT 0;
ALTER TABLE reputation ADD COLUMN vouch_weight REAL NOT NULL DEFAULT 0;

UPDATE reputation SET flag_weight = flags, vouch_weight = vouches;

CREATE TABLE IF NOT EXISTS settlements (
  payment_id TEXT PRIMARY KEY,
  host       TEXT,
  settled_at TEXT NOT NULL
);
