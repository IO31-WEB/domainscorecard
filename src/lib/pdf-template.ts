/**
 * Renders the report as an HTML string for Puppeteer to print to PDF.
 *
 * Design: blue/white, editorial-serif headers over clean sans body — the
 * same register as an institutional CRE offering memorandum, not a
 * consumer-facing marketing page. Built for Domain Realty (Naples, FL) —
 * every color lives in the CSS vars at the top, so the palette can be
 * retuned in one place if the brand colors ever change.
 */

import type { GradeWeights } from './grader'
import { CATEGORY_LABELS, scoreToGrade } from './grader'
import { LOGO_DATA_URI } from './logo'

const AGENT_NAME = 'Brent Pleeter'
const BROKERAGE_NAME = 'Domain Realty'
const BROKERAGE_MARKET = 'Naples, FL'

interface TemplateData {
  formattedAddress: string
  businessProfileLabel: string
  overallGrade: string
  overallScore: number
  categoryScores: Record<keyof GradeWeights, number>
  generatedDate: string
  rawData: {
    demographics: {
      population: number
      populationGrowth5yr: number
      medianAge: number
      medianHouseholdIncome: number
      medianHomeValue: number
      ownerOccupiedPct: number
      bachelorsPlusPct: number
    } | null
    trafficCounts: Array<{ aadt: number; roadway: string | null; descFrom: string | null; descTo: string | null; distanceMiles: number }>
    synergyAnchors: Array<{ name: string; distanceMiles: number; impact: string; lat?: number; lng?: number }>
    saturationAnchors: Array<{ name: string; distanceMiles: number; impact: string; lat?: number; lng?: number }>
    saturationScored?: boolean
    flood: { zone: string; isSpecialFloodHazardArea: boolean; description: string } | null
    crime: { agencyName: string; trend: string } | null
    spendEstimate: { estimatedAnnualHouseholdSpend: number; estimatedTradeAreaSpendTotal: number } | null
  }
  narrative: {
    summary: string
    strengths: string[]
    risks: string[]
    recommendation: string
    costarHighlights?: string[]
  } | null
  /** Optional base64 data-URI of a Google Static Map (property + nearby anchors). */
  mapImageDataUri?: string | null
  /** Whether an agent-attached CoStar export (PDF/Excel/CSV) was used for this report. */
  hasCostarData?: boolean
  costarFilename?: string | null
}

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return '#1E7B4D'
  if (grade.startsWith('B')) return '#1878BE'
  if (grade.startsWith('C')) return '#B98A2E'
  if (grade.startsWith('D')) return '#C97A2B'
  return '#B3402E'
}

function fmtMoney(n: number): string {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`
}

function renderGauge(score: number, grade: string): string {
  const r = 52
  const circumference = 2 * Math.PI * r
  const dash = circumference * Math.min(score, 100) / 100
  const color = gradeColor(grade)
  return `
    <svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="10" />
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="10"
        stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${circumference * 0.25}"
        stroke-linecap="round" transform="rotate(-90 60 60)" />
      <text x="60" y="56" text-anchor="middle" font-size="30" font-weight="700" fill="white" font-family="'Helvetica Neue', Arial, sans-serif">${grade}</text>
      <text x="60" y="75" text-anchor="middle" font-size="10.5" fill="rgba(255,255,255,0.7)" font-family="'Helvetica Neue', Arial, sans-serif">${score.toFixed(1)} / 100</text>
    </svg>`
}

/** Cover-page "skimmable" chips — the 3-4 numbers an investor looks for first. */
function renderHighlights(rawData: TemplateData['rawData']): string {
  const chips: string[] = []

  const topTraffic = rawData.trafficCounts[0]
  if (topTraffic) {
    chips.push(`<div class="chip"><div class="chip-value">${topTraffic.aadt.toLocaleString()}</div><div class="chip-label">Vehicles/Day (AADT)</div></div>`)
  }
  if (rawData.demographics) {
    chips.push(`<div class="chip"><div class="chip-value">${rawData.demographics.population.toLocaleString()}</div><div class="chip-label">Tract Population</div></div>`)
  }
  if (rawData.spendEstimate) {
    chips.push(`<div class="chip"><div class="chip-value">${fmtMoney(rawData.spendEstimate.estimatedTradeAreaSpendTotal)}</div><div class="chip-label">Est. Annual Spend Power</div></div>`)
  }
  if (rawData.flood) {
    chips.push(`<div class="chip"><div class="chip-value">${rawData.flood.zone}</div><div class="chip-label">FEMA Flood Zone</div></div>`)
  }

  return chips.length ? `<div class="chip-row">${chips.join('')}</div>` : ''
}

export function renderReportHtml(data: TemplateData): string {
  const {
    formattedAddress, businessProfileLabel, overallGrade, overallScore, categoryScores,
    generatedDate, rawData, narrative, mapImageDataUri, hasCostarData, costarFilename,
  } = data

  const categoryRows = (Object.keys(categoryScores) as Array<keyof GradeWeights>)
    .map((key) => {
      const score = categoryScores[key]
      const color = gradeColor(scoreToGrade(score))
      return `
        <div class="cat-row">
          <div class="cat-dot" style="background:${color}"></div>
          <div class="cat-label">${CATEGORY_LABELS[key]}</div>
          <div class="cat-bar-track">
            <div class="cat-bar-fill" style="width:${score}%; background:${color}"></div>
          </div>
          <div class="cat-score" style="color:${color}">${score.toFixed(0)}</div>
        </div>`
    })
    .join('')

  const demo = rawData.demographics
  const demoBlock = demo
    ? `
    <div class="stat-grid">
      <div class="stat"><div class="stat-value">${demo.population.toLocaleString()}</div><div class="stat-label">Census Tract Population</div></div>
      <div class="stat"><div class="stat-value">${demo.populationGrowth5yr > 0 ? '+' : ''}${demo.populationGrowth5yr}%</div><div class="stat-label">5-Year Population Growth</div></div>
      <div class="stat"><div class="stat-value">$${demo.medianHouseholdIncome.toLocaleString()}</div><div class="stat-label">Median Household Income</div></div>
      <div class="stat"><div class="stat-value">${demo.medianAge}</div><div class="stat-label">Median Age</div></div>
      <div class="stat"><div class="stat-value">${demo.bachelorsPlusPct}%</div><div class="stat-label">Bachelor's Degree+</div></div>
      <div class="stat"><div class="stat-value">${demo.ownerOccupiedPct}%</div><div class="stat-label">Owner-Occupied Housing</div></div>
    </div>`
    : `<p class="muted">Demographic data unavailable for this location.</p>`

  const describeSegment = (t: TemplateData['rawData']['trafficCounts'][number]): string => {
    if (t.descFrom && t.descTo) return `${t.descFrom} to ${t.descTo}`
    if (t.descFrom) return `near ${t.descFrom}`
    return 'nearby roadway segment'
  }

  const trafficBlock = rawData.trafficCounts.length
    ? `<ul class="plain-list">${rawData.trafficCounts.slice(0, 3).map(t =>
        `<li><strong>${t.aadt.toLocaleString()} AADT</strong> — ${describeSegment(t)} (${t.distanceMiles} mi)</li>`
      ).join('')}</ul>`
    : `<p class="muted">No FDOT traffic count stations within range of this address.</p>`

  const synergyAnchors = rawData.synergyAnchors ?? []
  const saturationAnchors = rawData.saturationAnchors ?? []

  const synergyBlock = synergyAnchors.length
    ? `<ul class="plain-list">${synergyAnchors.slice(0, 10).map(a =>
        `<li><strong>${a.name}</strong> — ${a.distanceMiles} mi <span class="impact-positive">(demand validator)</span></li>`
      ).join('')}</ul>`
    : `<p class="muted">No demand-validating businesses detected within 1.5 miles for this use.</p>`

  const saturationBlock = saturationAnchors.length
    ? `<ul class="plain-list">${saturationAnchors.slice(0, 10).map(a =>
        `<li><strong>${a.name}</strong> — ${a.distanceMiles} mi <span class="impact-negative">(direct competitor)</span></li>`
      ).join('')}</ul>`
    : rawData.saturationScored === false
      ? `<p class="muted">Competitive saturation is not scored for this business use — there isn't a well-defined direct-competitor category for it, so this factor is left neutral and its weight is redistributed to the other categories.</p>`
      : `<p class="muted">No direct competitors detected within 1.5 miles for this use.</p>`

  const mapBlock = mapImageDataUri
    ? `<div class="map-wrap">
        <img class="site-map" src="${mapImageDataUri}" alt="Site location and nearby retail" />
        <div class="map-legend">
          <span class="legend-item"><span class="legend-dot legend-subject"></span> Subject property</span>
          <span class="legend-item"><span class="legend-dot legend-anchor"></span> Nearby anchors / retail</span>
        </div>
      </div>`
    : ''

  const floodBlock = rawData.flood
    ? `<div class="callout ${rawData.flood.isSpecialFloodHazardArea ? 'callout-warn' : 'callout-good'}">
        <strong>FEMA Zone ${rawData.flood.zone}</strong> — ${rawData.flood.description}
      </div>`
    : `<p class="muted">FEMA flood zone data unavailable for this location.</p>`

  const trendLabel = rawData.crime
    ? rawData.crime.trend.charAt(0).toUpperCase() + rawData.crime.trend.slice(1)
    : ''
  const crimeBlock = rawData.crime
    ? `<p>${rawData.crime.agencyName} Jurisdiction — Crime Trend: <strong>${trendLabel}</strong></p>`
    : `<p class="muted">Jurisdiction-level crime data not yet available for this county.</p>`

  const spendBlock = rawData.spendEstimate
    ? `<div class="callout callout-neutral">
        <strong>Est. ${fmtMoney(rawData.spendEstimate.estimatedTradeAreaSpendTotal)}</strong> annual spending power in the surrounding census tract
        <div class="fine-print">Estimated from Census income data + BLS Consumer Expenditure Survey benchmarks — a planning-level estimate, not a reported figure.</div>
      </div>`
    : `<p class="muted">Spending estimate unavailable.</p>`

  const narrativeBlock = narrative
    ? `
      <p class="summary">${narrative.summary}</p>
      <div class="two-col">
        <div>
          <h3>Strengths</h3>
          <ul class="plain-list">${narrative.strengths.map(s => `<li>${s}</li>`).join('')}</ul>
        </div>
        <div>
          <h3>Considerations</h3>
          <ul class="plain-list">${narrative.risks.map(r => `<li>${r}</li>`).join('')}</ul>
        </div>
      </div>
      <div class="callout callout-neutral"><strong>Recommendation:</strong> ${narrative.recommendation}</div>`
    : ''

  const costarHighlights = narrative?.costarHighlights ?? []
  const costarSection = hasCostarData
    ? `
    <section class="page-start">
      <h2>CoStar Market Data <span class="section-tag">Agent-Provided</span></h2>
      ${costarHighlights.length
        ? `<ul class="plain-list">${costarHighlights.map(h => `<li>${h}</li>`).join('')}</ul>`
        : `<p class="muted">A CoStar export was attached to this report, but no figures specific to this address could be extracted from it automatically.</p>`
      }
      <p class="fine-print" style="margin-top:10px;">
        Sourced from a CoStar export${costarFilename ? ` (${costarFilename})` : ''} supplied by ${AGENT_NAME}. This is
        licensed, paid market data reflecting ${BROKERAGE_NAME}'s subscription and is not independently verified by
        this tool — treat it as more authoritative than the free public-data estimates elsewhere in this report
        wherever the two overlap.
      </p>
    </section>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Inter:wght@400;500;600;700&display=swap');
  :root {
    --blue-deep: #0B2E4A;
    --blue-deep-light: #123F63;
    --blue: #1878BE;
    --blue-dark: #125A93;
    --blue-tint: #EAF4FC;
    --ink: #1C232B;
    --muted: #64707D;
    --border: #E1E9F0;
    --bg: #FFFFFF;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Playfair Display', Georgia, serif;
    color: var(--ink);
    margin: 0;
    background: var(--bg);
  }
  .sans { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; }
  @page { margin-top: 0; }
  @page :first { margin-top: 0; }
  .cover {
    background: linear-gradient(135deg, var(--blue-deep) 0%, var(--blue-deep-light) 55%, var(--blue-dark) 100%);
    color: white;
    margin: 0;
    padding: 40px 56px 40px;
    position: relative;
  }
  .cover .brand-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 30px;
  }
  .cover .brand-logo-wrap {
    background: rgba(255, 255, 255, 0.97);
    border-radius: 8px;
    padding: 10px 16px;
    box-shadow: 0 2px 14px rgba(0,0,0,0.22);
    display: inline-flex;
    align-items: center;
  }
  .cover .brand-logo { height: 34px; width: auto; display: block; }
  .cover .agent-block { text-align: right; font-family: 'Inter', sans-serif; }
  .cover .agent-name { font-size: 13px; font-weight: 600; color: white; }
  .cover .agent-sub { font-size: 10.5px; color: rgba(255,255,255,0.65); margin-top: 2px; }
  .cover .eyebrow { font-family: 'Inter', sans-serif; letter-spacing: 3px; text-transform: uppercase; font-size: 11px; color: #8FC4EA; margin-bottom: 14px; }
  .cover h1 { font-size: 27px; margin: 0 0 8px; font-weight: 600; line-height: 1.25; }
  .cover .address { font-family: 'Inter', sans-serif; font-size: 13.5px; color: rgba(255,255,255,0.72); margin-bottom: 28px; }
  .grade-row { display: flex; align-items: center; gap: 24px; margin-bottom: 26px; }
  .grade-meta .sq-label { font-family: 'Inter', sans-serif; font-size: 11.5px; letter-spacing: 1px; color: rgba(255,255,255,0.65); text-transform: uppercase; }
  .grade-meta .sq-sub { font-family: 'Inter', sans-serif; font-size: 12.5px; color: rgba(255,255,255,0.78); margin-top: 4px; max-width: 340px; line-height: 1.5; }
  .chip-row { display: flex; gap: 12px; flex-wrap: wrap; }
  .chip { background: rgba(255,255,255,0.09); border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 10px 16px; font-family: 'Inter', sans-serif; }
  .chip-value { font-size: 16px; font-weight: 700; color: #8FC4EA; }
  .chip-label { font-size: 10px; color: rgba(255,255,255,0.68); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
  .content { padding: 32px 56px 12px; }
  /* When a section is pushed alone onto a new page, its own padding-top
     provides the header spacing (PDF top margin is 0 for full-bleed cover). */
  section { margin-bottom: 26px; page-break-inside: avoid; padding-top: 28px; }
  .content > section:first-child { padding-top: 4px; }
  section.page-start { page-break-before: always; padding-top: 32px; }
  h2 { font-size: 16px; font-family: 'Inter', sans-serif; font-weight: 600; color: var(--blue-deep); border-bottom: 2px solid var(--blue); padding-bottom: 8px; margin-bottom: 16px; display: flex; align-items: baseline; gap: 10px; }
  .section-tag { font-size: 9.5px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: var(--blue); background: var(--blue-tint); border-radius: 4px; padding: 2px 8px; }
  h3 { font-size: 12.5px; font-family: 'Inter', sans-serif; font-weight: 600; color: var(--blue-deep); margin: 0 0 8px; }
  .cat-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; font-family: 'Inter', sans-serif; page-break-inside: avoid; }
  .cat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .cat-label { width: 182px; font-size: 12px; color: var(--ink); }
  .cat-bar-track { flex: 1; height: 7px; background: var(--blue-tint); border-radius: 4px; overflow: hidden; }
  .cat-bar-fill { height: 100%; border-radius: 4px; }
  .cat-score { width: 30px; text-align: right; font-size: 12px; font-weight: 700; }
  .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .stat { background: var(--blue-tint); border-radius: 6px; padding: 13px 15px; font-family: 'Inter', sans-serif; page-break-inside: avoid; }
  .stat-value { font-size: 19px; font-weight: 700; color: var(--blue-deep); }
  .stat-label { font-size: 10.5px; color: var(--muted); margin-top: 2px; }
  .plain-list { font-family: 'Inter', sans-serif; font-size: 12.5px; padding-left: 18px; margin: 0; }
  .plain-list li { margin-bottom: 6px; }
  .impact-positive { color: #1E7B4D; font-weight: 600; } .impact-negative { color: #B3402E; font-weight: 600; } .impact-neutral { color: var(--muted); }
  .callout { font-family: 'Inter', sans-serif; font-size: 12.5px; border-radius: 6px; padding: 14px 16px; border-left: 4px solid var(--blue-deep); background: var(--blue-tint); page-break-inside: avoid; }
  .callout-good { border-left-color: #1E7B4D; }
  .callout-warn { border-left-color: #C97A2B; }
  .callout-neutral { border-left-color: var(--blue); }
  .fine-print { font-size: 10.5px; color: var(--muted); margin-top: 6px; }
  .summary { font-size: 14px; line-height: 1.65; font-family: 'Inter', sans-serif; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin: 16px 0; }
  .muted { color: var(--muted); font-family: 'Inter', sans-serif; font-size: 12.5px; }
  .map-wrap { margin-top: 14px; page-break-inside: avoid; }
  .site-map { width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--border); display: block; }
  .map-legend { display: flex; gap: 20px; margin-top: 8px; font-family: 'Inter', sans-serif; font-size: 11px; color: var(--muted); }
  .legend-item { display: flex; align-items: center; gap: 6px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .legend-subject { background: #B3402E; }
  .legend-anchor { background: var(--blue); }
  /* Prefer keeping flood + safety on the same page when both are short */
  .safety-section { page-break-before: avoid; }
</style>
</head>
<body>
  <div class="cover">
    <div class="brand-row">
      <div class="brand-logo-wrap">
        <img class="brand-logo" src="${LOGO_DATA_URI}" alt="${BROKERAGE_NAME}" />
      </div>
      <div class="agent-block">
        <div class="agent-name">${AGENT_NAME}</div>
        <div class="agent-sub">${BROKERAGE_NAME} &middot; ${BROKERAGE_MARKET}</div>
      </div>
    </div>
    <div class="eyebrow">Site Quality Report</div>
    <h1>Commercial Property Analysis</h1>
    <div class="address">${formattedAddress} &nbsp;·&nbsp; Prepared ${generatedDate}</div>
    <div class="grade-row">
      ${renderGauge(overallScore, overallGrade)}
      <div class="grade-meta">
        <div class="sq-label">Site Quality Score &mdash; Scored For: ${businessProfileLabel}</div>
        <div class="sq-sub">A due-diligence starting point synthesized from public Census, FDOT, FEMA, FBI, and retail-density data${hasCostarData ? ', supplemented with an agent-provided CoStar export,' : ''} weighted for this specific business use.</div>
      </div>
    </div>
    ${renderHighlights(rawData)}
  </div>

  <div class="content">
    <section>
      <h2>Score Breakdown</h2>
      ${categoryRows}
      <p class="fine-print" style="margin-top:12px;">
        <strong>Retail Synergy</strong> measures nearby businesses that validate consumer traffic and
        demand for this specific use (e.g. national QSR, grocery, and hotel activity near a proposed
        QSR site). <strong>Competitive Saturation</strong> measures nearby businesses that directly
        compete with this specific use — a high Retail Synergy score and a low Competitive Saturation
        score can occur on the same site at the same time, and both are shown separately below.
      </p>
    </section>

    <section class="page-start">
      <h2>Executive Summary</h2>
      ${narrativeBlock}
    </section>

    <section>
      <h2>Traffic Exposure</h2>
      ${trafficBlock}
    </section>

    <section>
      <h2>Demographics — Census Tract</h2>
      ${demoBlock}
    </section>

    <section class="page-start">
      <h2>Estimated Spending Power</h2>
      ${spendBlock}
    </section>

    <section>
      <h2>Location Map</h2>
      ${mapBlock}
    </section>
    ${costarSection}

    <section class="page-start">
      <h2>Retail Synergy — Nearby Demand Validators</h2>
      <p class="fine-print" style="margin-bottom:10px;">
        Businesses nearby that support consumer traffic and demand for a ${businessProfileLabel} use.
      </p>
      ${synergyBlock}
    </section>

    <section>
      <h2>Competitive Saturation — Nearby Competitors</h2>
      <p class="fine-print" style="margin-bottom:10px;">
        Businesses nearby that compete directly for the same customer as a ${businessProfileLabel} use.
      </p>
      ${saturationBlock}
    </section>

    <section>
      <h2>Flood Resilience</h2>
      ${floodBlock}
    </section>

    <section class="safety-section">
      <h2>Safety Context</h2>
      ${crimeBlock}
    </section>
  </div>
</body>
</html>`
}
