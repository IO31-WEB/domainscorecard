import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, gte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { reports } from '@/lib/db/schema'
import { geocodeAddress } from '@/lib/data-sources/geocode'
import { getTractDemographics } from '@/lib/data-sources/census'
import { getNearbyRetailers } from '@/lib/data-sources/places'
import { getNearbyTrafficCounts } from '@/lib/data-sources/fdot-traffic'
import { getFloodZone } from '@/lib/data-sources/fema-flood'
import { getCrimeContext } from '@/lib/data-sources/fbi-crime'
import { estimateTradeAreaSpend } from '@/lib/data-sources/spend-estimate'
import { parseCostarFile } from '@/lib/data-sources/costar-parse'
import {
  redistributeWeights,
  computeOverallScore,
  scoreToGrade,
  scoreTraffic,
  scoreConsumerSpend,
  scoreDemographics,
  scoreRetailSynergy,
  scoreCompetitiveSaturation,
  scoreFloodRisk,
  scoreCrimeContext,
  generateGradeNarrative,
  getBusinessProfile,
  weightsForProfile,
  BUSINESS_PROFILES,
  type GradeWeights,
  type BusinessProfileId,
} from '@/lib/grader'

const CACHE_DAYS = 60
const COORD_PRECISION = 4 // ~11m — same building, different phrasing of the address

const requestSchema = z.object({
  address: z.string().min(5).max(200),
  // Which business use to score this site for — drives Retail Synergy vs.
  // Competitive Saturation and category weighting. Defaults to a balanced,
  // use-agnostic profile if the client omits it (e.g. older cached callers).
  businessProfile: z
    .enum(Object.keys(BUSINESS_PROFILES) as [BusinessProfileId, ...BusinessProfileId[]])
    .optional()
    .default('general'),
})

function round(n: number): number {
  const factor = 10 ** COORD_PRECISION
  return Math.round(n * factor) / factor
}

const MAX_COSTAR_FILE_BYTES = 15 * 1024 * 1024 // 15MB

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''

  let parsed: z.infer<typeof requestSchema>
  let costarFile: File | null = null

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      parsed = requestSchema.parse({
        address: form.get('address'),
        businessProfile: form.get('businessProfile') || undefined,
      })
      const maybeFile = form.get('costarFile')
      if (maybeFile instanceof File && maybeFile.size > 0) {
        if (maybeFile.size > MAX_COSTAR_FILE_BYTES) {
          return NextResponse.json({ error: 'CoStar file is too large (15MB max).' }, { status: 413 })
        }
        costarFile = maybeFile
      }
    } else {
      parsed = requestSchema.parse(await req.json())
    }
  } catch {
    return NextResponse.json({ error: 'Provide a valid street address.' }, { status: 400 })
  }

  const costarExtract = costarFile ? await parseCostarFile(costarFile) : null

  let geo
  try {
    geo = await geocodeAddress(parsed.address)
  } catch {
    return NextResponse.json(
      { error: "Couldn't locate that address. Try including city and state." },
      { status: 422 }
    )
  }

  const latRounded = round(geo.lat)
  const lngRounded = round(geo.lng)
  const profile = getBusinessProfile(parsed.businessProfile)

  // Serve from cache if we've already built this exact report (same address
  // AND same business profile) recently — the score is use-specific, so a
  // QSR analysis of an address can't be served from a medical-office cache
  // entry for the same address, even though the underlying Census/FDOT/
  // Places data is identical.
  const cached = costarExtract
    ? null
    : await db.query.reports.findFirst({
        where: and(
          eq(reports.latRounded, latRounded),
          eq(reports.lngRounded, lngRounded),
          eq(reports.businessProfile, profile.id),
          gte(reports.expiresAt, new Date())
        ),
      })
  if (cached) {
    return NextResponse.json({ reportId: cached.id, cached: true, ...serialize(cached) })
  }

  // Fan out to every free data source in parallel. Each is wrapped so one
  // source going down doesn't take out the whole report — missing data
  // gets redistributed in the scoring weights instead.
  // Demographics need tract FIPS (available from Census address match OR
  // the coordinates reverse-lookup after a Google fallback).
  const [demographics, retailers, trafficCounts, flood, crime] = await Promise.all([
    geo.tractFips && geo.stateFips && geo.countyFips
      ? getTractDemographics(geo).catch(() => null)
      : Promise.resolve(null),
    getNearbyRetailers(geo.lat, geo.lng).catch(() => []),
    getNearbyTrafficCounts(geo.lat, geo.lng).catch(() => []),
    getFloodZone(geo.lat, geo.lng).catch(() => null),
    geo.countyFips ? getCrimeContext(geo.countyFips).catch(() => null) : Promise.resolve(null),
  ])

  const spendEstimate = demographics
    ? estimateTradeAreaSpend(demographics.medianHouseholdIncome, demographics.population)
    : null

  const traffic = scoreTraffic(trafficCounts)
  const spend = scoreConsumerSpend(spendEstimate)
  const demo = scoreDemographics(demographics)
  const synergy = scoreRetailSynergy(retailers, profile)
  const saturation = scoreCompetitiveSaturation(retailers, profile)
  const flood_ = scoreFloodRisk(flood)
  const crime_ = scoreCrimeContext(crime)

  const categoryScores: Record<keyof GradeWeights, number> = {
    traffic: traffic.score,
    consumerSpend: spend.score,
    demographics: demo.score,
    retailSynergy: synergy.score,
    competitiveSaturation: saturation.score,
    floodRisk: flood_.score,
    crime: crime_.score,
  }

  const missing = (Object.entries({
    traffic: traffic.hasData, consumerSpend: spend.hasData, demographics: demo.hasData,
    retailSynergy: synergy.hasData, competitiveSaturation: saturation.hasData,
    floodRisk: flood_.hasData, crime: crime_.hasData,
  })
    .filter(([, hasData]) => !hasData)
    .map(([key]) => key)) as Array<keyof GradeWeights>

  const weights = redistributeWeights(weightsForProfile(profile), missing)
  const overallScore = computeOverallScore(categoryScores, weights)
  const overallGrade = scoreToGrade(overallScore)

  const rawData = {
    demographics,
    trafficCounts,
    synergyAnchors: synergy.anchors,
    saturationAnchors: saturation.anchors,
    saturationScored: saturation.hasData,
    flood,
    crime,
    spendEstimate,
  }

  const narrative = await generateGradeNarrative({
    address: geo.formattedAddress,
    businessProfile: profile,
    overallGrade,
    overallScore,
    categoryScores,
    synergyAnchors: synergy.anchors,
    saturationAnchors: saturation.anchors,
    demographics,
    trafficCounts,
    flood,
    crime,
    spendEstimate,
    costarText: costarExtract?.text ?? null,
    costarFilename: costarExtract?.filename ?? null,
  }).catch(() => null)

  const [inserted] = await db
    .insert(reports)
    .values({
      inputAddress: parsed.address,
      formattedAddress: geo.formattedAddress,
      lat: geo.lat,
      lng: geo.lng,
      latRounded,
      lngRounded,
      county: geo.countyName || null,
      stateFips: geo.stateFips || null,
      countyFips: geo.countyFips || null,
      tractFips: geo.tractFips || null,
      businessProfile: profile.id,
      overallScore,
      overallGrade,
      categoryScores,
      rawData,
      narrative,
      hasCostarData: Boolean(costarExtract),
      costarFilename: costarExtract?.filename ?? null,
      expiresAt: new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000),
    })
    .returning()

  return NextResponse.json({ reportId: inserted.id, cached: false, ...serialize(inserted) })
}

function serialize(report: typeof reports.$inferSelect) {
  return {
    formattedAddress: report.formattedAddress,
    businessProfile: report.businessProfile,
    overallScore: report.overallScore,
    overallGrade: report.overallGrade,
    categoryScores: report.categoryScores,
    rawData: report.rawData,
    narrative: report.narrative,
    hasCostarData: report.hasCostarData,
    costarFilename: report.costarFilename,
  }
}
