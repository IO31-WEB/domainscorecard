/**
 * Optional CoStar export parsing.
 *
 * Brent has a CoStar subscription and can attach a market/comps export he
 * already pulled (PDF, Excel, or CSV) alongside the address he's scoring.
 * We don't attempt to parse CoStar's report layouts into our own scoring
 * categories — those layouts vary a lot by report type (comps, market
 * survey, tenant rep, etc.) and CoStar's own numbers already reflect
 * paid, licensed data we shouldn't try to second-guess. Instead we extract
 * the raw text/tabular content and hand it to Claude as additional
 * context when writing the narrative, so the report can reference specific
 * CoStar figures (comps, cap rates, vacancy, rent/SF, absorption, etc.)
 * without us hand-coding a parser per CoStar report template.
 *
 * Every path here is best-effort and fails soft — a CoStar file that can't
 * be parsed just means the report continues without that extra context,
 * never a hard error for the whole analysis.
 */

const MAX_CHARS = 14_000

export interface CostarExtract {
  filename: string
  text: string
  truncated: boolean
}

export async function parseCostarFile(file: File): Promise<CostarExtract | null> {
  const name = file.name || 'costar-upload'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''

  try {
    let raw: string

    if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
      raw = await file.text()
    } else if (ext === 'pdf') {
      raw = await extractPdfText(file)
    } else if (ext === 'xlsx' || ext === 'xls') {
      raw = await extractSpreadsheetText(file)
    } else {
      // Unknown extension — try as plain text as a last resort.
      raw = await file.text().catch(() => '')
    }

    raw = raw.replace(/\u0000/g, '').trim()
    if (!raw) return null

    const truncated = raw.length > MAX_CHARS
    return {
      filename: name,
      text: truncated ? raw.slice(0, MAX_CHARS) : raw,
      truncated,
    }
  } catch (err) {
    console.error('CoStar file parse failed', name, err)
    return null
  }
}

async function extractPdfText(file: File): Promise<string> {
  // Dynamic import — pdf-parse pulls in a fairly heavy PDF.js-derived
  // parser and we only want it loaded on the (uncommon) request path
  // where someone actually attaches a PDF.
  const pdfParse = (await import('pdf-parse')).default
  const buf = Buffer.from(await file.arrayBuffer())
  const result = await pdfParse(buf)
  return result.text ?? ''
}

async function extractSpreadsheetText(file: File): Promise<string> {
  const XLSX = await import('xlsx')
  const buf = Buffer.from(await file.arrayBuffer())
  const workbook = XLSX.read(buf, { type: 'buffer' })

  const sheets: string[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(sheet)
    if (csv.trim()) sheets.push(`--- Sheet: ${sheetName} ---\n${csv.trim()}`)
  }
  return sheets.join('\n\n')
}
