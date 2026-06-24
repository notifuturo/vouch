-- Migration 0002 — atomic per-source report de-duplication.
-- Apply to an EXISTING database (schema.sql already has this for fresh DBs):
--   wrangler d1 execute vouch --remote --file=./src/db/migrations/0002_report_dedup.sql
--
-- Replaces the read-then-write de-dup in recordReport (a SELECT … then a
-- separate counter write) which had a TOCTOU race: two concurrent reports from
-- the same source could both pass the "already reported?" check and each move
-- the reputation counter, weakening the anti-poisoning de-dup. The counter slot
-- is now claimed with a single conditional UPSERT, resolved atomically by
-- SQLite's single writer — at most one report per (reporter, host, kind) counts
-- per rolling window. The append-only `reports` table still logs every attempt.
-- `last_counted_at` is epoch milliseconds (matches Date.now()).
CREATE TABLE IF NOT EXISTS report_dedup (
  reporter        TEXT NOT NULL,
  host            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('flag', 'vouch')),
  last_counted_at INTEGER NOT NULL,
  PRIMARY KEY (reporter, host, kind)
);
