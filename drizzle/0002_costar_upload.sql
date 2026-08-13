-- Run this once in Neon's SQL Editor (console.neon.tech -> your project ->
-- SQL Editor) after pulling the "CoStar upload" update. Adds the columns
-- that track whether an agent-attached CoStar export (PDF/Excel/CSV) was
-- used for a given report. The extracted highlights themselves are stored
-- inside the existing `narrative` jsonb column (no schema change needed
-- for that part) — this migration only adds provenance/display fields.
-- Safe to run even if the columns already exist.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS has_costar_data BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS costar_filename TEXT;
