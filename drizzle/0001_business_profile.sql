-- Run this once in Neon's SQL Editor (console.neon.tech -> your project ->
-- SQL Editor) after pulling the "business profiles" update. Adds the column
-- that lets the same address be scored differently per intended business
-- use (QSR, restaurant, medical, retail, etc.) and keeps report caching
-- correct per-use. Safe to run even if some columns/index already exist.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS business_profile TEXT NOT NULL DEFAULT 'general';

DROP INDEX IF EXISTS reports_location_idx;

CREATE INDEX IF NOT EXISTS reports_location_idx
  ON reports (lat_rounded, lng_rounded, business_profile);
