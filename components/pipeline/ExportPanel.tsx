'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { GlassCard } from '@/components/ui/glass-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PROFILE } from '@/lib/profile'
import { FIT_TRACKS, tierOf, type FitTrack } from '@/lib/jobs/fit'
import { BRANCH_ORDER } from '@/lib/people/targets'
import { DEFAULT_BATCH } from '@/lib/export/columns'
import type { CompanyView } from '@/lib/people/companies'
import type { ExportResult, ImportResult } from '@/lib/export/run'

const TIER_TRACKS = [...FIT_TRACKS].sort((a, b) => tierOf(a) - tierOf(b))

/**
 * Sender CSV export (GTM-22). Takes exactly what the page's filters show, in
 * its order, Approved notes only. Defaults to Tier 1; tiers mix only when more
 * than one is ticked, highest tier first. The file marks those people Exported.
 */
export function ExportPanel({ visible, tiers, onClose, onExported }: { visible: CompanyView[]; tiers: Set<FitTrack>; onClose: () => void; onExported: () => void }) {
  const [picked, setPicked] = useState<Set<number>>(() => {
    const fromPage = TIER_TRACKS.filter((t) => tiers.has(t)).map((t) => tierOf(t))
    return new Set(fromPage.length ? fromPage : [1])
  })
  const [limit, setLimit] = useState<number | null>(DEFAULT_BATCH)
  const [includeExported, setIncludeExported] = useState(false)
  const [preview, setPreview] = useState<ExportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // Page order: companies as sorted, people in tree order (branch, then rank).
  const ids = useMemo(
    () =>
      visible.flatMap((c) =>
        [...c.people]
          .sort((a, b) => BRANCH_ORDER.indexOf(a.branch) - BRANCH_ORDER.indexOf(b.branch) || (a.rank ?? 99) - (b.rank ?? 99))
          .filter((p) => p.outreach_status === 'approved' || p.outreach_status === 'exported')
          .map((p) => p.id)
      ),
    [visible]
  )
  const body = useMemo(() => ({ ids, tiers: [...picked].sort(), includeExported, limit }), [ids, picked, includeExported, limit])

  useEffect(() => {
    let live = true
    setLoading(true)
    fetch('/api/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, write: false }) })
      .then((r) => r.json())
      .then((r) => live && setPreview(r.error && !r.count && r.count !== 0 ? null : r))
      .catch(() => live && setPreview(null))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [body])

  async function download() {
    setDownloading(true)
    const res = await fetch('/api/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, write: true }) }).catch(() => null)
    const r = (await res?.json().catch(() => null)) as (ExportResult & { error?: string }) | null
    setDownloading(false)
    if (!res?.ok || !r?.csv) {
      if (r) setPreview(r)
      return toast.error(r?.error ?? 'Export failed. Nothing was marked.')
    }
    const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = r.filename ?? 'sender.csv'
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${r.count}. They are marked Exported and left out of the next export.`)
    onExported()
    onClose()
  }

  const toggleTier = (t: number) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(t)) {
        if (n.size > 1) n.delete(t)
      } else n.add(t)
      return n
    })

  const blocked = !preview || !!preview.overLimit.length || preview.count === 0
  return (
    <GlassCard size="sm" className="gap-3 px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-medium text-fg">Export CSV for the sender</span>
        <span className="flex items-center gap-2" role="group" aria-label="Tiers in this file">
          {TIER_TRACKS.map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-1.5 text-fg-70">
              <input type="checkbox" checked={picked.has(tierOf(t))} onChange={() => toggleTier(tierOf(t))} className="accent-[var(--primary)]" />
              Tier {tierOf(t)} · {PROFILE.constraints.tracks[t].label}
            </label>
          ))}
        </span>
        <label className="flex items-center gap-1.5 text-fg-70">
          First
          <Input
            type="number"
            min={1}
            value={limit ?? ''}
            placeholder="all"
            onChange={(e) => setLimit(e.target.value ? Math.max(1, Number(e.target.value)) : null)}
            className="h-7 w-16 px-2 text-[12px]"
            aria-label="Batch size (empty for all)"
          />
          rows
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-fg-70">
          <input type="checkbox" checked={includeExported} onChange={(e) => setIncludeExported(e.target.checked)} className="accent-[var(--primary)]" />
          include already exported
        </label>
      </div>

      <div className="text-fg-70">
        {loading || !preview ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Counting…
          </span>
        ) : (
          <>
            <span className="font-mono text-fg">{preview.count}</span> {preview.count === 1 ? 'person' : 'people'} in this file
            {preview.available > preview.count ? ` (first ${preview.count} of ${preview.available} ready)` : ''}, from the current filters, Approved notes
            {includeExported ? ' and already exported' : ''} only. Highest tier first, then the page order.
          </>
        )}
      </div>

      {preview?.overLimit.length ? (
        <Problem tone="bad" title={`Refused: ${preview.overLimit.length} note${preview.overLimit.length === 1 ? ' is' : 's are'} over the ${PROFILE.noteLimit}-character limit or missing. Fix them first.`}>
          {preview.overLimit.map((p) => `${p.name} (${p.company}): ${p.length} chars`)}
        </Problem>
      ) : null}
      {preview?.applyFirst.length ? (
        <Problem tone="warn" title={`Apply first: ${preview.applyFirst.length} recruiter row${preview.applyFirst.length === 1 ? ' is' : 's are'} held out of this file. Their after-accept message says you've applied, so they go out once the role is marked Applied.`}>
          {preview.applyFirst.map((p) => `${p.name} (${p.company}): ${p.role}, ${p.status}`)}
        </Problem>
      ) : null}
      {preview?.noUrl.length ? (
        <Problem tone="warn" title={`Skipped ${preview.noUrl.length} without a LinkedIn profile URL:`}>
          {preview.noUrl.map((p) => `${p.name} (${p.company})`)}
        </Problem>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={download} disabled={blocked || loading || downloading}>
          {downloading ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
          Download {preview?.count ?? ''} and mark Exported
        </Button>
      </div>
    </GlassCard>
  )
}

function Problem({ tone, title, children }: { tone: 'bad' | 'warn'; title: string; children: string[] }) {
  return (
    <details open={tone === 'bad'} className={tone === 'bad' ? 'rounded-lg border border-red/30 bg-red/10 px-3 py-2' : 'rounded-lg border border-amber/30 bg-amber/10 px-3 py-2'}>
      <summary className="cursor-pointer text-[12px] text-fg">{title}</summary>
      <ul className="mt-1.5 list-disc pl-5 text-[12px] text-fg-70">
        {children.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </details>
  )
}

/** Sender results CSV (linkedin_url + status) → Sent / Replied. */
export function ImportButton({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  async function onFile(file: File) {
    setBusy(true)
    const res = await fetch('/api/import', { method: 'POST', headers: { 'content-type': 'text/csv' }, body: await file.text() }).catch(() => null)
    const r = (await res?.json().catch(() => null)) as (ImportResult & { error?: string }) | null
    setBusy(false)
    if (input.current) input.current.value = ''
    if (!res?.ok || !r || r.error) return toast.error(r?.error ?? 'Import failed. Nothing changed.')
    const sent = r.updated.filter((u) => u.status === 'sent').length
    const replied = r.updated.filter((u) => u.status === 'replied').length
    const extra = [r.unmatched.length && `${r.unmatched.length} not matched`, r.unknownStatus.length && `${r.unknownStatus.length} unknown status`].filter(Boolean).join(', ')
    toast.success(`${r.rows} rows: ${sent} marked Sent, ${replied} Replied, ${r.unchanged} unchanged${extra ? `; ${extra}` : ''}`, {
      description: [...r.unmatched.map((u) => `Not matched: ${u}`), ...r.unknownStatus.map((u) => `Unknown status: ${u}`)].slice(0, 8).join('\n') || undefined,
      duration: 12000,
    })
    onDone()
  }
  return (
    <>
      <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-fg-70 hover:bg-muted hover:text-fg disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
        Import results
      </button>
    </>
  )
}
