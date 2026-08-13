/**
 * Business-use profiles for the Site Quality Score.
 *
 * The same parcel can score very differently depending on what the client
 * intends to put there — a location that's excellent for a QSR drive-thru
 * may be mediocre for a medical office or a luxury retailer. Each profile
 * tells the grading engine (grader.ts) two things:
 *   1. Which nearby retail categories VALIDATE this use (Retail Synergy)
 *   2. Which nearby retail categories COMPETE with this use (Competitive
 *      Saturation)
 * and optionally overrides the default category weights so, e.g., traffic
 * matters more for a QSR than for a back-office use.
 *
 * Client-safe (no server-only imports) — same reasoning as grader-types.ts.
 * Import from here in Client Components; grader.ts re-exports for server code.
 */

import type { RetailerCategory } from './data-sources/places'
import type { GradeWeights } from './grader-types'
import { DEFAULT_WEIGHTS } from './grader-types'

export type BusinessProfileId =
  | 'qsr'
  | 'restaurant'
  | 'coffee'
  | 'retail'
  | 'medical'
  | 'fitness'
  | 'office'
  | 'industrial'
  | 'general'

export interface BusinessProfile {
  id: BusinessProfileId
  label: string
  description: string
  /** Nearby categories that validate demand/traffic for this use — score UP. */
  synergyCategories: RetailerCategory[]
  /** Nearby categories that represent direct competition for this use — score DOWN with density. */
  competitorCategories: RetailerCategory[]
  /** Optional override of the default category weights for this use type. */
  weights?: Partial<GradeWeights>
}

// Categories a QSR/restaurant/coffee concept should treat as validating
// demand rather than competing with it: national fast food/fast-casual/
// coffee traffic proves the trade area works.
const FOOD_SYNERGY: RetailerCategory[] = [
  'big_box', 'grocery', 'pharmacy', 'fast_food', 'fast_casual', 'coffee', 'fitness', 'hotel', 'entertainment',
]

export const BUSINESS_PROFILES: Record<BusinessProfileId, BusinessProfile> = {
  qsr: {
    id: 'qsr',
    label: 'QSR / Fast Food / Drive-Thru',
    description: 'Quick-service restaurant, drive-thru, or fast-casual concept.',
    synergyCategories: FOOD_SYNERGY,
    // Only other national/regional QSR chains count as saturation — an
    // independent sit-down restaurant nearby (gyros place, pizzeria, pub)
    // is a different format entirely and shouldn't ding a drive-thru
    // concept's score. Concept-level (burger vs. burger) granularity is a
    // separate, larger feature — this is format-level only.
    competitorCategories: ['fast_food'],
    weights: { traffic: 0.26, retailSynergy: 0.18, competitiveSaturation: 0.12, consumerSpend: 0.14, demographics: 0.16, floodRisk: 0.09, crime: 0.05 },
  },
  restaurant: {
    id: 'restaurant',
    label: 'Full-Service Restaurant',
    description: 'Sit-down or full-service restaurant concept.',
    synergyCategories: FOOD_SYNERGY,
    competitorCategories: ['fast_casual'],
    weights: { traffic: 0.20, retailSynergy: 0.17, competitiveSaturation: 0.10, consumerSpend: 0.17, demographics: 0.19, floodRisk: 0.11, crime: 0.06 },
  },
  coffee: {
    id: 'coffee',
    label: 'Coffee / Cafe Concept',
    description: 'Coffee shop, drive-thru coffee, or cafe concept.',
    synergyCategories: FOOD_SYNERGY,
    competitorCategories: ['coffee'],
    weights: { traffic: 0.24, retailSynergy: 0.18, competitiveSaturation: 0.10, consumerSpend: 0.14, demographics: 0.17, floodRisk: 0.11, crime: 0.06 },
  },
  retail: {
    id: 'retail',
    label: 'Retail / Storefront',
    description: 'General retail, boutique, or storefront use.',
    synergyCategories: ['big_box', 'grocery', 'pharmacy', 'fast_casual', 'coffee', 'entertainment'],
    competitorCategories: ['big_box'],
    weights: { traffic: 0.18, retailSynergy: 0.20, competitiveSaturation: 0.08, consumerSpend: 0.20, demographics: 0.20, floodRisk: 0.09, crime: 0.05 },
  },
  medical: {
    id: 'medical',
    label: 'Medical / Professional Office',
    description: 'Medical, dental, or professional/clinical office use.',
    synergyCategories: ['pharmacy', 'big_box', 'grocery'],
    // Now backed by a real Places search (doctor/hospital/dental/clinic
    // types) — previously left empty because that data wasn't being
    // fetched at all, which made "no competitors detected" a misleading
    // non-answer rather than an actual finding.
    competitorCategories: ['medical'],
    weights: { traffic: 0.12, retailSynergy: 0.08, competitiveSaturation: 0.08, consumerSpend: 0.20, demographics: 0.22, floodRisk: 0.20, crime: 0.10 },
  },
  fitness: {
    id: 'fitness',
    label: 'Fitness / Gym',
    description: 'Gym, studio, or fitness concept.',
    synergyCategories: ['big_box', 'grocery', 'coffee', 'fast_casual', 'hotel'],
    competitorCategories: ['fitness'],
    weights: { traffic: 0.18, retailSynergy: 0.16, competitiveSaturation: 0.10, consumerSpend: 0.18, demographics: 0.22, floodRisk: 0.10, crime: 0.06 },
  },
  office: {
    id: 'office',
    label: 'Office / Back Office',
    description: 'General office, corporate, or back-office use.',
    synergyCategories: ['coffee', 'fast_casual', 'fitness', 'hotel'],
    competitorCategories: [],
    weights: { traffic: 0.10, retailSynergy: 0.08, competitiveSaturation: 0.02, consumerSpend: 0.14, demographics: 0.26, floodRisk: 0.22, crime: 0.18 },
  },
  industrial: {
    id: 'industrial',
    label: 'Industrial / Warehouse / Flex',
    description: 'Industrial, warehouse, distribution, or flex-space use.',
    synergyCategories: [],
    competitorCategories: [],
    weights: { traffic: 0.16, retailSynergy: 0.02, competitiveSaturation: 0.02, consumerSpend: 0.06, demographics: 0.12, floodRisk: 0.32, crime: 0.30 },
  },
  general: {
    id: 'general',
    label: 'General Commercial (no specific use)',
    description: 'No specific business type selected — balanced, use-agnostic scoring.',
    synergyCategories: ['big_box', 'grocery', 'pharmacy', 'fast_casual'],
    competitorCategories: [],
    weights: DEFAULT_WEIGHTS,
  },
}

export const BUSINESS_PROFILE_LIST: BusinessProfile[] = Object.values(BUSINESS_PROFILES)

export function getBusinessProfile(id: string | null | undefined): BusinessProfile {
  return BUSINESS_PROFILES[(id as BusinessProfileId) ?? 'general'] ?? BUSINESS_PROFILES.general
}

export function weightsForProfile(profile: BusinessProfile): GradeWeights {
  return { ...DEFAULT_WEIGHTS, ...profile.weights }
}
