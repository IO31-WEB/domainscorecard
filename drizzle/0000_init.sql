-- Run this once in Neon's SQL Editor (console.neon.tech → your project →
-- SQL Editor) to create the tables. This matches src/lib/db/schema.ts exactly.
-- (Equivalent to what `npx drizzle-kit push` would generate, for anyone
-- without a local terminal to run that command.)

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  input_address TEXT NOT NULL,
  formatted_address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  lat_rounded DOUBLE PRECISION NOT NULL,
  lng_rounded DOUBLE PRECISION NOT NULL,
  county TEXT,
  state_fips TEXT,
  county_fips TEXT,
  tract_fips TEXT,
  overall_score DOUBLE PRECISION NOT NULL,
  overall_grade TEXT NOT NULL,
  category_scores JSONB NOT NULL,
  raw_data JSONB NOT NULL,
  narrative JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS reports_location_idx ON reports (lat_rounded, lng_rounded);

CREATE TABLE IF NOT EXISTS rate_limits (
  id SERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  blocked BOOLEAN NOT NULL DEFAULT FALSE
);
