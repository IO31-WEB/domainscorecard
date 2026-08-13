# Domain Realty Site Scorecard — Standalone Property Analysis Tool

Built for Brent Pleeter at Domain Realty (Naples, FL). Brent enters a
Florida commercial address, optionally attaches a CoStar export he already
pulled → the tool fetches free/public data sources → Claude synthesizes a
scored report → he downloads a polished, Domain Realty-branded PDF.
Single-user internal tool — no lead capture, no email gate, sits behind a
simple password.

## What's new in this version (vs. the original CRES build)

- **Domain Realty branding** — logo, agent name, and a blue/white color
  palette (sampled from the Domain Realty logo) throughout the web UI and
  the PDF, instead of the previous navy/gold placeholder scheme.
- **Optional CoStar upload** — since Brent has a CoStar subscription, the
  form accepts an optional PDF/Excel/CSV export (comps, market survey,
  property report, etc.). The extracted content is handed to Claude as
  additional, higher-trust context when it writes the narrative, and any
  address-relevant figures it finds (comps, cap rate, rent/SF, vacancy,
  absorption) show up as their own "CoStar Market Data" section in both
  the on-screen result and the PDF — clearly labeled as agent-provided so
  it's never confused with the free public-data estimates elsewhere in
  the report.
- Reports generated with a CoStar file attached always regenerate rather
  than serving from the 60-day cache, since the CoStar content is specific
  to that request.

## Why this architecture

No paid data aggregator (ATTOM, ESRI, Placer.ai, SafeGraph) is used
anywhere in the *automated* pipeline — CoStar is opt-in and agent-supplied,
not fetched by the tool itself. Every other external data source below is
either free public-domain government data, or a metered API billed at
effectively $0 at this volume.

## Data sources (all legally clean — no scraping)

| Category | Source | Auth | Cost |
|---|---|---|---|
| Geocode + tract lookup | Census Geocoder (`geocoding.geo.census.gov`) | none | free |
| Geocode fallback | Google Geocoding API | API key | ~$5/1,000, free tier covers normal volume |
| Demographics, income, age, education | Census ACS 5-Year API | free key (instant signup) | free |
| Anchor tenants / retail density | Google Places API (New) — Nearby Search, **Pro tier only** (no `rating` field, keep it there) | API key | 5,000 free calls/mo; a single-agent site won't clear that |
| Vehicle traffic (AADT) | FDOT ArcGIS REST — `RCI_Layers/FeatureServer/0` | none | free |
| Flood risk | FEMA NFHL ArcGIS REST — `NFHL/MapServer` flood hazard layer | none | free |
| Crime/safety context | FBI Crime Data API | free key from api.data.gov | free |
| Consumer spending power | **Estimated** from Census income × BLS Consumer Expenditure Survey (South region) | n/a (static published tables) | free |
| Market comps / cap rate / rent-SF / vacancy | **Optional** — CoStar export Brent already has, attached at request time | Brent's existing CoStar subscription | already paid for |
| Narrative + grading synthesis | Claude API (Sonnet) | your existing key | pennies per report |

Every "estimated" figure is labeled as such in the UI and PDF — this matters
both for honesty and because Florida restricts the word "appraisal"/
"valuation" to licensed appraisers. The tool outputs a **Site Quality
Score**, not a valuation, and the PDF carries a disclaimer to that effect.
Anything sourced from an attached CoStar file is labeled "Agent-Provided"
and attributed to the filename in both the UI and the PDF.

## Cost control

- Every completed report (without a CoStar attachment) is cached in
  Postgres by rounded lat/lng (≈ same building) and business use for 60
  days — a repeat lookup costs $0. Reports with a CoStar file attached
  always regenerate, since the CoStar content is specific to that request.
- The whole site sits behind HTTP Basic Auth (`middleware.ts`) using
  `SITE_USERNAME`/`SITE_PASSWORD` — since this is a single-user internal
  tool, not a public lead-gen page, that's sufficient to keep it off random
  bots' radar and keep API usage to what Brent actually generates.
- PDF generation reads from the cached report data — no external API calls
  happen on a re-download, only the Puppeteer render.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · Drizzle + Neon Postgres
(free tier, used as a cache) · Puppeteer + `@sparticuz/chromium` (PDF
render, Vercel-serverless compatible) · `pdf-parse` / `xlsx` (optional
CoStar export text extraction)

## What's in this drop

- `middleware.ts` — HTTP Basic Auth gate for the whole site
- `src/lib/db/schema.ts` — report cache table (now includes CoStar
  provenance columns — see `drizzle/0002_costar_upload.sql`)
- `src/lib/data-sources/` — geocode, Census, Places, FDOT traffic, FEMA
  flood, FBI crime, BLS-derived spend estimate
- `src/lib/data-sources/costar-parse.ts` — best-effort text extraction
  from an optional agent-uploaded CoStar PDF/Excel/CSV export
- `src/lib/grader.ts` — scoring engine + Claude narrative generation
  (now also asks Claude to pull CoStar-sourced highlights when a file
  was attached)
- `src/lib/pdf-template.ts` — the PDF's HTML/CSS design (Domain Realty
  blue/white palette + logo, plus the "CoStar Market Data" section)
- `src/lib/logo.ts` — Domain Realty logo, inlined as a base64 data URI
- `src/app/api/analyze/route.ts` — orchestrates every data source, scores,
  caches, and generates the narrative; accepts multipart form data with
  an optional `costarFile`
- `src/app/api/report/[id]/pdf/route.ts` — renders the cached report to PDF
- `src/app/page.tsx` — the single input-and-results page, with the
  optional CoStar attach control

This is a complete, deployable first version. Remaining polish items:

1. **`fbi-crime.ts` ORI codes** already include Collier County (Naples),
   plus the neighboring Lee, Charlotte, and Sarasota counties. Extending
   further south/east is a 10-minute job in the `COUNTY_TO_ORI` map, or
   skip it entirely — the tool degrades gracefully without it.
2. FDOT/FEMA field names are noted as needing a live-hit sanity check.
3. CoStar's report layouts vary quite a bit by export type. The current
   approach (extract raw text/tabular content, let Claude pull out
   relevant figures) is deliberately format-agnostic rather than trying
   to hand-parse CoStar's PDF/Excel templates — if Brent finds Claude is
   missing obvious figures from a particular export type, the highlight
   *instructions* in `generateGradeNarrative()` (in `grader.ts`) are the
   place to tune, not a new parser.

## Setup notes

1. `npm install`
2. Copy `.env.example` → `.env.local` and fill in keys (Neon, Google, Census,
   FBI, Claude, plus `SITE_USERNAME`/`SITE_PASSWORD` for the Basic Auth gate)
3. `npx drizzle-kit push` to create the cache table on your Neon database
   (or run `drizzle/0000_init.sql`, `0001_business_profile.sql`, and
   `0002_costar_upload.sql` directly in Neon's SQL editor if you're
   migrating an existing database rather than starting fresh)
4. Deploy to Vercel, set the same env vars there, and set
   `NEXT_PUBLIC_APP_URL` to wherever it's hosted (e.g. a `scorecard.`
   subdomain of domainrealty.com)
5. FBI crime lookups cover Collier, Lee, Charlotte, Sarasota, Hillsborough,
   Pinellas, Pasco, Manatee, Hernando, Polk, Citrus, Orange, Palm Beach,
   Broward, and Miami-Dade counties out of the box — the ORI map in
   `fbi-crime.ts` is a 10-minute job to extend to more FL counties later
