/**
 * FEMA National Flood Hazard Layer (NFHL) — free, public, no API key.
 * A genuine differentiator for a Florida commercial site report — insurance
 * cost and financeability both hinge heavily on flood zone, and it's the
 * kind of thing an out-of-state investor won't think to check themselves.
 *
 * Source: https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer
 * Layer 28 = Flood Hazard Zones (confirm layer index is still current before
 * shipping — FEMA has renumbered NFHL layers before).
 */

const NFHL_ENDPOINT =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query'

export interface FloodZoneResult {
  zone: string
  isSpecialFloodHazardArea: boolean
  description: string
}

const ZONE_DESCRIPTIONS: Record<string, string> = {
  AE: 'High-risk flood zone with established base flood elevations — flood insurance required for federally backed financing.',
  A: 'High-risk flood zone, base flood elevations not determined — flood insurance required for federally backed financing.',
  AH: 'High-risk flood zone, shallow flooding (ponding) expected.',
  AO: 'High-risk flood zone, shallow flooding (sheet flow) expected.',
  VE: 'High-risk coastal zone with wave action — highest insurance cost tier, strict coastal construction standards apply.',
  X: 'Minimal flood risk — outside the 500-year floodplain.',
  'X (shaded)': 'Moderate flood risk — within the 500-year floodplain but outside the mandatory-insurance zone.',
}

/**
 * Point-in-polygon query against the flood hazard zone layer.
 * Returns null (not a hard error) if the point falls outside mapped areas
 * or the service is unavailable — flood data availability varies by county.
 */
export async function getFloodZone(lat: number, lng: number): Promise<FloodZoneResult | null> {
  const url = new URL(NFHL_ENDPOINT)
  url.searchParams.set('f', 'json')
  url.searchParams.set('geometry', `${lng},${lat}`)
  url.searchParams.set('geometryType', 'esriGeometryPoint')
  url.searchParams.set('inSR', '4326')
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects')
  url.searchParams.set('outFields', 'FLD_ZONE,SFHA_TF,ZONE_SUBTY')
  url.searchParams.set('returnGeometry', 'false')

  const res = await fetch(url.toString())
  if (!res.ok) {
    console.error(`FEMA NFHL query failed: ${res.status} ${res.statusText}`, await res.text().catch(() => ''))
    return null
  }

  const data = await res.json()
  const attrs = data?.features?.[0]?.attributes
  if (!attrs?.FLD_ZONE) {
    console.warn('FEMA NFHL returned no flood-zone feature for this point', JSON.stringify(data).slice(0, 500))
    return null
  }

  const zone: string = attrs.FLD_ZONE
  const isSfha = attrs.SFHA_TF === 'T' || attrs.SFHA_TF === true

  return {
    zone,
    isSpecialFloodHazardArea: isSfha,
    description:
      ZONE_DESCRIPTIONS[zone] ??
      `Flood zone ${zone}${attrs.ZONE_SUBTY ? ` (${attrs.ZONE_SUBTY})` : ''} — consult FEMA's flood map for full detail.`,
  }
}
