/**
 * Google Places API (New) — Nearby Search, anchor tenant + retail density.
 *
 * Adapted from ListOps' places-enrichment.ts. One change that matters for
 * cost: the field mask below intentionally OMITS `rating`/`userRatingCount`.
 * Requesting those bumps every call from the Pro SKU ($32/1,000) to the
 * Enterprise SKU ($35-40/1,000) for data we don't actually use in scoring.
 * Pro tier also carries a larger free monthly allotment (5,000 calls) —
 * at this site's expected volume that should mean $0/month in practice.
 */

const PLACES_API_KEY = process.env.GOOGLE_API_KEY
const SEARCH_RADIUS_METERS = 2414 // 1.5 miles

export type RetailerCategory =
  | 'big_box'
  | 'grocery'
  | 'pharmacy'
  | 'fast_food'
  | 'fast_casual'
  | 'coffee'
  | 'fitness'
  | 'hotel'
  | 'entertainment'
  | 'medical'
  | 'other'

export interface Retailer {
  name: string
  distanceMiles: number
  category: RetailerCategory
  lat: number
  lng: number
}

export class PlacesError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_API_KEY' | 'GEOCODE_FAILED' | 'PLACES_FAILED'
  ) {
    super(message)
    this.name = 'PlacesError'
  }
}

const TYPE_CATEGORY_MAP: Record<string, RetailerCategory> = {
  department_store: 'big_box',
  furniture_store: 'big_box',
  hardware_store: 'big_box',
  home_goods_store: 'big_box',
  home_improvement_store: 'big_box',
  discount_store: 'big_box',
  warehouse_store: 'big_box',
  electronics_store: 'big_box',
  shopping_mall: 'big_box',
  supermarket: 'grocery',
  grocery_store: 'grocery',
  pharmacy: 'pharmacy',
  drugstore: 'pharmacy',
  fast_food_restaurant: 'fast_food',
  meal_takeaway: 'fast_food',
  restaurant: 'fast_casual',
  cafe: 'coffee',
  coffee_shop: 'coffee',
  gym: 'fitness',
  fitness_center: 'fitness',
  yoga_studio: 'fitness',
  sports_club: 'fitness',
  movie_theater: 'entertainment',
  bowling_alley: 'entertainment',
  doctor: 'medical',
  medical_lab: 'medical',
  physiotherapist: 'medical',
  dental_clinic: 'medical',
  dentist: 'medical',
  hospital: 'medical',
  chiropractor: 'medical',
  medical_clinic: 'medical',
  medical_center: 'medical',
  // Note: NO 'lodging' → 'hotel' fallback here on purpose. Google's generic
  // "lodging" type covers everything from a Marriott to a single Airbnb/VRBO
  // unit, and there's no reliable signal in the free tier to tell them apart.
  // 'hotel' is name-matched only (see HOTEL_NAMES below) so a listing like
  // "Cozy 1-bedroom studio with AC" doesn't get counted as a demand
  // validator in the client-facing report.
}

const BIG_BOX_NAMES = [
  'walmart', 'target', 'costco', "sam's club", "bj's wholesale",
  'home depot', "lowe's", 'best buy', "dick's sporting goods",
  'tj maxx', 't.j. maxx', 'marshalls', 'ross', 'burlington',
  'five below', 'dollar tree', 'dollar general', 'family dollar',
]
const GROCERY_NAMES = [
  'publix', 'kroger', 'whole foods', 'trader joe', 'aldi', 'sprouts',
  'winn-dixie', 'food lion', 'safeway', 'wegmans', 'heb', 'sedano',
]
const FAST_CASUAL_NAMES = [
  'chipotle', 'panera', 'five guys', 'shake shack', 'sweetgreen',
  "chick-fil-a", "raising cane's", 'wingstop', 'panda express',
]
const FAST_FOOD_NAMES = [
  "mcdonald's", 'burger king', 'wendy', 'taco bell', 'subway',
  'domino', 'pizza hut', 'papa john', 'kfc', 'popeyes', 'sonic',
]
const COFFEE_NAMES = [
  'starbucks', 'dunkin', 'dutch bros', "peet's", 'caribou coffee', 'scooter\u2019s coffee',
]
const FITNESS_NAMES = [
  'planet fitness', 'la fitness', 'lifetime fitness', 'orangetheory', 'crunch fitness',
  'anytime fitness', "gold's gym", 'ymca', 'f45', 'club pilates', 'orange theory',
]
const HOTEL_NAMES = [
  'marriott', 'hilton', 'hampton inn', 'holiday inn', 'best western', 'comfort inn',
  'courtyard', 'residence inn', 'la quinta', 'days inn', 'super 8', 'extended stay',
]
const ENTERTAINMENT_NAMES = [
  'amc theatres', 'regal cinemas', 'cinemark', 'top golf', 'topgolf', 'dave & buster',
  'main event', 'bowlero',
]

function classifyByName(name: string): RetailerCategory | null {
  const lower = name.toLowerCase()
  if (BIG_BOX_NAMES.some((n) => lower.includes(n))) return 'big_box'
  if (GROCERY_NAMES.some((n) => lower.includes(n))) return 'grocery'
  if (COFFEE_NAMES.some((n) => lower.includes(n))) return 'coffee'
  if (FITNESS_NAMES.some((n) => lower.includes(n))) return 'fitness'
  if (HOTEL_NAMES.some((n) => lower.includes(n))) return 'hotel'
  if (ENTERTAINMENT_NAMES.some((n) => lower.includes(n))) return 'entertainment'
  if (FAST_CASUAL_NAMES.some((n) => lower.includes(n))) return 'fast_casual'
  if (FAST_FOOD_NAMES.some((n) => lower.includes(n))) return 'fast_food'
  return null
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Google's Nearby Search (New) caps maxResultCount at 20 per request. A
// single query across all 16+ included types, ranked by distance, means a
// site embedded in a restaurant row (like Busch Blvd) can have its entire
// 20-result budget consumed by food places before a pharmacy or grocery
// store half a mile out ever gets a chance to appear — which starves every
// non-food business profile (retail, medical, fitness, office) of the
// category data they actually need. Splitting into type-group queries
// gives each family (food, retail/service, hospitality/fitness) its own
// 20-result budget so density in one category can't crowd out another.
const FOOD_TYPES = ['fast_food_restaurant', 'meal_takeaway', 'restaurant', 'cafe', 'coffee_shop']
const RETAIL_SERVICE_TYPES = [
  'supermarket', 'grocery_store', 'department_store', 'discount_store', 'warehouse_store',
  'home_improvement_store', 'hardware_store', 'home_goods_store', 'electronics_store',
  'pharmacy', 'drugstore', 'shopping_mall', 'furniture_store',
]
const HOSPITALITY_FITNESS_TYPES = [
  'gym', 'fitness_center', 'yoga_studio', 'sports_club', 'lodging', 'movie_theater', 'bowling_alley',
]
const MEDICAL_TYPES = [
  'doctor', 'hospital', 'medical_lab', 'physiotherapist', 'dental_clinic', 'dentist',
  'chiropractor', 'medical_clinic', 'medical_center',
]

async function searchNearbyPlacesByTypes(lat: number, lng: number, includedTypes: string[]): Promise<any[]> {
  if (!PLACES_API_KEY) throw new PlacesError('GOOGLE_API_KEY is not configured', 'NO_API_KEY')

  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_API_KEY,
      // Pro-tier field mask only — no rating/reviews/atmosphere fields.
      'X-Goog-FieldMask': 'places.displayName,places.types,places.location',
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: SEARCH_RADIUS_METERS },
      },
      rankPreference: 'DISTANCE',
    }),
  })

  if (!res.ok) {
    throw new PlacesError(`Places API error ${res.status}: ${await res.text()}`, 'PLACES_FAILED')
  }
  const data = await res.json()
  return data.places ?? []
}

async function searchNearbyPlaces(lat: number, lng: number): Promise<any[]> {
  // Four separate requests instead of one — each type group gets its own
  // 20-result budget. Costs 4 Places calls per report instead of 1; still
  // free at this site's expected volume (Pro tier's free monthly
  // allotment is 5,000 calls), and every report is still cached for 60 days.
  const [food, retail, hospitality, medical] = await Promise.all([
    searchNearbyPlacesByTypes(lat, lng, FOOD_TYPES),
    searchNearbyPlacesByTypes(lat, lng, RETAIL_SERVICE_TYPES),
    searchNearbyPlacesByTypes(lat, lng, HOSPITALITY_FITNESS_TYPES),
    searchNearbyPlacesByTypes(lat, lng, MEDICAL_TYPES),
  ])
  return [...food, ...retail, ...hospitality, ...medical]
}

export async function getNearbyRetailers(lat: number, lng: number): Promise<Retailer[]> {
  const places = await searchNearbyPlaces(lat, lng)

  return places
    .map((p): Retailer | null => {
      const name = p.displayName?.text
      const placeLat = p.location?.latitude
      const placeLng = p.location?.longitude
      if (!name || !placeLat || !placeLng) return null

      const nameCategory = classifyByName(name)
      const typeCategory = p.types
        ?.map((t: string) => TYPE_CATEGORY_MAP[t])
        .find(Boolean) as RetailerCategory | undefined
      const category = nameCategory ?? typeCategory ?? 'other'
      if (category === 'other' && !nameCategory) return null

      return {
        name,
        distanceMiles: Math.round(haversineMiles(lat, lng, placeLat, placeLng) * 100) / 100,
        category,
        lat: placeLat,
        lng: placeLng,
      }
    })
    .filter((r): r is Retailer => r !== null)
    .filter((r, i, arr) => arr.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase()) === i)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
}
