'use client'

import { useRef, useState } from 'react'
import { CATEGORY_LABELS, type GradeWeights } from '@/lib/grader-types'
import { BUSINESS_PROFILE_LIST, type BusinessProfileId } from '@/lib/business-profiles'

const AGENT_NAME = 'Brent Pleeter'
const BROKERAGE_NAME = 'Domain Realty'
const BROKERAGE_MARKET = 'Naples, FL'
const MAX_COSTAR_FILE_MB = 15
const ACCEPTED_COSTAR_EXT = ['.pdf', '.csv', '.txt', '.xlsx', '.xls']

interface AnalyzeResponse {
  reportId: number
  cached: boolean
  formattedAddress: string
  businessProfile: BusinessProfileId
  overallScore: number
  overallGrade: string
  categoryScores: Record<keyof GradeWeights, number>
  narrative: {
    summary: string
    strengths: string[]
    risks: string[]
    recommendation: string
    costarHighlights?: string[]
  } | null
  hasCostarData: boolean
  costarFilename: string | null
}

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'text-emerald-700 bg-emerald-50'
  if (grade.startsWith('B')) return 'text-domain-blue bg-domain-tint'
  if (grade.startsWith('C')) return 'text-amber-700 bg-amber-50'
  if (grade.startsWith('D')) return 'text-orange-700 bg-orange-50'
  return 'text-red-700 bg-red-50'
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function Home() {
  const [address, setAddress] = useState('')
  const [businessProfile, setBusinessProfile] = useState<BusinessProfileId>('general')
  const [costarFile, setCostarFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeResponse | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setError(null)
    if (file && file.size > MAX_COSTAR_FILE_MB * 1024 * 1024) {
      setError(`That file is over ${MAX_COSTAR_FILE_MB}MB — try a smaller export.`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setCostarFile(null)
      return
    }
    setCostarFile(file)
  }

  function clearFile() {
    setCostarFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const form = new FormData()
      form.set('address', address)
      form.set('businessProfile', businessProfile)
      if (costarFile) form.set('costarFile', costarFile)

      const res = await fetch('/api/analyze', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#F5F8FB]">
      <div className="bg-gradient-to-br from-domain-deep via-domain-deep-light to-domain-blue-dark text-white px-6 py-10">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="bg-white rounded-lg px-4 py-2 shadow-sm inline-flex items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/domain-logo.png" alt="Domain Realty" className="h-7 w-auto" />
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold">{AGENT_NAME}</div>
              <div className="text-xs text-white/60">{BROKERAGE_NAME} &middot; {BROKERAGE_MARKET}</div>
            </div>
          </div>
          <div className="text-sky-300 text-xs tracking-[0.2em] uppercase mb-2">Internal Tool</div>
          <h1 className="text-2xl font-serif">Site Quality Scorecard</h1>
          <p className="text-white/65 text-sm mt-1">
            Enter a Southwest Florida commercial address to generate a scored analysis and PDF report.
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 -mt-6">
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Property address</label>
            <input
              type="text"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="1234 Tamiami Trail N, Naples, FL 34102"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-domain-blue focus:border-domain-blue"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Intended business use</label>
            <select
              value={businessProfile}
              onChange={(e) => setBusinessProfile(e.target.value as BusinessProfileId)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-domain-blue focus:border-domain-blue bg-white"
            >
              {BUSINESS_PROFILE_LIST.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Scoring — especially nearby retail — is weighted for this specific use, so the same
              address can score differently depending on what you select.
            </p>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1">
              CoStar export
              <span className="text-[10px] font-normal text-domain-blue bg-domain-tint px-1.5 py-0.5 rounded uppercase tracking-wide">Optional</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">
              Attach a comps, market survey, or property export from CoStar and the report will pull
              in relevant figures (comps, cap rate, rent/SF, vacancy) alongside the public data below.
            </p>

            {!costarFile ? (
              <label className="flex items-center justify-center gap-2 border border-dashed border-gray-300 rounded-lg px-4 py-4 text-sm text-gray-500 cursor-pointer hover:border-domain-blue hover:text-domain-blue transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <path d="M12 16V4M12 4l-4 4M12 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Attach PDF, Excel, or CSV export
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_COSTAR_EXT.join(',')}
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            ) : (
              <div className="flex items-center justify-between border border-gray-200 bg-domain-tint/60 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-domain-blue flex-shrink-0">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div className="min-w-0">
                    <div className="text-sm text-gray-800 truncate">{costarFile.name}</div>
                    <div className="text-xs text-gray-400">{formatFileSize(costarFile.size)}</div>
                  </div>
                </div>
                <button type="button" onClick={clearFile} className="text-xs text-gray-400 hover:text-red-600 flex-shrink-0 ml-2">
                  Remove
                </button>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-domain-blue text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-domain-blue-dark transition-colors disabled:opacity-50"
          >
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
        </form>

        {error && (
          <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>
        )}

        {result && (
          <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-10">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-500">{result.formattedAddress}</div>
                <div className="text-xs text-domain-blue font-medium mt-0.5 uppercase tracking-wide">
                  Scored for: {BUSINESS_PROFILE_LIST.find((p) => p.id === result.businessProfile)?.label ?? result.businessProfile}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {result.cached && <div className="text-xs text-gray-400">Loaded from cache</div>}
                  {result.hasCostarData && (
                    <div className="text-xs text-domain-blue bg-domain-tint px-1.5 py-0.5 rounded uppercase tracking-wide font-medium">
                      CoStar data included
                    </div>
                  )}
                </div>
              </div>
              <div className={`text-2xl font-bold rounded-full w-16 h-16 flex items-center justify-center ${gradeColor(result.overallGrade)}`}>
                {result.overallGrade}
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {(Object.keys(result.categoryScores) as Array<keyof GradeWeights>).map((key) => (
                <div key={key} className="flex items-center gap-3 text-sm">
                  <div className="w-44 text-gray-600">{CATEGORY_LABELS[key]}</div>
                  <div className="flex-1 h-2 bg-domain-tint rounded-full overflow-hidden">
                    <div
                      className="h-full bg-domain-blue rounded-full"
                      style={{ width: `${result.categoryScores[key]}%` }}
                    />
                  </div>
                  <div className="w-8 text-right font-medium text-domain-blue">{result.categoryScores[key].toFixed(0)}</div>
                </div>
              ))}
            </div>

            {result.narrative && (
              <p className="mt-6 text-sm text-gray-700 leading-relaxed">{result.narrative.summary}</p>
            )}

            {result.hasCostarData && (result.narrative?.costarHighlights?.length ?? 0) > 0 && (
              <div className="mt-5 border border-domain-tint bg-domain-tint/50 rounded-lg p-4">
                <div className="text-xs font-semibold text-domain-blue uppercase tracking-wide mb-2">
                  From {result.costarFilename ?? 'attached CoStar export'}
                </div>
                <ul className="text-sm text-gray-700 space-y-1.5 list-disc list-inside">
                  {result.narrative!.costarHighlights!.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              </div>
            )}

            <a
              href={`/api/report/${result.reportId}/pdf`}
              className="mt-6 inline-block bg-domain-deep text-white font-medium text-sm px-5 py-2.5 rounded-lg hover:bg-domain-deep-light transition-colors"
            >
              Download PDF Report
            </a>
          </div>
        )}
      </div>
    </main>
  )
}
