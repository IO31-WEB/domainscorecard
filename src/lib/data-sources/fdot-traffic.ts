/**
 * FDOT (Florida Department of Transportation) traffic counts — free, public,
 * no API key. Replaces the "traffic" category that ListOps' ATTOM integration
 * left empty (ATTOM doesn't include traffic without a separate paid add-on).
 *
 * Source: FDOT Transportation Data & Analytics, Annual Average Daily Traffic
 * (AADT) layer, published via ArcGIS REST.
 * https://gis.fdot.gov/arcgis/rest/services/RCI_Layers/FeatureServer/0
 *
 * NOTE: verify the exact field names (AADT confirmed; road-name field may be
 * ROADWAY, RDWYID, or similar depending on the current schema) by hitting
 * the endpoint directly before shipping — FDOT updates this layer annually
 * each April and field names have shifted across releases in the past.
 */

const FDOT_AADT_ENDPOINT =
  'https://gis.fdot.gov/arcgis/rest/services/RCI_Layers/FeatureServer/0/query'

export interface TrafficCount {
  aadt: number
  roadway: string | null
  descFrom: string | null
  descTo: string | null
  distanceMiles: number
}

function milesToMeters(mi: number): number {
  return mi * 1609.34
}

/**
 * Query FDOT's AADT layer for any road segments intersecting a buffer around
 * the subject point. Returns the segments sorted by traffic volume descending.
 * Non-fatal on failure — callers should treat `[]` as "no data" rather than
 * blocking the whole report on a state GIS outage.
 */
export async function getNearbyTrafficCounts(
  lat: number,
  lng: number,
  radiusMiles = 0.75
): Promise<TrafficCount[]> {
  const url = new URL(FDOT_AADT_ENDPOINT)
  url.searchParams.set('f', 'json')
  url.searchParams.set('geometry', `${lng},${lat}`)
  url.searchParams.set('geometryType', 'esriGeometryPoint')
  url.searchParams.set('inSR', '4326')
  url.searchParams.set('outSR', '4326')
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects')
  url.searchParams.set('distance', String(milesToMeters(radiusMiles)))
  url.searchParams.set('units', 'esriSRUnit_Meter')
  url.searchParams.set('outFields', '*')
  url.searchParams.set('returnGeometry', 'true')
  url.searchParams.set('resultRecordCount', '25')

  const res = await fetch(url.toString())
  if (!res.ok) return []

  const data = await res.json()
  const features: any[] = data?.features ?? []
  if (!features.length) return []

  const counts: TrafficCount[] = features
    .map((f) => {
      const attrs = f.attributes ?? {}
      const aadt = Number(attrs.AADT)
      if (!Number.isFinite(aadt) || aadt <= 0) return null

      // Approximate distance using the first vertex of the segment geometry
      // if available — good enough for "how close is this road" ranking.
      let distanceMiles = 0
      const firstPoint = f.geometry?.paths?.[0]?.[0]
      if (firstPoint) {
        const [segLng, segLat] = firstPoint
        const R = 3958.8
        const dLat = ((segLat - lat) * Math.PI) / 180
        const dLng = ((segLng - lng) * Math.PI) / 180
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((lat * Math.PI) / 180) * Math.cos((segLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
        distanceMiles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      }

      return {
        aadt,
        // NOTE: FDOT's ROADWAY field is a coded route ID (e.g. "10190000"),
        // not a human-readable street name — kept here for reference/debug
        // but never shown to end users. DESC_FRM/DESC_TO describe the
        // count-segment's cross streets and are what's actually readable.
        roadway: attrs.ROADWAY ?? attrs.RDWYID ?? attrs.COSITE ?? null,
        descFrom: attrs.DESC_FRM ?? null,
        descTo: attrs.DESC_TO ?? null,
        distanceMiles: Math.round(distanceMiles * 100) / 100,
      }
    })
    .filter((c): c is TrafficCount => c !== null)
    .sort((a, b) => b.aadt - a.aadt)

  return counts
}
