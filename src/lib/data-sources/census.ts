/**
 * Census Bureau data — free, public domain, no API key required for
 * geocoding (ACS pulls need a free key from api.census.gov/data/key_signup.html).
 *
 * Two calls:
 *  1. Geocoder — address → lat/lng + tract/county/state FIPS (one request,
 *     no separate geocode + geography lookup needed).
 *  2. ACS 5-Year Detailed Tables — demographics for that tract.
 *
 * We report at the CENSUS TRACT level (roughly a 1-4k person neighborhood)
 * rather than pretending to a precise "3-mile ring" the way paid aggregators
 * do — that precision isn't something free public data actually supports,
 * and overstating it would be exactly the kind of fake-precise number we're
 * trying to avoid. Tract + county-level context together give an honest,
 * still-compelling picture.
 */

const CENSUS_GEOCODER_BASE = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress'
const ACS_BASE = 'https://api.census.gov/data'
const CURRENT_VINTAGE = '2023' // latest ACS 5-year release at time of writing
const PRIOR_VINTAGE = '2018' // for 5-year growth comparison

const ACS_API_KEY = process.env.CENSUS_API_KEY

export class CensusError extends Error {
  constructor(message: string, public readonly code: 'GEOCODE_FAILED' | 'ACS_FAILED' | 'NO_KEY') {
    super(message)
    this.name = 'CensusError'
  }
}

export interface CensusGeography {
  lat: number
  lng: number
  formattedAddress: string
  stateFips: string
  countyFips: string
  tractFips: string
  countyName: string
}

export interface TractDemographics {
  population: number
  populationGrowth5yr: number // pct, comparing CURRENT_VINTAGE vs PRIOR_VINTAGE
  medianAge: number
  medianHouseholdIncome: number
  medianHomeValue: number
  ownerOccupiedPct: number
  bachelorsPlusPct: number
}

/**
 * Geocode an address and resolve its Census Tract/County/State FIPS codes
 * in a single free request.
 */
export async function geocodeWithCensus(address: string): Promise<CensusGeography> {
  const url = new URL(CENSUS_GEOCODER_BASE)
  url.searchParams.set('address', address)
  url.searchParams.set('benchmark', 'Public_AR_Current')
  url.searchParams.set('vintage', 'Current_Current')
  url.searchParams.set('layers', '8') // Census Tracts layer (verify against https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer if this ever breaks again)
  url.searchParams.set('format', 'json')

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new CensusError(`Census geocoder HTTP ${res.status}`, 'GEOCODE_FAILED')
  }

  const data = await res.json()
  const match = data?.result?.addressMatches?.[0]
  if (!match) {
    throw new CensusError(`Census geocoder found no match for: ${address}`, 'GEOCODE_FAILED')
  }

  const tractLayer = match.geographies?.['Census Tracts']?.[0]
  if (!tractLayer) {
    throw new CensusError('Census geocoder matched the address but returned no tract geography', 'GEOCODE_FAILED')
  }

  return {
    lat: match.coordinates.y,
    lng: match.coordinates.x,
    formattedAddress: match.matchedAddress,
    stateFips: tractLayer.STATE,
    countyFips: tractLayer.COUNTY,
    tractFips: tractLayer.TRACT,
    countyName: tractLayer.BASENAME ? `${tractLayer.BASENAME} County` : tractLayer.NAME,
  }
}

interface AcsRow {
  population: number | null
  medianAge: number | null
  medianHouseholdIncome: number | null
  medianHomeValue: number | null
  ownerOccupiedPct: number | null
  bachelorsPlusPct: number | null
}

const ACS_VARS = [
  'B01003_001E', // total population
  'B01002_001E', // median age
  'B19013_001E', // median household income
  'B25077_001E', // median home value
  'B25003_001E', // total occupied housing units
  'B25003_002E', // owner-occupied units
  'B15003_001E', // population 25+ (education universe)
  'B15003_022E', // bachelor's
  'B15003_023E', // master's
  'B15003_024E', // professional degree
  'B15003_025E', // doctorate
].join(',')

async function fetchAcsTract(
  vintage: string,
  stateFips: string,
  countyFips: string,
  tractFips: string
): Promise<AcsRow | null> {
  if (!ACS_API_KEY) {
    throw new CensusError(
      'CENSUS_API_KEY is not set — get a free key at api.census.gov/data/key_signup.html',
      'NO_KEY'
    )
  }

  const url = new URL(`${ACS_BASE}/${vintage}/acs/acs5`)
  url.searchParams.set('get', ACS_VARS)
  url.searchParams.set('for', `tract:${tractFips}`)
  url.searchParams.set('in', `state:${stateFips} county:${countyFips}`)
  url.searchParams.set('key', ACS_API_KEY)

  const res = await fetch(url.toString())
  if (!res.ok) {
    // Non-fatal: older vintage may not have this tract (redistricting), or
    // rate limit — caller decides whether to treat as missing data.
    return null
  }

  const rows: string[][] = await res.json()
  const [header, values] = rows
  if (!values) return null

  const get = (name: string) => {
    const idx = header.indexOf(name)
    const raw = values[idx]
    const num = Number(raw)
    return Number.isFinite(num) && num >= 0 ? num : null
  }

  const population = get('B01003_001E')
  const totalOccupied = get('B25003_001E')
  const ownerOccupied = get('B25003_002E')
  const eduUniverse = get('B15003_001E')
  const bachelorsPlus =
    (get('B15003_022E') ?? 0) +
    (get('B15003_023E') ?? 0) +
    (get('B15003_024E') ?? 0) +
    (get('B15003_025E') ?? 0)

  return {
    population,
    medianAge: get('B01002_001E'),
    medianHouseholdIncome: get('B19013_001E'),
    medianHomeValue: get('B25077_001E'),
    ownerOccupiedPct:
      totalOccupied && ownerOccupied != null ? (ownerOccupied / totalOccupied) * 100 : null,
    bachelorsPlusPct: eduUniverse ? (bachelorsPlus / eduUniverse) * 100 : null,
  }
}

/**
 * Pull current + prior-vintage ACS data for the tract and compute 5-year
 * population growth. If the prior vintage lookup fails (tract boundary
 * changed, etc.) we just omit growth rather than fail the whole report.
 */
export async function getTractDemographics(
  geo: Pick<CensusGeography, 'stateFips' | 'countyFips' | 'tractFips'>
): Promise<TractDemographics | null> {
  const [current, prior] = await Promise.all([
    fetchAcsTract(CURRENT_VINTAGE, geo.stateFips, geo.countyFips, geo.tractFips),
    fetchAcsTract(PRIOR_VINTAGE, geo.stateFips, geo.countyFips, geo.tractFips).catch(() => null),
  ])

  if (!current || current.population == null) return null

  let growth5yr = 0
  if (prior?.population) {
    growth5yr = ((current.population - prior.population) / prior.population) * 100
  }

  return {
    population: current.population,
    populationGrowth5yr: Math.round(growth5yr * 10) / 10,
    medianAge: current.medianAge ?? 0,
    medianHouseholdIncome: current.medianHouseholdIncome ?? 0,
    medianHomeValue: current.medianHomeValue ?? 0,
    ownerOccupiedPct: Math.round((current.ownerOccupiedPct ?? 0) * 10) / 10,
    bachelorsPlusPct: Math.round((current.bachelorsPlusPct ?? 0) * 10) / 10,
  }
}
