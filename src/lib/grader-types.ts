/**
 * Client-safe types and constants split out of grader.ts.
 *
 * grader.ts instantiates the Anthropic SDK at module scope, so anything
 * that imports from grader.ts gets pulled into the same bundle. Client
 * Components (e.g. src/app/page.tsx) must import from THIS file instead
 * — never from grader.ts — or the Anthropic client (and the server-only
 * ANTHROPIC_API_KEY env var it wraps) gets bundled into browser JS.
 */

export interface GradeWeights {
  traffic: number
  consumerSpend: number
  demographics: number
  retailSynergy: number
  competitiveSaturation: number
  floodRisk: number
  crime: number
}

/**
 * "Anchor Tenants & Retail" (single score, fast-food-is-always-bad) is
 * replaced by two categories that can point in opposite directions for the
 * same nearby business, depending on what the user is trying to build:
 *  - retailSynergy: does nearby activity validate traffic/demand for THIS use?
 *  - competitiveSaturation: is nearby activity direct competition for THIS use?
 * See ./business-profiles.ts for how each business profile weights these.
 */
export const DEFAULT_WEIGHTS: GradeWeights = {
  traffic: 0.20,
  consumerSpend: 0.16,
  demographics: 0.20,
  retailSynergy: 0.16,
  competitiveSaturation: 0.10,
  floodRisk: 0.11,
  crime: 0.07,
}

export const CATEGORY_LABELS: Record<keyof GradeWeights, string> = {
  traffic: 'Traffic Exposure',
  consumerSpend: 'Spending Power (Est.)',
  demographics: 'Demographics',
  retailSynergy: 'Retail Synergy',
  competitiveSaturation: 'Competitive Saturation',
  floodRisk: 'Flood Resilience',
  crime: 'Safety Context',
}

const GRADE_THRESHOLDS: Array<{ min: number; grade: string }> = [
  { min: 97, grade: 'A+' }, { min: 93, grade: 'A' }, { min: 90, grade: 'A-' },
  { min: 87, grade: 'B+' }, { min: 83, grade: 'B' }, { min: 80, grade: 'B-' },
  { min: 77, grade: 'C+' }, { min: 73, grade: 'C' }, { min: 70, grade: 'C-' },
  { min: 67, grade: 'D+' }, { min: 63, grade: 'D' }, { min: 60, grade: 'D-' },
  { min: 0,  grade: 'F' },
]

export function scoreToGrade(score: number): string {
  return GRADE_THRESHOLDS.find((t) => score >= t.min)?.grade ?? 'F'
}
