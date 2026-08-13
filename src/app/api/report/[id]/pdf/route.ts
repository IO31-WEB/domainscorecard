import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { db } from '@/lib/db'
import { reports } from '@/lib/db/schema'
import { renderReportHtml } from '@/lib/pdf-template'
import type { GradeWeights } from '@/lib/grader'
import { getBusinessProfile } from '@/lib/business-profiles'

// PDF rendering is the slow step (browser cold start + print). No external
// API calls happen here — the report data is already cached — so this is
// cheap to run even on repeat downloads of the same report.
export const maxDuration = 60

// We only need to render/print HTML, not run WebGL — disabling graphics
// mode skips extracting the swiftshader/ANGLE libraries, which shrinks
// the cold-start extraction work in the serverless environment.
chromium.setGraphicsMode = false

// @sparticuz/chromium only extracts its al2/al2023 shared-library tarball
// (and only configures LD_LIBRARY_PATH to point at it) when it detects
// AWS_EXECUTION_ENV / AWS_LAMBDA_JS_RUNTIME / CODEBUILD_BUILD_IMAGE env vars
// (see node_modules/@sparticuz/chromium/build/{index,helper}.js). Vercel's
// function runtime doesn't set any of those, so on Vercel the libraries are
// never extracted at all — not a path problem, they're just missing —
// which is exactly why launching Chromium fails with
// "libnss3.so: cannot open shared object file". We spoof the env var so
// the library's own detection extracts the al2023 (Node 20+) build, and
// mirror its LD_LIBRARY_PATH setup so the dynamic linker finds it.
process.env.AWS_EXECUTION_ENV ??= 'AWS_Lambda_nodejs20.x'
process.env.FONTCONFIG_PATH ??= '/tmp/fonts'
const chromiumLibPath = '/tmp/al2023/lib'
process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
  ? `${chromiumLibPath}:${process.env.LD_LIBRARY_PATH}`
  : chromiumLibPath

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const reportId = Number(id)
  if (!Number.isFinite(reportId)) {
    return NextResponse.json({ error: 'Invalid report id' }, { status: 400 })
  }

  const report = await db.query.reports.findFirst({ where: eq(reports.id, reportId) })
  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  const rawData = report.rawData as any
  const mapAnchors = [
    ...(rawData?.synergyAnchors ?? rawData?.anchors ?? []),
    ...(rawData?.saturationAnchors ?? []),
  ]
  const mapImageDataUri = await fetchStaticMapDataUri(
    report.lat,
    report.lng,
    mapAnchors.filter((a: any) => a.lat != null && a.lng != null).slice(0, 8)
  )

  const html = renderReportHtml({
    formattedAddress: report.formattedAddress,
    businessProfileLabel: getBusinessProfile(report.businessProfile).label,
    overallGrade: report.overallGrade,
    overallScore: report.overallScore,
    categoryScores: report.categoryScores as Record<keyof GradeWeights, number>,
    generatedDate: report.createdAt.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    }),
    rawData,
    narrative: report.narrative as any,
    mapImageDataUri,
    hasCostarData: report.hasCostarData,
    costarFilename: report.costarFilename,
  })

  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
    defaultViewport: { width: 1200, height: 1600 },
    executablePath: await chromium.executablePath(),
    headless: 'shell',
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-family: Arial, sans-serif; font-size: 7.5px; color: #6B7280; width: 100%; padding: 0 56px; line-height: 1.5; display: flex; justify-content: space-between; align-items: flex-end;">
          <div style="max-width: 480px;">
            Prepared by Brent Pleeter, Domain Realty. This Site Quality Score is a due-diligence starting point
            compiled from public data sources (U.S. Census Bureau, FEMA, FDOT, FBI, Google Places), BLS-derived
            estimates, and any CoStar data attached by the agent. It is not an appraisal, valuation, or guarantee of
            investment performance, and does not substitute for a licensed appraisal, survey, or professional site
            inspection.
          </div>
          <div><span class="pageNumber"></span> of <span class="totalPages"></span></div>
        </div>`,
      // Top margin must stay 0 so the navy cover is full-bleed on page 1.
      // Body-page top spacing comes from section padding in the HTML/CSS.
      margin: { top: '0', bottom: '60px', left: '0', right: '0' },
    })

    const filename = `domain-realty-site-report-${report.formattedAddress.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`

    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } finally {
    await browser.close()
  }
}

/**
 * Google Static Maps — one image request per PDF. Requires Maps Static API
 * enabled on the same GOOGLE_API_KEY used for Geocoding/Places. Returns null
 * on any failure so the PDF still renders without the map section.
 */
async function fetchStaticMapDataUri(
  lat: number,
  lng: number,
  anchors: Array<{ lat: number; lng: number; name?: string }>
): Promise<string | null> {
  const key = process.env.GOOGLE_API_KEY
  if (!key) return null

  try {
    const params = new URLSearchParams({
      center: `${lat},${lng}`,
      zoom: '14',
      size: '640x360',
      scale: '2',
      maptype: 'roadmap',
      key,
    })
    // Subject property — red pin (kept red for contrast against the blue palette)
    params.append('markers', `color:0xB3402E|size:mid|${lat},${lng}`)
    // Nearby anchors — Domain Realty blue pins (limit to keep URL under ~8k chars)
    for (const a of anchors.slice(0, 6)) {
      params.append('markers', `color:0x1878BE|size:small|${a.lat},${a.lng}`)
    }

    const res = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params}`)
    if (!res.ok) {
      console.error(`Static Maps API failed: ${res.status}`, await res.text().catch(() => ''))
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const contentType = res.headers.get('content-type') || 'image/png'
    return `data:${contentType};base64,${buf.toString('base64')}`
  } catch (err) {
    console.error('Static Maps fetch error', err)
    return null
  }
}
