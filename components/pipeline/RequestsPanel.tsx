'use client'

import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { GlassCard } from '@/components/ui/glass-card'
import { Button } from '@/components/ui/button'
import type { PendingAction } from '@/lib/actions/pending'

type Runners = {
  findPeople: (companyKeys: string[]) => Promise<Record<string, unknown>>
  draftNotes: (personIds: number[]) => Promise<Record<string, unknown>>
}

async function move(id: string, to: 'running' | 'done' | 'failed' | 'rejected', result?: Record<string, unknown>) {
  const res = await fetch(`/api/actions/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, result }) }).catch(() => null)
  if (!res?.ok) {
    const body = await res?.json().catch(() => null)
    throw new Error(body?.error ?? 'Could not update the request.')
  }
}

/** Export confirm: the batch fixed at request time, through the same route as the Export button. */
async function runExport(a: PendingAction): Promise<Record<string, unknown>> {
  const p = a.params as { person_ids: number[]; tiers: number[]; include_exported: boolean }
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: p.person_ids, tiers: p.tiers, includeExported: p.include_exported, limit: null, write: true }),
  }).catch(() => null)
  const r = await res?.json().catch(() => null)
  if (!res?.ok || !r?.csv) throw new Error(r?.error ?? 'Export failed; nothing was marked.')
  const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = r.filename ?? 'sender.csv'
  link.click()
  URL.revokeObjectURL(url)
  return { exported: r.count, filename: r.filename }
}

/**
 * Requests the MCP server filed (find people, draft notes, export CSV). They
 * never run by themselves: Confirm here runs the page's own flow; Reject drops it.
 */
export function RequestsPanel({ actions, busy, run, onChanged }: { actions: PendingAction[]; busy: boolean; run: Runners; onChanged: () => void }) {
  const [working, setWorking] = useState<string | null>(null)
  const awaiting = actions.filter((a) => a.status === 'awaiting')
  if (!awaiting.length) return null

  async function confirm(a: PendingAction) {
    setWorking(a.id)
    try {
      await move(a.id, 'running')
      let result: Record<string, unknown>
      try {
        if (a.kind === 'find_people') result = await run.findPeople((a.params as { company_keys: string[] }).company_keys)
        else if (a.kind === 'draft_notes') result = await run.draftNotes((a.params as { person_ids: number[] }).person_ids)
        else result = await runExport(a)
      } catch (err) {
        await move(a.id, 'failed', { error: err instanceof Error ? err.message : 'failed' }).catch(() => {})
        throw err
      }
      await move(a.id, 'done', result)
      if (a.kind === 'export_csv') toast.success(`Exported ${result.exported}; they are marked Exported.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Request failed.')
    } finally {
      setWorking(null)
      onChanged()
    }
  }

  async function reject(a: PendingAction) {
    setWorking(a.id)
    await move(a.id, 'rejected').catch((err) => toast.error(err.message))
    setWorking(null)
    onChanged()
  }

  return (
    <GlassCard size="sm" className="gap-2 px-4 py-3 text-[13px]">
      <div className="font-medium text-fg">Requests from Claude · {awaiting.length}</div>
      <p className="text-[12px] text-fg-46">Filed through the MCP connector. Nothing runs until you confirm; each expires after a day.</p>
      <ul className="flex flex-col divide-y divide-line">
        {awaiting.map((a) => {
          const people = (a.preview.people as { company: string }[] | undefined) ?? []
          const companies = (a.preview.companies as string[] | undefined) ?? []
          const list = companies.length ? companies : [...new Set(people.map((p) => p.company))]
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-fg">{a.summary}</div>
                <div className="truncate text-[12px] text-fg-46" title={list.join(', ')}>
                  {Number(a.est_cost_usd) > 0 ? `about $${Number(a.est_cost_usd).toFixed(2)} · ` : 'no cost · '}
                  {list.slice(0, 8).join(', ')}
                  {list.length > 8 ? ` +${list.length - 8}` : ''}
                  {a.kind === 'export_csv' && Number(a.preview.apply_first) > 0 ? ` · ${a.preview.apply_first} recruiter rows held until the role is Applied` : ''}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => reject(a)} disabled={!!working || busy}>
                <X aria-hidden /> Reject
              </Button>
              <Button size="sm" onClick={() => confirm(a)} disabled={!!working || busy}>
                {working === a.id ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                Confirm{a.kind === 'export_csv' ? ' and download' : ''}
              </Button>
            </li>
          )
        })}
      </ul>
    </GlassCard>
  )
}
