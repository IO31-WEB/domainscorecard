/**
 * Site Quality Scoring Engine — adapted from ListOps' property-grader.ts.
 *
 * Deliberately called a "Site Quality Score," never an "appraisal" or
 * "valuation" — Florida reserves that language for licensed appraisers.
 * This is a due-diligence starting point for investors/business owners,
 * not a substitute for professional inspection, survey, or appraisal —
 * that disclaimer belongs on every PDF this engine produces.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { TrafficCount } from './data-sources/fdot-traffic'
import type { Retailer } from './data-sources/places'
import type { TractDemographics } from './data-sources/census'
import type { SpendEstimate } from './data-sources/spend-estimate'
import type { FloodZoneResult } from './data-sources/fema-flood'
import type { CrimeContext } from './data-sources/fbi-crime'
import {
  type GradeWeights,
  DEFAULT_WEIGHTS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  scoreToGrade,
} from './grader-types'
import {
  type BusinessProfile,
  type BusinessProfileId,
  BUSINESS_PROFILES,
  BUSINESS_PROFILE_LIST,
  getBusinessProfile,
  weightsForProfile,
} from './business-profiles'

// Re-exported so existing server-side imports of these from grader.ts
// keep working. Client Components should import these directly from
// './grader-types' or './business-profiles' instead, to avoid bundling the
// Anthropic SDK below.
export { type GradeWeights, DEFAULT_WEIGHTS, CATEGORY_LABELS, CATEGORY_ORDER, scoreToGrade }
export {
  type BusinessProfile,
  type BusinessProfileId,
  BUSINESS_PROFILES,
  BUSINESS_PROFILE_LIST,
  getBusinessProfile,
  weightsForProfile,
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// ── Traffic Score (unchanged benchmarks — AADT is AADT regardless of source) ──

export function scoreTraffic(counts: TrafficCount[]): { score: number; hasData: boolean } {
  if (!counts.length) return { score: 40, hasData: false }

  const primary = counts.filter((c) => c.distanceMiles <= 0.5).sort((a, b) => b.aadt - a.aadt)[0]
  const secondary = counts.filter((c) => c.distanceMiles <= 1.0).sort((a, b) => b.aadt - a.aadt)[0]
  const volume = primary?.aadt ?? secondary?.aadt ?? 0

  let score: number
  if (volume >= 50_000) score = 100
  else if (volume >= 40_000) score = 95
  else if (volume >= 30_000) score = 88
  else if (volume >= 20_000) score = 80
  else if (volume >= 15_000) score = 72
  else if (volume >= 10_000) score = 63
  else if (volume >= 5_000)  score = 52
  else if (volume >= 2_000)  score = 40
  else score = 25

  return { score, hasData: true }
}

// ── Consumer Spend Score ──────────────────────────────────────
// Calibrated to CENSUS TRACT scale aggregate spend (typical FL tract:
// 2,000-8,000 residents), NOT the 3-5 mile trade-area scale ATTOM/ESRI
// report at — these are a different geography and shouldn't share thresholds.

export function scoreConsumerSpend(estimate: SpendEstimate | null): { score: number; hasData: boolean } {
  if (!estimate) return { score: 40, hasData: false }
  const totalM = estimate.estimatedTradeAreaSpendTotal / 1_000_000

  let score: number
  if (totalM >= 250) score = 100
  else if (totalM >= 200) score = 92
  else if (totalM >= 150) score = 84
  else if (totalM >= 120) score = 76
  else if (totalM >= 90)  score = 68
  else if (totalM >= 65)  score = 58
  else if (totalM >= 40)  score = 46
  else if (totalM >= 20)  score = 34
  else score = 22

  return { score, hasData: true }
}

// ── Demographics Score ────────────────────────────────────────
// Population thresholds recalibrated for TRACT scale, not 3-mile-ring scale.

export function scoreDemographics(demo: TractDemographics | null): { score: number; hasData: boolean } {
  if (!demo) return { score: 40, hasData: false }

  let score = 0

  // Population (tract-scale) — 25 pts
  if (demo.population >= 8_000)      score += 25
  else if (demo.population >= 6_000) score += 22
  else if (demo.population >= 4_500) score += 18
  else if (demo.population >= 3_000) score += 14
  else if (demo.population >= 1_500) score += 9
  else                                score += 4

  // 5yr growth — 20 pts
  if (demo.populationGrowth5yr >= 15)      score += 20
  else if (demo.populationGrowth5yr >= 10) score += 16
  else if (demo.populationGrowth5yr >= 5)  score += 11
  else if (demo.populationGrowth5yr >= 0)  score += 6
  else                                      score += 0

  // Bachelor's+ — 20 pts
  if (demo.bachelorsPlusPct >= 45)      score += 20
  else if (demo.bachelorsPlusPct >= 35) score += 16
  else if (demo.bachelorsPlusPct >= 25) score += 12
  else if (demo.bachelorsPlusPct >= 15) score += 7
  else                                   score += 3

  // Median age suitability — 15 pts
  if (demo.medianAge >= 30 && demo.medianAge <= 55) score += 15
  else if (demo.medianAge >= 25 && demo.medianAge <= 60) score += 10
  else score += 5

  // Median household income — 20 pts
  if (demo.medianHouseholdIncome >= 110_000)      score += 20
  else if (demo.medianHouseholdIncome >= 90_000)  score += 16
  else if (demo.medianHouseholdIncome >= 70_000)  score += 12
  else if (demo.medianHouseholdIncome >= 50_000)  score += 7
  else                                              score += 3

  return { score: Math.min(100, score), hasData: true }
}

// ── Retail Synergy + Competitive Saturation (business-profile-aware) ──
//
// Replaces the old single "Anchor Tenant" score, which treated ANY nearby
// fast food within 0.5mi as an automatic -2 penalty regardless of what the
// client was building. That's wrong for QSR/restaurant/franchise site
// selection, where nearby national fast food/fast-casual/coffee brands
// validate traffic and consumer demand rather than hurting the site.
//
// Retail Synergy: does nearby activity validate demand for THIS use?
// Competitive Saturation: does nearby activity directly compete with THIS
// use? Only categories in the selected profile's `competitorCategories`
// count against the score — e.g. a QSR profile treats other QSR/fast-casual
// concepts as competition, but a medical office profile has none, so
// competitive saturation stays neutral and its weight gets redistributed.

const BIG_BOX = new Set(['big_box'])

export type ScoredAnchor = {
  name: string
  distanceMiles: number
  impact: string
  lat?: number
  lng?: number
}

export function scoreRetailSynergy(
  retailers: Retailer[],
  profile: BusinessProfile
): { score: number; hasData: boolean; anchors: ScoredAnchor[] } {
  if (!retailers.length) return { score: 50, hasData: false, anchors: [] }

  // A category can't validate demand for a use AND directly compete with
  // that same use at the same time — if it's this profile's own
  // competitor category (e.g. "fast_casual" for a Full-Service Restaurant
  // profile), exclude it from synergy scoring even though it's part of
  // the broader FOOD_SYNERGY set shared across profiles. Without this, the
  // same nearby business (e.g. a sushi restaurant) was being counted twice
  // in opposite directions: once as a synergy bonus, once as a saturation
  // penalty, and shown in both lists on the report.
  const competitorCategories = new Set(profile.competitorCategories)
  const synergyCategories = profile.synergyCategories.filter((c) => !competitorCategories.has(c))
  if (!synergyCategories.length) return { score: 50, hasData: false, anchors: [] }

  let score = 50
  const anchors: ScoredAnchor[] = []
  const synergy = new Set(synergyCategories)

  for (const r of retailers) {
    if (!synergy.has(r.category)) continue

    const isClose = r.distanceMiles <= 0.5
    const isNearby = r.distanceMiles <= 1.0
    let points = 0

    if (BIG_BOX.has(r.category) && isClose) points = 18
    else if (BIG_BOX.has(r.category) && isNearby) points = 12
    else if (BIG_BOX.has(r.category)) points = 6
    else if (r.category === 'grocery' && isClose) points = 12
    else if (r.category === 'grocery' && isNearby) points = 8
    else if (r.category === 'grocery') points = 4
    else if (r.category === 'pharmacy' && isClose) points = 5
    else if (r.category === 'pharmacy') points = 3
    else if ((r.category === 'fast_casual' || r.category === 'coffee') && isClose) points = 5
    else if (r.category === 'fast_casual' || r.category === 'coffee') points = 3
    // National QSR is a positive traffic/demand validator for food-adjacent
    // profiles — this is the direct fix to the old "-2 near fast food" rule.
    else if (r.category === 'fast_food' && isClose) points = 4
    else if (r.category === 'fast_food') points = 2
    else if ((r.category === 'fitness' || r.category === 'hotel' || r.category === 'entertainment') && isClose) points = 4
    else if (r.category === 'fitness' || r.category === 'hotel' || r.category === 'entertainment') points = 2

    if (points === 0) continue
    score = Math.max(0, Math.min(100, score + points))
    anchors.push({ name: r.name, distanceMiles: r.distanceMiles, impact: 'positive', lat: r.lat, lng: r.lng })
  }

  return { score: Math.min(100, score), hasData: true, anchors }
}

export function scoreCompetitiveSaturation(
  retailers: Retailer[],
  profile: BusinessProfile
): { score: number; hasData: boolean; anchors: ScoredAnchor[] } {
  // No defined competitor set for this use (e.g. medical, office, industrial)
  // means we have no honest signal — stay neutral and redistribute weight
  // rather than penalizing a site for unrelated nearby businesses.
  if (!profile.competitorCategories.length) return { score: 50, hasData: false, anchors: [] }
  if (!retailers.length) return { score: 50, hasData: false, anchors: [] }

  const competitors = new Set(profile.competitorCategories)
  const anchors: ScoredAnchor[] = []
  let closeCount = 0
  let nearbyCount = 0

  for (const r of retailers) {
    if (!competitors.has(r.category)) continue
    if (r.distanceMiles <= 0.5) closeCount++
    else if (r.distanceMiles <= 1.0) nearbyCount++
    else continue
    anchors.push({ name: r.name, distanceMiles: r.distanceMiles, impact: 'negative', lat: r.lat, lng: r.lng })
  }

  // Start neutral-high (competition alone isn't disqualifying — plenty of
  // trade areas support several like concepts) and step down with density.
  let score = 85 - closeCount * 12 - nearbyCount * 5
  score = Math.max(10, Math.min(100, score))

  return { score, hasData: true, anchors }
}

// ── Flood Risk Score (new — high value for FL investors) ─────
// Framed positively as "resilience": lower flood exposure = higher score.

export function scoreFloodRisk(flood: FloodZoneResult | null): { score: number; hasData: boolean } {
  if (!flood) return { score: 55, hasData: false } // neutral default, weight redistributed

  const zone = flood.zone.toUpperCase()
  let score: number
  if (zone === 'X' && !flood.isSpecialFloodHazardArea) score = 100
  else if (zone.startsWith('X')) score = 78 // shaded X — 500yr floodplain
  else if (zone === 'AH' || zone === 'AO') score = 60
  else if (zone === 'VE') score = 25 // coastal high-hazard, wave action
  else if (zone.startsWith('A')) score = 45 // A, AE — high-risk, no wave action
  else score = 55

  return { score, hasData: true }
}

// ── Crime Context Score (new — deliberately conservative) ─────
// Jurisdiction-level data is coarse, not hyperlocal — this category is
// intentionally lower-weighted and scores primarily off trend direction
// rather than pretending false precision from an absolute count.

export function scoreCrimeContext(crime: CrimeContext | null): { score: number; hasData: boolean } {
  // No agency data at all → redistribute weight away from this category
  if (!crime) return { score: 55, hasData: false }

  // We have jurisdiction data — score off trend when available, else neutral
  const score =
    crime.trend === 'improving' ? 70
    : crime.trend === 'worsening' ? 40
    : 55 // flat or unknown
  return { score, hasData: true }
}

// ── Weights + redistribution ───────────────────────────────────
// (GradeWeights, DEFAULT_WEIGHTS, CATEGORY_LABELS now live in ./grader-types)

/**
 * When a category has no data, redistribute its weight proportionally
 * across the remaining categories so missing free-data coverage doesn't
 * unfairly tank the score.
 */
export function redistributeWeights(
  weights: GradeWeights,
  missing: Array<keyof GradeWeights>
): GradeWeights {
  if (!missing.length) return weights

  const missingWeight = missing.reduce((sum, k) => sum + weights[k], 0)
  const remaining = 1 - missingWeight
  const factor = remaining > 0 ? 1 / remaining : 1

  const result = { ...weights }
  for (const key of Object.keys(result) as Array<keyof GradeWeights>) {
    result[key] = missing.includes(key) ? 0 : result[key] * factor
  }
  return result
}

export function computeOverallScore(
  scores: Record<keyof GradeWeights, number>,
  weights: GradeWeights
): number {
  return (Object.keys(weights) as Array<keyof GradeWeights>).reduce(
    (sum, key) => sum + scores[key] * weights[key],
    0
  )
}

// ── AI Narrative Generation ───────────────────────────────────

export interface GradeNarrative {
  summary: string
  strengths: string[]
  risks: string[]
  recommendation: string
  /** Present only when an agent-provided CoStar export was attached to this report. */
  costarHighlights: string[]
  tokensUsed: number
}

export async function generateGradeNarrative(opts: {
  address: string
  businessProfile: BusinessProfile
  overallGrade: string
  overallScore: number
  categoryScores: Record<keyof GradeWeights, number>
  synergyAnchors: ScoredAnchor[]
  saturationAnchors: ScoredAnchor[]
  demographics: TractDemographics | null
  trafficCounts: TrafficCount[]
  flood: FloodZoneResult | null
  crime: CrimeContext | null
  spendEstimate: SpendEstimate | null
  /** Raw extracted text from an agent-attached CoStar export, if any. */
  costarText?: string | null
  costarFilename?: string | null
}): Promise<GradeNarrative> {
  const topTraffic = opts.trafficCounts.slice(0, 2)
  const PLACEHOLDER = new Set(['n/a', 'na', 'none', 'null', 'unknown', '-'])
  const usable = (v: string | null | undefined): v is string => !!v && !PLACEHOLDER.has(v.trim().toLowerCase())
  const describeTrafficSegment = (t: (typeof topTraffic)[number]): string => {
    const from = usable(t.descFrom) ? t.descFrom : null
    const to = usable(t.descTo) ? t.descTo : null
    if (from && to) return `${from} to ${to}`
    if (from) return `near ${from}`
    return 'nearby segment'
  }

  const costarSection = opts.costarText
    ? `\n\nThe agent also attached a CoStar export (${opts.costarFilename ?? 'file'}) for this property or its market. Treat this as licensed, paid market data that is MORE authoritative than the free public-data estimates above wherever the two overlap (e.g. comps, cap rates, rent/SF, vacancy, absorption). Pull out the figures from it that are actually relevant to this specific address and business use — ignore boilerplate, headers, and unrelated comps. Raw extracted content follows, truncated:\n"""\n${opts.costarText}\n"""`
    : ''

  const costarInstruction = opts.costarText
    ? `\n  "costarHighlights": ["3-6 short bullet points pulling the most relevant figures/facts out of the attached CoStar export for this specific property and use — e.g. comparable sales, cap rate, asking rent/SF, vacancy, absorption trend. Each bullet should be a specific data point, not a generic statement. If the CoStar export doesn't contain anything usable for this address, return an empty array."]`
    : ''

  const prompt = `You are a senior commercial real estate analyst writing for investors and business owners evaluating a Florida property — NOT for a licensed appraisal. Never use the words "appraisal," "appraised value," or "valuation." This is a Site Quality Score, a due-diligence starting point, and it is being scored SPECIFICALLY for the intended business use below — not as a generic "good commercial property" rating.

Property: ${opts.address}
Intended use: ${opts.businessProfile.label} (${opts.businessProfile.description})
Overall Site Quality Score for this use: ${opts.overallGrade} (${opts.overallScore.toFixed(1)}/100)

Category scores:
- Traffic: ${opts.categoryScores.traffic.toFixed(1)}/100 — ${topTraffic.map(t => `${describeTrafficSegment(t)} (${t.aadt.toLocaleString()} AADT)`).join(', ') || 'no traffic count data available'}
- Estimated spending power: ${opts.categoryScores.consumerSpend.toFixed(1)}/100${opts.spendEstimate ? ` — est. $${(opts.spendEstimate.estimatedTradeAreaSpendTotal / 1_000_000).toFixed(0)}M annual trade-area spend (estimated, not reported)` : ''}
- Demographics: ${opts.categoryScores.demographics.toFixed(1)}/100${opts.demographics ? ` — ${opts.demographics.population.toLocaleString()} pop, ${opts.demographics.populationGrowth5yr}% 5yr growth, median income $${opts.demographics.medianHouseholdIncome.toLocaleString()}, median age ${opts.demographics.medianAge}` : ''}
- Retail synergy (nearby businesses that validate demand for this specific use): ${opts.categoryScores.retailSynergy.toFixed(1)}/100 — ${opts.synergyAnchors.length ? opts.synergyAnchors.map(a => `${a.name} (${a.distanceMiles}mi)`).join(', ') : 'no demand-validating businesses detected nearby'}
- Competitive saturation (nearby businesses that directly compete with this specific use): ${opts.categoryScores.competitiveSaturation.toFixed(1)}/100 — ${opts.saturationAnchors.length ? opts.saturationAnchors.map(a => `${a.name} (${a.distanceMiles}mi)`).join(', ') : 'no direct competitors detected nearby, or not applicable to this use'}
- Flood resilience: ${opts.categoryScores.floodRisk.toFixed(1)}/100${opts.flood ? ` — FEMA zone ${opts.flood.zone}, ${opts.flood.isSpecialFloodHazardArea ? 'within' : 'outside'} the Special Flood Hazard Area` : ' — no FEMA flood zone data available'}
- Safety context: ${opts.categoryScores.crime.toFixed(1)}/100${opts.crime ? ` — ${opts.crime.agencyName}, trend ${opts.crime.trend}` : ' — jurisdiction-level crime data not available for this area'}${costarSection}

Respond in this exact JSON format (no markdown, no prose outside JSON):
{
  "summary": "2-3 sentence executive summary written for an investor or business owner deciding whether this site is worth pursuing",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "risks": ["risk 1", "risk 2"],
  "recommendation": "1 sentence next-step recommendation (e.g. 'worth an in-person site visit and formal due diligence' — never a buy/pass verdict framed as professional advice)"${costarInstruction}
}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  })

  const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0)
  const raw = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')
    .replace(/^```json\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    const parsed = JSON.parse(raw)
    return {
      summary: parsed.summary ?? '',
      strengths: parsed.strengths ?? [],
      risks: parsed.risks ?? [],
      recommendation: parsed.recommendation ?? '',
      costarHighlights: Array.isArray(parsed.costarHighlights) ? parsed.costarHighlights : [],
      tokensUsed,
    }
  } catch {
    return {
      summary: `This site scored ${opts.overallGrade} (${opts.overallScore.toFixed(1)}/100) on our Site Quality Score.`,
      strengths: [],
      risks: [],
      recommendation: 'Manual review recommended.',
      costarHighlights: [],
      tokensUsed,
    }
  }
}
