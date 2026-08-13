import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  jsonb,
  serial,
  integer,
  boolean,
  index,
} from 'drizzle-orm/pg-core'

/**
 * A generated report, cached by rounded lat/lng so a repeat lookup of the
 * same building never re-triggers Places/Claude calls. Rounding to 4 decimal
 * places (~11m precision) is tight enough to distinguish neighboring parcels
 * while still catching "same address typed slightly differently."
 */
export const reports = pgTable(
  'reports',
  {
    id: serial('id').primaryKey(),
    inputAddress: text('input_address').notNull(),
    formattedAddress: text('formatted_address').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    latRounded: doublePrecision('lat_rounded').notNull(),
    lngRounded: doublePrecision('lng_rounded').notNull(),
    county: text('county'),
    stateFips: text('state_fips'),
    countyFips: text('county_fips'),
    tractFips: text('tract_fips'),

    // Which business use this report was scored for (qsr, restaurant,
    // medical, retail, etc.) — see src/lib/business-profiles.ts. Part of
    // the cache key: the same address scores differently per use, so a
    // cached row only satisfies a repeat lookup for the SAME profile.
    businessProfile: text('business_profile').notNull().default('general'),

    overallScore: doublePrecision('overall_score').notNull(),
    overallGrade: text('overall_grade').notNull(),

    // Per-category 0-100 scores
    categoryScores: jsonb('category_scores').notNull(),

    // Raw normalized data pulled from each source, kept for the PDF and
    // for debugging/re-rendering without re-fetching
    rawData: jsonb('raw_data').notNull(),

    // Claude-generated narrative — includes costarHighlights when a CoStar
    // export was attached (see hasCostarData below)
    narrative: jsonb('narrative'),

    // Optional agent-provided CoStar export (PDF/Excel/CSV) attached at
    // request time. We don't persist the file itself — only whether one was
    // used and its filename, for display/provenance in the UI and PDF. The
    // extracted highlights live inside `narrative.costarHighlights`.
    hasCostarData: boolean('has_costar_data').default(false).notNull(),
    costarFilename: text('costar_filename'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(), // cache TTL, default +60d
  },
  (table) => ({
    locationIdx: index('reports_location_idx').on(table.latRounded, table.lngRounded, table.businessProfile),
  })
)

/**
 * Simple sliding-window rate limit — one row per IP per UTC day.
 * Avoids standing up Redis for a volume this low.
 */
export const rateLimits = pgTable('rate_limits', {
  id: serial('id').primaryKey(),
  ip: text('ip').notNull(),
  day: text('day').notNull(), // 'YYYY-MM-DD'
  count: integer('count').default(1).notNull(),
  blocked: boolean('blocked').default(false).notNull(),
})

export type Report = typeof reports.$inferSelect
export type NewReport = typeof reports.$inferInsert
