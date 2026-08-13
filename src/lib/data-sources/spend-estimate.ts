/**
 * Estimated household spending power — NOT a substitute for a licensed data
 * aggregator's consumer-spend product (ATTOM/ESRI), and the PDF must always
 * label this as an estimate, never as "reported" spend data.
 *
 * Method: BLS Consumer Expenditure Survey publishes average annual
 * expenditures by income quintile every December. We interpolate a
 * household's expected annual spending from its income using those
 * published anchor points, then multiply by the tract's household count.
 *
 * Source: BLS Consumer Expenditures News Release, 2024 data (released
 * 2025-12-19) — Table C. https://www.bls.gov/news.release/cesan.htm
 * ⚠ Update INCOME_BOUNDS and QUINTILE_SPEND every December when BLS
 * publishes the next year's release — these are real published national
 * figures, not placeholders, but they go stale annually.
 */

// Lower income bound for each quintile (2024)
const INCOME_BOUNDS = [0, 29_932, 57_452, 94_511, 155_925]
// Average annual expenditure for consumer units in that quintile (2024)
const QUINTILE_SPEND = [35_046, 50_054, 66_900, 89_972, 150_342]

/**
 * Piecewise-linear interpolation between BLS's published quintile anchor
 * points. Deliberately simple — this is meant to produce a defensible
 * planning-level estimate, not a precise figure.
 */
function estimateHouseholdSpend(medianHouseholdIncome: number): number {
  if (medianHouseholdIncome <= INCOME_BOUNDS[0]) return QUINTILE_SPEND[0]

  for (let i = 1; i < INCOME_BOUNDS.length; i++) {
    if (medianHouseholdIncome <= INCOME_BOUNDS[i]) {
      const x0 = INCOME_BOUNDS[i - 1]
      const x1 = INCOME_BOUNDS[i]
      const y0 = QUINTILE_SPEND[i - 1]
      const y1 = QUINTILE_SPEND[i]
      const t = (medianHouseholdIncome - x0) / (x1 - x0)
      return y0 + t * (y1 - y0)
    }
  }

  // Above the top published bound — extrapolate using the top quintile's
  // rate of increase rather than flatlining.
  const slope =
    (QUINTILE_SPEND[4] - QUINTILE_SPEND[3]) / (INCOME_BOUNDS[4] - INCOME_BOUNDS[3])
  return QUINTILE_SPEND[4] + slope * (medianHouseholdIncome - INCOME_BOUNDS[4])
}

export interface SpendEstimate {
  estimatedAnnualHouseholdSpend: number
  estimatedTradeAreaSpendTotal: number
  methodology: string
}

/**
 * @param medianHouseholdIncome from Census ACS tract data
 * @param population from Census ACS tract data
 * @param avgHouseholdSize national ACS average (~2.5) used to convert
 *   population to household count when a tract-specific figure isn't pulled
 */
export function estimateTradeAreaSpend(
  medianHouseholdIncome: number,
  population: number,
  avgHouseholdSize = 2.5
): SpendEstimate {
  const perHousehold = estimateHouseholdSpend(medianHouseholdIncome)
  const households = population / avgHouseholdSize

  return {
    estimatedAnnualHouseholdSpend: Math.round(perHousehold),
    estimatedTradeAreaSpendTotal: Math.round(perHousehold * households),
    methodology:
      'Estimated from Census median household income, interpolated against BLS Consumer Expenditure Survey national quintile data (2024). This is a planning-level estimate, not a reported figure.',
  }
}
