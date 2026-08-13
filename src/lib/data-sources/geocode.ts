import { geocodeWithCensus, CensusError, type CensusGeography } from './census'

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY
const CENSUS_COORDS_BASE = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates'

/**
 * Census geocoder fails on maybe 5-10% of real-world addresses (new
 * construction, nonstandard formatting, some rural routes). Google
 * Geocoding is the fallback — small per-call cost, but it only fires on
 * the minority of lookups the free option can't handle.
 *
 * When the Google path is used we still recover tract/county FIPS via the
 * free Census *coordinates* geocoder (point → geography). That keeps
 * demographics, crime (ORI by county), and spend estimates working even
 * for addresses Census can't match by street name — critical for new
 * construction like Water Street Tampa.
 */
export async function geocodeAddress(address: string): Promise<CensusGeography & { usedFallback: boolean }> {
  try {
    const result = await geocodeWithCensus(address)
    return { ...result, usedFallback: false }
  } catch (err) {
    if (!(err instanceof CensusError)) throw err
    if (!GOOGLE_API_KEY) throw err

    console.warn(`Census geocoder failed for "${address}", falling back to Google`, err.message)

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('address', address)
    url.searchParams.set('key', GOOGLE_API_KEY)

    const res = await fetch(url.toString())
    const data = await res.json()
    const match = data.results?.[0]
    if (!match) throw new Error(`Neither Census nor Google could geocode: ${address}`)

    const lat = match.geometry.location.lat as number
    const lng = match.geometry.location.lng as number

    // Recover FIPS so downstream ACS / crime / spend still work
    const geo = await lookupCensusGeographyByCoords(lat, lng)

    return {
      lat,
      lng,
      formattedAddress: match.formatted_address,
      stateFips: geo?.stateFips ?? '',
      countyFips: geo?.countyFips ?? '',
      tractFips: geo?.tractFips ?? '',
      countyName: geo?.countyName ?? '',
      usedFallback: true,
    }
  }
}

/**
 * Free Census coordinates → tract/county/state FIPS lookup.
 * Returns null (not throw) if the service is down so the report can still
 * complete with lat/lng only.
 */
async function lookupCensusGeographyByCoords(
  lat: number,
  lng: number
): Promise<Pick<CensusGeography, 'stateFips' | 'countyFips' | 'tractFips' | 'countyName'> | null> {
  try {
    const url = new URL(CENSUS_COORDS_BASE)
    url.searchParams.set('x', String(lng))
    url.searchParams.set('y', String(lat))
    url.searchParams.set('benchmark', 'Public_AR_Current')
    url.searchParams.set('vintage', 'Current_Current')
    url.searchParams.set('layers', '8') // Census Tracts
    url.searchParams.set('format', 'json')

    const res = await fetch(url.toString())
    if (!res.ok) {
      console.warn(`Census coordinates geocoder HTTP ${res.status}`)
      return null
    }
    const data = await res.json()
    const tract = data?.result?.geographies?.['Census Tracts']?.[0]
    if (!tract) {
      console.warn('Census coordinates geocoder returned no tract for', lat, lng)
      return null
    }
    return {
      stateFips: tract.STATE,
      countyFips: tract.COUNTY,
      tractFips: tract.TRACT,
      countyName: tract.BASENAME ? `${tract.BASENAME} County` : tract.NAME,
    }
  } catch (e) {
    console.warn('Census coordinates geocoder error', e)
    return null
  }
}
