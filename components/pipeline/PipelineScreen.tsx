'use client'

import { Fragment, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronRight, Copy, ExternalLink, Globe, Loader2, PenLine, Plus, RefreshCw, Search, Sparkles, StickyNote, X } from 'lucide-react'
import { toast } from 'sonner'
import { PageHead } from '@/components/shell/PageHead'
import { GlassCard } from '@/components/ui/glass-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CategoryPill, Chip, Count, FlagChips, IconLink, LinkedInMark, Segmented, TONE } from '@/components/ui/bits'
import { PROFILE } from '@/lib/profile'
import { draftTargetIds } from '@/lib/drafts/targets'
import { cn } from '@/lib/utils'
import type { CompanyJob, CompanyView } from '@/lib/people/companies'
import { blocks, FIT_TRACKS, type FitTrack } from '@/lib/jobs/fit'
import { STATUSES, statusMeta } from '@/lib/jobs/statuses'
import { BAND_LABEL, type SizeBand } from '@/lib/people/size'
import { BRANCH_LABEL, BRANCH_ORDER, EST_COST_PER_SEARCH, maxSearches, type Branch } from '@/lib/people/targets'
import { OUTREACH, type PersonRow } from '@/lib/people/types'

/** Note + after-accept message with retries: measured 2026-11-24 at about $0.02 per person. */
const DRAFT_COST = 0.02

type PeopleFilter = 'all' | 'none' | 'has'
type FitFilter = 'passes' | 'flagged' | 'all'
type TrackFilter = 'all' | FitTrack
type Section = 'all' | 'main' | 'referrals'

const LIVENESS: Record<string, { dot: string; label: string }> = {
  live: { dot: 'bg-green', label: 'Live' },
  dead: { dot: 'bg-red', label: 'Closed' },
  unchecked: { dot: 'bg-fg-24', label: 'Not checked' },
}

const BOARD_LABEL: Record<string, string> = { ashby: 'Ashby', greenhouse: 'Greenhouse', lever: 'Lever', linkedin: 'LinkedIn', other: 'Job page' }

/** Pipeline order: the furthest-along status across a company's roles is its rollup. */
const STATUS_RANK: Record<string, number> = { offer: 6, interviewing: 5, applied: 4, reached_out: 3, new: 2, rejected: 1, not_fit: 0 }
const rollupStatus = (roles: CompanyJob[]) => roles.reduce((best, r) => ((STATUS_RANK[r.status] ?? 0) > (STATUS_RANK[best] ?? 0) ? r.status : best), roles[0]?.status ?? 'new')

const trackLabel = (t: FitTrack) => (t === 'blocked' ? 'Blocked' : PROFILE.constraints.tracks[t]?.label ?? t)

function salaryLabel(j: Pick<CompanyJob, 'salary_min' | 'salary_max'>) {
  const k = (n: number) => `$${Math.round(n / 1000)}k`
  if (j.salary_min && j.salary_max) return `${k(j.salary_min)}–${k(j.salary_max)}`
  if (j.salary_min) return `${k(j.salary_min)}+`
  return '—'
}

/**
 * The one page: a row per company (best-fit role, rollup status, fit, people),
 * expanding to every open role and the people tree with drafts.
 */
export function PipelineScreen({ initial, openKey }: { initial: CompanyView[]; openKey: string | null }) {
  const router = useRouter()
  const [companies, setCompanies] = useState(initial)
  const [seen, setSeen] = useState(initial)
  if (seen !== initial) {
    setSeen(initial)
    setCompanies(initial)
  }

  const [open, setOpen] = useState<Set<string>>(() => new Set(openKey ? [openKey] : []))
  const [query, setQuery] = useState('')
  const [band, setBand] = useState<SizeBand | 'all'>('all')
  const [track, setTrack] = useState<TrackFilter>('all')
  const [status, setStatus] = useState<string>('all')
  const [section, setSection] = useState<Section>('all')
  const [fitFilter, setFitFilter] = useState<FitFilter>(openKey ? 'all' : 'passes')
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>('all')
  const [confirming, setConfirming] = useState(false)
  const [confirmingDrafts, setConfirmingDrafts] = useState(false)
  const [drafting, setDrafting] = useState<Set<number>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number; spent: number; current: string } | null>(null)
  const [syncing, startSync] = useTransition()
  const stopRef = useRef(false)

  const stats = useMemo(() => {
    const roles = companies.flatMap((c) => c.roles.map((r) => ({ r, flags: c.roleFlags[r.id] ?? [] })))
    const people = companies.flatMap((c) => c.people)
    const byStatus = (s: string) => roles.filter(({ r }) => r.status === s).length
    const inTrack = (t: string) => roles.filter(({ r }) => r.category === t)
    const passing = (t: string) => inTrack(t).filter(({ flags }) => !blocks(flags)).length
    const exa = companies.reduce((n, c) => n + c.spend, 0)
    const claude = companies.reduce((n, c) => n + c.claudeSpend, 0)
    return [
      { label: 'Roles', value: roles.length, hint: `${roles.filter(({ r }) => r.section === 'referrals').length} in referrals` },
      ...FIT_TRACKS.map((t) => ({
        label: PROFILE.constraints.tracks[t].label,
        value: passing(t),
        hint: `of ${inTrack(t).length} pass${PROFILE.constraints.categoryLevels[t] === 'warn' ? ' (warn)' : ''}${PROFILE.constraints.tracks[t].draft ? '' : ' · drafting paused'}`,
      })),
      { label: 'People', value: people.length, hint: `${companies.filter((c) => c.searchedAt).length} companies searched` },
      { label: 'UCLA alumni', value: people.filter((p) => p.is_ucla).length, hint: `${people.filter((p) => p.in_blockchain_ucla).length} Blockchain @ UCLA` },
      { label: 'Contacted', value: people.filter((p) => p.outreach_status === 'sent' || p.outreach_status === 'replied').length, hint: `${people.filter((p) => p.draft).length} drafted` },
      { label: 'Replied', value: people.filter((p) => p.outreach_status === 'replied').length, hint: 'people' },
      { label: 'Applied', value: byStatus('applied'), hint: 'roles' },
      { label: 'Interviewing', value: byStatus('interviewing') + byStatus('offer'), hint: `${byStatus('offer')} offer` },
      { label: 'Live', value: roles.filter(({ r }) => r.liveness === 'live').length, hint: `${roles.filter(({ r }) => r.liveness !== 'live' && r.liveness !== 'dead').length} not checked` },
      { label: 'Spend', value: `$${(exa + claude).toFixed(2)}`, hint: `Exa $${exa.toFixed(2)} · Claude $${claude.toFixed(2)}` },
    ]
  }, [companies])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return companies.filter(
      (c) =>
        (band === 'all' || c.band === band) &&
        (track === 'all' || (track === 'blocked' ? c.fitTrack === 'blocked' : c.fitTracks.includes(track))) &&
        (status === 'all' || c.roles.some((r) => r.status === status)) &&
        (section === 'all' || c.sections.includes(section)) &&
        (fitFilter === 'all' || (fitFilter === 'passes' ? c.passes || c.override : !(c.passes || c.override))) &&
        (peopleFilter === 'all' || (peopleFilter === 'none' ? c.people.length === 0 : c.people.length > 0)) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          c.roles.some((r) => (r.title ?? '').toLowerCase().includes(q) || (r.location ?? '').toLowerCase().includes(q)) ||
          c.people.some((p) => p.full_name.toLowerCase().includes(q)))
    )
  }, [companies, query, band, track, status, section, fitFilter, peopleFilter])

  const searchesFor = (c: CompanyView) => maxSearches(c.band, c.track, c.fitTrack === 'sdr')
  const unsearched = visible.filter((c) => !c.searchedAt)
  const estimate = (list: CompanyView[]) => list.reduce((n, c) => n + searchesFor(c), 0) * EST_COST_PER_SEARCH

  const targets = useMemo(
    () => draftTargetIds(companies.flatMap((c) => c.people), new Set(companies.filter((c) => c.fitTrack === 'sdr').map((c) => c.key))),
    [companies]
  )
  const undrafted = visible
    .filter((c) => c.canDraft)
    .flatMap((c) => c.people.filter((p) => targets.has(p.id) && !p.draft && p.outreach_status !== 'skip').map((p) => ({ c, p })))

  function sync() {
    startSync(async () => {
      const res = await fetch('/api/jobs/sync', { method: 'POST' }).catch(() => null)
      const body = await res?.json().catch(() => null)
      if (!res?.ok) {
        toast.error(body?.error ?? 'Sync failed')
        return
      }
      toast.success(`Synced: ${body.inserted} new, ${body.updated} refreshed`)
      router.refresh()
    })
  }

  function patchRole(companyKey: string, id: number, patch: Partial<CompanyJob>) {
    setCompanies((cs) =>
      cs.map((c) => {
        if (c.key !== companyKey) return c
        const roles = c.roles.map((r) => (r.id === id ? { ...r, ...patch } : r))
        return { ...c, roles, primary: c.primary ? roles.find((r) => r.id === c.primary!.id) ?? c.primary : null }
      })
    )
  }

  async function saveRole(c: CompanyView, r: CompanyJob, body: { status?: string; notes?: string | null }) {
    const before = { status: r.status, notes: r.notes }
    patchRole(c.key, r.id, body)
    const res = await fetch(`/api/jobs/${r.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
    if (!res?.ok) {
      patchRole(c.key, r.id, before)
      toast.error('Could not save. Try again.')
    }
  }

  async function draftPerson(c: CompanyView, p: PersonRow, quiet = false): Promise<boolean> {
    setDrafting((s) => new Set(s).add(p.id))
    const res = await fetch(`/api/people/${p.id}/draft`, { method: 'POST' }).catch(() => null)
    const body = await res?.json().catch(() => null)
    setDrafting((s) => {
      const n = new Set(s)
      n.delete(p.id)
      return n
    })
    if (!res?.ok) {
      toast.error(`${p.full_name}: ${body?.error ?? 'draft failed'}`)
      return false
    }
    patchPerson(c.key, p.id, body.person)
    if (!quiet && body.tooLong) toast.warning(`Draft is over ${PROFILE.noteLimit} characters; trim it before sending.`)
    return true
  }

  async function draftAll(list: { c: CompanyView; p: PersonRow }[]) {
    setConfirmingDrafts(false)
    stopRef.current = false
    // One company at a time per worker, people in order, so each note sees
    // its colleagues' notes and can differ from them. Three companies in parallel.
    const byCompany = new Map<string, { c: CompanyView; p: PersonRow }[]>()
    for (const item of list) byCompany.set(item.c.key, [...(byCompany.get(item.c.key) ?? []), item])
    const queue = [...byCompany.values()]
    let done = 0
    let finished = 0
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (queue.length && !stopRef.current) {
          const group = queue.shift()!
          for (const { c, p } of group) {
            if (stopRef.current) break
            if (await draftPerson(c, p, true)) done++
            finished++
            setProgress({ done: finished, total: list.length, spent: 0, current: p.full_name })
          }
        }
      })
    )
    setProgress(null)
    toast.success(`Drafted ${done} notes`)
  }

  async function setOverride(c: CompanyView, value: boolean) {
    const res = await fetch(`/api/companies/${encodeURIComponent(c.key)}/override`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fit_override: value }),
    }).catch(() => null)
    if (!res?.ok) return toast.error('Could not save the override.')
    toast.success(value ? `${c.name}: drafting allowed despite fit flags` : `${c.name}: override removed`)
    router.refresh()
  }

  async function saveDraft(c: CompanyView, p: PersonRow, draft: string) {
    const res = await fetch(`/api/people/${p.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draft }),
    }).catch(() => null)
    if (!res?.ok) return toast.error('Could not save the draft.')
    patchPerson(c.key, p.id, await res.json())
  }

  async function findPeople(list: CompanyView[]) {
    stopRef.current = false
    setConfirming(false)
    let spent = 0
    for (let i = 0; i < list.length; i++) {
      if (stopRef.current) break
      setProgress({ done: i, total: list.length, spent, current: list[i].name })
      const res = await fetch('/api/people/find', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ company_key: list[i].key }),
      }).catch(() => null)
      const body = await res?.json().catch(() => null)
      if (!res?.ok) {
        toast.error(`${list[i].name}: ${body?.error ?? 'search failed'}`)
        continue
      }
      spent += body.cost ?? 0
      if (list.length === 1) toast.success(`${body.company}: ${body.saved} people saved · $${(body.cost ?? 0).toFixed(3)}`)
      router.refresh()
    }
    if (list.length > 1) toast.success(`Searched ${list.length} companies · $${spent.toFixed(2)}`)
    setProgress(null)
    router.refresh()
  }

  function patchPerson(companyKey: string, id: number, patch: Partial<PersonRow> | null) {
    setCompanies((cs) =>
      cs.map((c) =>
        c.key !== companyKey
          ? c
          : { ...c, people: patch ? c.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) : c.people.filter((p) => p.id !== id) }
      )
    )
  }

  async function setOutreach(c: CompanyView, p: PersonRow, value: string) {
    const before = p.outreach_status
    patchPerson(c.key, p.id, { outreach_status: value })
    const res = await fetch(`/api/people/${p.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outreach_status: value }),
    }).catch(() => null)
    if (!res?.ok) {
      patchPerson(c.key, p.id, { outreach_status: before })
      toast.error('Could not save. Try again.')
    } else {
      patchPerson(c.key, p.id, await res.json())
    }
  }

  async function removePerson(c: CompanyView, p: PersonRow) {
    if (!window.confirm(`Remove ${p.full_name} from ${c.name}?`)) return
    const res = await fetch(`/api/people/${p.id}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) return toast.error('Could not remove. Try again.')
    patchPerson(c.key, p.id, null)
  }

  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const busy = progress !== null
  const COLS = ['', 'Company', 'Role', 'Category', 'Status', 'Posted', 'Live', 'Location', 'Salary', 'Size', 'Fit', 'People']
  const hideCol = (c: string) => (['Salary', 'Size'].includes(c) ? 'hidden min-[1760px]:table-cell' : ['Location', 'Posted'].includes(c) ? 'hidden lg:table-cell' : '')

  return (
    <div className="flex flex-col gap-5">
      <PageHead
        eyebrow="Job hunt"
        title="Pipeline"
        sub="One row per company: its best-fit role, fit flags and people. Expand a row for every open role and the notes. Searches and drafts only run after you confirm the cost; nothing is ever sent from here."
        actions={
          busy ? (
            <Button variant="outline" onClick={() => (stopRef.current = true)}>
              <Loader2 className="animate-spin" aria-hidden />
              {progress.done}/{progress.total}
              {progress.spent ? ` · $${progress.spent.toFixed(2)}` : ''} · Stop
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={sync} disabled={syncing}>
                <RefreshCw className={cn(syncing && 'animate-spin')} aria-hidden />
                {syncing ? 'Syncing…' : 'Sync from sheet'}
              </Button>
              <Button variant="outline" onClick={() => setConfirmingDrafts(true)} disabled={undrafted.length === 0}>
                <PenLine aria-hidden />
                Draft notes · {undrafted.length}
              </Button>
              <Button onClick={() => setConfirming(true)} disabled={unsearched.length === 0}>
                <Sparkles aria-hidden />
                Find people · {unsearched.length}
              </Button>
            </>
          )
        }
      />

      {confirming && (
        <GlassCard size="sm" className="flex-row flex-wrap items-center gap-3 px-4">
          <div className="min-w-0 flex-1 text-[13px] text-fg-70">
            Search <span className="text-fg">{unsearched.length}</span> companies not yet searched in this view: at most{' '}
            <span className="font-mono text-fg">{unsearched.reduce((n, c) => n + searchesFor(c), 0)}</span> Exa searches, at most{' '}
            <span className="font-mono text-fg">${estimate(unsearched).toFixed(2)}</span> (usually about half).
          </div>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button onClick={() => findPeople(unsearched)}>Run search</Button>
        </GlassCard>
      )}

      {confirmingDrafts && (
        <GlassCard size="sm" className="flex-row flex-wrap items-center gap-3 px-4">
          <div className="min-w-0 flex-1 text-[13px] text-fg-70">
            Draft LinkedIn notes for <span className="text-fg">{undrafted.length}</span> people (top alum + top recruiter per company) in this view with Claude Opus 5.5: about{' '}
            <span className="font-mono text-fg">${(undrafted.length * DRAFT_COST).toFixed(2)}</span>. Tracks with drafting paused are skipped. Nothing is sent; you review each one.
          </div>
          <Button variant="ghost" onClick={() => setConfirmingDrafts(false)}>
            Cancel
          </Button>
          <Button onClick={() => draftAll(undrafted)}>Draft notes</Button>
        </GlassCard>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {stats.map((s) => (
          <GlassCard key={s.label} size="sm" className="gap-0 px-3.5 py-3">
            <div className="truncate text-[12px] font-medium text-muted-foreground">{s.label}</div>
            <div className="mt-1.5 font-mono text-2xl leading-none font-semibold tracking-tight text-foreground tabular-nums">{s.value}</div>
            <div className="mt-1.5 truncate text-[11px] text-fg-46" title={s.hint}>
              {s.hint}
            </div>
          </GlassCard>
        ))}
      </div>

      <section className="surface min-w-0 overflow-hidden rounded-panel" aria-label="Pipeline">
        <div className="flex flex-wrap items-center gap-2 px-[18px] py-3">
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-46" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Company, role, location or person" aria-label="Search" className="pl-8" />
          </div>
          <Segmented
            label="Track"
            value={track}
            onChange={setTrack}
            options={[{ value: 'all', label: 'All tracks' }, ...FIT_TRACKS.map((t) => ({ value: t, label: trackLabel(t) })), { value: 'blocked', label: 'Blocked' }]}
          />
          <Segmented
            label="Fit"
            value={fitFilter}
            onChange={setFitFilter}
            options={[
              { value: 'passes', label: 'Passes' },
              { value: 'flagged', label: 'Flagged' },
              { value: 'all', label: 'All' },
            ]}
          />
          <Segmented
            label="People"
            value={peopleFilter}
            onChange={setPeopleFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'none', label: 'No people' },
              { value: 'has', label: 'Has people' },
            ]}
          />
          <Segmented
            label="Section"
            value={section}
            onChange={setSection}
            options={[
              { value: 'all', label: 'All' },
              { value: 'main', label: 'Main' },
              { value: 'referrals', label: 'Referrals' },
            ]}
          />
          <span className="ml-auto font-mono text-[11px] text-fg-46 tabular-nums">
            {visible.length} / {companies.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-[18px] py-2.5">
          <Chip active={status === 'all'} onClick={() => setStatus('all')}>
            Any status
          </Chip>
          {STATUSES.map((s) => (
            <Chip key={s.value} active={status === s.value} onClick={() => setStatus(s.value)}>
              {s.label} <Count n={companies.filter((c) => c.roles.some((r) => r.status === s.value)).length} />
            </Chip>
          ))}
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          <Chip active={band === 'all'} onClick={() => setBand('all')}>
            All sizes
          </Chip>
          {(['small', 'medium', 'large'] as const).map((b) => (
            <Chip key={b} active={band === b} onClick={() => setBand(b)}>
              {BAND_LABEL[b]} <Count n={companies.filter((c) => c.band === b).length} />
            </Chip>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="border-t border-line px-[18px] py-10 text-center text-[13px] text-fg-46">No companies match these filters.</p>
        ) : (
          <div className="max-h-[calc(100dvh-420px)] min-h-[360px] overflow-auto border-t border-line">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 z-[1] bg-surface text-left text-[11px] text-fg-46">
                <tr>
                  {COLS.map((c, i) => (
                    <th key={i} scope="col" className={cn('border-b border-line px-2.5 py-2.5 font-medium first:pl-[18px] last:pr-[18px]', hideCol(c))}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const isOpen = open.has(c.key)
                  const r = c.primary ?? c.roles[0]
                  const rollup = rollupStatus(c.roles)
                  return (
                    <Fragment key={c.key}>
                      <tr className={cn('border-b border-line/60 text-fg-70 transition-colors hover:bg-accent', isOpen && 'bg-accent/40')}>
                        <td className="w-8 py-2 pl-[14px]">
                          <button
                            type="button"
                            onClick={() => toggle(c.key)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${c.name}`}
                            className="inline-flex size-6 items-center justify-center rounded text-fg-46 hover:text-fg"
                          >
                            <ChevronRight className={cn('size-4 transition-transform', isOpen && 'rotate-90')} aria-hidden />
                          </button>
                        </td>
                        <td className="max-w-[200px] px-2.5 py-2">
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => toggle(c.key)} className="min-w-0 truncate text-left text-[13px] text-fg">
                              {c.name}
                            </button>
                            {c.website && (
                              <IconLink href={c.website} label={`${c.name} website`}>
                                <Globe className="size-3.5" aria-hidden />
                              </IconLink>
                            )}
                            {c.linkedin && (
                              <IconLink href={c.linkedin} label={`${c.name} on LinkedIn`}>
                                <LinkedInMark />
                              </IconLink>
                            )}
                            {c.sections.includes('referrals') && <span className="rounded-full border border-line px-1.5 text-[10px] text-fg-46">ref</span>}
                          </div>
                        </td>
                        <td className="max-w-[240px] px-2.5 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate" title={r?.title ?? undefined}>
                              {r?.title ?? 'Untitled role'}
                            </span>
                            {r && (
                              <IconLink href={r.link} label={`Posting on ${BOARD_LABEL[r.board ?? 'other'] ?? 'job page'}`}>
                                <ExternalLink className="size-3.5" aria-hidden />
                              </IconLink>
                            )}
                            {c.roles.length > 1 && (
                              <button type="button" onClick={() => toggle(c.key)} className="shrink-0 rounded-full border border-line px-1.5 text-[10px] whitespace-nowrap text-fg-46 hover:text-fg">
                                +{c.roles.length - 1} role{c.roles.length === 2 ? '' : 's'}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-2.5 py-2">
                          <CategoryPill category={r?.category ?? null} confidence={r?.category_confidence ?? null} />
                        </td>
                        <td className="px-2.5 py-2">
                          {r && <StatusSelect value={r.status} onChange={(v) => saveRole(c, r, { status: v })} label={`Status for ${c.name}: ${r.title ?? 'role'}`} />}
                          {rollup !== r?.status && (
                            <div className="mt-0.5 text-[10px] whitespace-nowrap text-fg-46" title="Furthest-along status across this company's roles">
                              {statusMeta(rollup).label} on another role
                            </div>
                          )}
                        </td>
                        <td className={cn('px-2.5 py-2 whitespace-nowrap text-fg-46', hideCol('Posted'))}>{r?.posted_at ?? '—'}</td>
                        <td className="px-2.5 py-2">
                          <LiveDot liveness={r?.liveness} />
                        </td>
                        <td className={cn('max-w-[130px] truncate px-2.5 py-2', hideCol('Location'))} title={r?.location ?? undefined}>
                          {r?.location ?? '—'}
                        </td>
                        <td className={cn('px-2.5 py-2 font-mono whitespace-nowrap tabular-nums', hideCol('Salary'))}>{r ? salaryLabel(r) : '—'}</td>
                        <td className={cn('px-2.5 py-2', hideCol('Size'))}>
                          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] whitespace-nowrap text-fg-46" title={c.rule}>
                            {c.band[0].toUpperCase() + c.band.slice(1)}
                            {c.employees ? ` · ${c.employees.toLocaleString()}` : ''}
                          </span>
                        </td>
                        <td className="max-w-[190px] px-2.5 py-2">
                          <div className="flex items-center gap-1 overflow-hidden [&_span]:max-w-[170px] [&_span]:truncate">
                            <FlagChips flags={c.flags} override={c.override} compact />
                            {c.draftPaused && c.passes && (
                              <span className="rounded-full border border-line px-1.5 text-[10px] whitespace-nowrap text-fg-46" title="Owner: no SDR notes yet">
                                drafting paused
                              </span>
                            )}
                            {!c.flags.some((f) => f.level !== 'info') && !c.draftPaused && <span className="text-[11px] text-fg-46">passes</span>}
                          </div>
                        </td>
                        <td className="px-2.5 py-2 pr-[18px]">
                          <span className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className={cn('font-mono tabular-nums', c.people.length ? 'text-fg' : 'text-fg-46')}>{c.people.length}</span>
                            {c.people.some((p) => p.in_blockchain_ucla) && <span className="rounded-full border border-primary/40 bg-primary/12 px-1.5 text-[10px] text-fg">B@UCLA</span>}
                            {c.people.some((p) => p.is_ucla) && <span className="rounded-full border border-primary/40 bg-primary/12 px-1.5 text-[10px] text-fg">UCLA</span>}
                            {!c.searchedAt && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => findPeople([c])}
                                title={`At most ${searchesFor(c)} Exa searches, about $${(searchesFor(c) * EST_COST_PER_SEARCH).toFixed(2)}`}
                              >
                                Find
                              </Button>
                            )}
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-line/60">
                          <td colSpan={COLS.length} className="p-0">
                            <CompanyTree
                              company={c}
                              actions={{ onOutreach: setOutreach, onRemove: removePerson, onDraft: (co, p) => draftPerson(co, p), onSaveDraft: saveDraft, drafting, targets }}
                              onOverride={(v) => setOverride(c, v)}
                              onAdded={() => router.refresh()}
                              onRole={(role, body) => saveRole(c, role, body)}
                              onSearch={() => findPeople([c])}
                              searchDisabled={busy}
                              searchCost={searchesFor(c) * EST_COST_PER_SEARCH}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function LiveDot({ liveness }: { liveness: string | null | undefined }) {
  const meta = LIVENESS[liveness ?? 'unchecked'] ?? LIVENESS.unchecked
  return (
    <span className="inline-flex items-center text-fg-46" title={meta.label}>
      <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden />
      <span className="sr-only">{meta.label}</span>
    </span>
  )
}

function PostingLink({ role }: { role: CompanyJob }) {
  return (
    <a
      href={role.link}
      target="_blank"
      rel="noreferrer"
      title={role.link}
      className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[11px] whitespace-nowrap text-fg-70 transition-colors hover:border-primary/40 hover:text-fg"
    >
      {BOARD_LABEL[role.board ?? 'other'] ?? 'Job page'}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  )
}

function StatusSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const meta = statusMeta(value)
  return (
    <select
      value={meta.value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={cn('h-6 cursor-pointer appearance-none rounded-full border px-2.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', TONE[meta.tone])}
    >
      {STATUSES.map((s) => (
        <option key={s.value} value={s.value} className="bg-background text-foreground">
          {s.label}
        </option>
      ))}
    </select>
  )
}

function NotesEditor({ initial, onSave }: { initial: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial)
  return (
    <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-start">
      <textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        autoFocus
        rows={2}
        maxLength={4000}
        placeholder="Who you spoke to, next step, dates…"
        className="min-h-14 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-[13px] text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
      <Button size="sm" onClick={() => onSave(v)}>
        Save
      </Button>
    </div>
  )
}

/** One open role in the expanded row: its own status, flags, posting and notes. */
function RoleLine({ role: r, flags, primary, onRole }: { role: CompanyJob; flags: CompanyView['flags']; primary: boolean; onRole: (r: CompanyJob, body: { status?: string; notes?: string | null }) => void }) {
  const [notesOpen, setNotesOpen] = useState(false)
  return (
    <li className="py-1.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px]">
        <LiveDot liveness={r.liveness} />
        <CategoryPill category={r.category} confidence={r.category_confidence} />
        <span className={cn('min-w-0 truncate text-fg', r.liveness === 'dead' && 'line-through opacity-60')} title={r.title ?? undefined}>
          {r.title ?? 'Untitled role'}
        </span>
        {primary && <span className="rounded-full border border-primary/40 px-1.5 text-[10px] text-fg-70" title="Fit flags, routing and drafts use this role">best fit</span>}
        <FlagChips flags={flags} override={false} compact />
        <span className="ml-auto flex items-center gap-2 text-fg-46">
          <span className="hidden whitespace-nowrap md:inline">{r.location ?? ''}</span>
          <span className="hidden font-mono whitespace-nowrap tabular-nums md:inline">{salaryLabel(r) !== '—' ? salaryLabel(r) : ''}</span>
          <span className="whitespace-nowrap">{r.posted_at ?? ''}</span>
          <PostingLink role={r} />
          <StatusSelect value={r.status} onChange={(v) => onRole(r, { status: v })} label={`Status for ${r.title ?? 'role'}`} />
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            aria-expanded={notesOpen}
            aria-label={`Notes for ${r.title ?? 'role'}`}
            className={cn('inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted', r.notes ? 'text-primary' : 'text-fg-46')}
          >
            <StickyNote className="size-3.5" aria-hidden />
          </button>
        </span>
      </div>
      {notesOpen && (
        <NotesEditor
          initial={r.notes ?? ''}
          onSave={(notes) => {
            onRole(r, { notes: notes.trim() ? notes : null })
            setNotesOpen(false)
          }}
        />
      )}
    </li>
  )
}

interface PersonActions {
  onOutreach: (c: CompanyView, p: PersonRow, v: string) => void
  onRemove: (c: CompanyView, p: PersonRow) => void
  onDraft: (c: CompanyView, p: PersonRow) => void
  onSaveDraft: (c: CompanyView, p: PersonRow, draft: string) => void
  drafting: Set<number>
  /** Top alum + top recruiter per company: the only people drafted by default. */
  targets: Set<number>
}

function CompanyTree({
  company: c,
  actions,
  onAdded,
  onOverride,
  onRole,
  onSearch,
  searchDisabled,
  searchCost,
}: {
  company: CompanyView
  actions: PersonActions
  onAdded: () => void
  onOverride: (v: boolean) => void
  onRole: (r: CompanyJob, body: { status?: string; notes?: string | null }) => void
  onSearch: () => void
  searchDisabled: boolean
  searchCost: number
}) {
  const groups = BRANCH_ORDER.map((b) => {
    const all = c.people.filter((p) => p.branch === b).sort((a, z) => (a.rank ?? 9) - (z.rank ?? 9))
    return { branch: b, main: all.filter((p) => actions.targets.has(p.id)), fallback: all.filter((p) => !actions.targets.has(p.id)) }
  }).filter((g) => g.main.length || g.fallback.length)
  const fallbackCount = groups.reduce((n, g) => n + g.fallback.length, 0)
  const li = (q: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${c.name} ${q}`)}`

  return (
    <div className="flex flex-col gap-4 bg-accent/30 px-[18px] pt-3 pb-4 pl-[52px]">
      <div>
        <div className="mb-1 text-[11px] font-medium tracking-wide text-fg-46 uppercase">
          Open roles <span className="font-mono normal-case">{c.roles.length}</span>
        </div>
        <ul className="divide-y divide-line/50">
          {c.roles.map((r) => (
            <RoleLine key={r.id} role={r} flags={c.roleFlags[r.id] ?? []} primary={r.id === c.primary?.id} onRole={onRole} />
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-1.5 text-[11px] text-fg-46">
        <div>
          <span className="text-fg-70">{c.ruleApplied ? 'Routing applied' : c.searchedAt ? 'Searched with an older rule; next search' : 'Routing (not searched yet)'}:</span> {c.rule}
          {c.searchedAt && (
            <button type="button" disabled={searchDisabled} onClick={onSearch} className="ml-2 text-fg-46 underline-offset-2 hover:text-fg hover:underline disabled:opacity-50" title={`About $${searchCost.toFixed(2)}`}>
              Re-run search
            </button>
          )}
        </div>
        {c.flags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <FlagChips flags={c.flags} override={c.override} />
            {!c.passes && (
              <button
                type="button"
                onClick={() => onOverride(!c.override)}
                className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-70 transition-colors hover:border-primary/40 hover:text-fg"
              >
                {c.override ? 'Remove override' : 'Override: draft anyway'}
              </button>
            )}
          </div>
        )}
        {c.draftPaused && <div>Drafting is paused for the {trackLabel(c.fitTrack)} track.</div>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          {groups.length === 0 ? (
            <p className="text-[12px] text-fg-46">
              {c.searchedAt ? 'Search found nobody matching the targets.' : 'No people yet. Run Find people, or search LinkedIn:'}{' '}
              <a className="text-fg-70 underline-offset-2 hover:underline" href={li('UCLA')} target="_blank" rel="noreferrer">
                UCLA alumni
              </a>
              {' · '}
              <a className="text-fg-70 underline-offset-2 hover:underline" href={li('recruiter')} target="_blank" rel="noreferrer">
                recruiters
              </a>
              {' · '}
              <a className="text-fg-70 underline-offset-2 hover:underline" href={li('head of sales')} target="_blank" rel="noreferrer">
                head of sales
              </a>
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {groups
                .filter((g) => g.main.length)
                .map((g) => (
                  <div key={g.branch}>
                    <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-fg-46 uppercase">
                      <span className={cn('size-1.5 rounded-full', g.branch === 'alumni' || g.branch === 'blockchain_ucla' ? 'bg-primary' : 'bg-fg-24')} aria-hidden />
                      {BRANCH_LABEL[g.branch as Branch]}
                      <span className="font-mono normal-case">{g.main.length}</span>
                    </div>
                    <ul className="mt-1.5 ml-[3px] border-l border-line pl-4">
                      {g.main.map((p) => (
                        <PersonLine key={p.id} company={c} person={p} actions={actions} />
                      ))}
                    </ul>
                  </div>
                ))}
              {fallbackCount > 0 && (
                <details className="group/fb">
                  <summary className="cursor-pointer list-none text-[11px] text-fg-46 hover:text-fg">
                    <ChevronRight className="mr-1 inline size-3 transition-transform group-open/fb:rotate-90" aria-hidden />
                    {fallbackCount} fallback contact{fallbackCount === 1 ? '' : 's'} (not drafted)
                  </summary>
                  <div className="mt-2 flex flex-col gap-3">
                    {groups
                      .filter((g) => g.fallback.length)
                      .map((g) => (
                        <div key={g.branch}>
                          <div className="text-[11px] font-medium tracking-wide text-fg-46 uppercase">{BRANCH_LABEL[g.branch as Branch]}</div>
                          <ul className="mt-1.5 ml-[3px] border-l border-line pl-4">
                            {g.fallback.map((p) => (
                              <PersonLine key={p.id} company={c} person={p} actions={actions} />
                            ))}
                          </ul>
                        </div>
                      ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <AddPerson companyKey={c.key} onAdded={onAdded} />
        </div>
      </div>
    </div>
  )
}

function PersonLine({ company, person: p, actions }: { company: CompanyView; person: PersonRow; actions: PersonActions }) {
  const { onOutreach, onRemove, onDraft, onSaveDraft, drafting, targets } = actions
  const fallback = !targets.has(p.id)
  const meta = OUTREACH.find((o) => o.value === p.outreach_status) ?? OUTREACH[0]
  const busy = drafting.has(p.id)
  return (
    <li className="py-1.5 text-[12px]">
      <div className="group flex flex-wrap items-center gap-x-3 gap-y-1">
      <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-fg hover:text-primary">
        <LinkedInMark />
        <span>{p.full_name}</span>
      </a>
      <span className="min-w-0 truncate text-fg-70" title={p.title ?? undefined}>
        {p.title ?? '—'}
      </span>
      {p.is_ucla && p.branch !== 'alumni' && <span className="rounded-full border border-primary/40 bg-primary/12 px-1.5 text-[10px] text-fg">UCLA</span>}
      {fallback && (
        <span className="rounded-full border border-line px-1.5 text-[10px] text-fg-46" title="Held as a fallback: only the top alum and top recruiter are drafted">
          fallback
        </span>
      )}
      {p.confidence === 'medium' && (
        <span className="rounded-full border border-line px-1.5 text-[10px] text-fg-46" title="Matched on the LinkedIn headline only; check they still work here">
          check
        </span>
      )}
      <span className="ml-auto flex items-center gap-1">
        <select
          value={meta.value}
          onChange={(e) => onOutreach(company, p, e.target.value)}
          aria-label={`Outreach status for ${p.full_name}`}
          className={cn(
            'h-6 cursor-pointer appearance-none rounded-full border px-2.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
            TONE[meta.tone]
          )}
        >
          {OUTREACH.map((o) => (
            <option key={o.value} value={o.value} className="bg-background text-foreground">
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onRemove(company, p)}
          aria-label={`Remove ${p.full_name}`}
          className="inline-flex size-6 items-center justify-center rounded text-fg-46 opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </span>
      </div>
      {p.draft ? (
        <DraftBox
          draft={p.draft}
          busy={busy}
          approved={p.outreach_status === 'approved' || p.outreach_status === 'sent' || p.outreach_status === 'replied'}
          onSave={(d) => onSaveDraft(company, p, d)}
          onRedraft={() => onDraft(company, p)}
          onApprove={() => onOutreach(company, p, 'approved')}
        />
      ) : null}
      {!p.draft && !company.canDraft ? (
        <span className="mt-1 inline-block text-[11px] text-fg-46">{company.draftPaused ? 'Drafting paused for this track' : 'Drafting blocked by fit flags'}</span>
      ) : null}
      {!p.draft && company.canDraft ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onDraft(company, p)}
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-fg-46 transition-colors hover:text-fg disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <PenLine className="size-3" aria-hidden />}
          {busy ? 'Drafting…' : 'Draft note'}
        </button>
      ) : null}
      {p.draft && p.followup ? (
        <div className="mt-1.5 rounded-lg border border-dashed border-line p-2.5">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-medium tracking-wide text-fg-46 uppercase">
            After they accept
            {p.branch === 'recruiting' && company.primary?.status !== 'applied' && (
              <span className="rounded-full border border-amber/30 bg-amber/10 px-1.5 text-amber normal-case" title="Apply before sending; then set the job to Applied and redraft for the applied wording">
                apply first
              </span>
            )}
          </div>
          <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-fg-70">{p.followup}</p>
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-46 transition-colors hover:bg-muted hover:text-fg"
              onClick={() => {
                navigator.clipboard.writeText(p.followup ?? '')
                toast.success('Copied')
              }}
            >
              <Copy className="size-3" aria-hidden /> Copy
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

function DraftBox({
  draft,
  busy,
  approved,
  onSave,
  onRedraft,
  onApprove,
}: {
  draft: string
  busy: boolean
  approved: boolean
  onSave: (d: string) => void
  onRedraft: () => void
  onApprove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(draft)
  const [seenDraft, setSeenDraft] = useState(draft)
  if (seenDraft !== draft) {
    setSeenDraft(draft)
    setValue(draft)
  }
  const len = (editing ? value : draft).length
  const btn =
    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-46 transition-colors hover:bg-muted hover:text-fg disabled:opacity-50'
  const copy = () => {
    navigator.clipboard.writeText(draft)
    toast.success('Copied')
  }
  const cancel = () => {
    setEditing(false)
    setValue(draft)
  }
  const save = () => {
    onSave(value)
    setEditing(false)
  }
  return (
    <div className="mt-1.5 rounded-lg border border-line bg-black/20 p-2.5">
      {editing ? (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={4}
          autoFocus
          aria-label="Edit draft"
          className="w-full resize-y bg-transparent text-[12px] leading-relaxed text-fg outline-none"
        />
      ) : (
        <p className={cn('text-[12px] leading-relaxed whitespace-pre-wrap text-fg-70', busy && 'opacity-50')}>{draft}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className={cn('mr-auto font-mono text-[10px] tabular-nums', len > PROFILE.noteLimit ? 'text-red' : 'text-fg-46')}>
          {len}/{PROFILE.noteLimit}
        </span>
        {editing ? (
          <>
            <button type="button" className={btn} onClick={cancel}>
              Cancel
            </button>
            <button type="button" className={btn} onClick={save}>
              <Check className="size-3" aria-hidden /> Save
            </button>
          </>
        ) : (
          <>
            <button type="button" className={btn} onClick={copy}>
              <Copy className="size-3" aria-hidden /> Copy
            </button>
            <button type="button" className={btn} onClick={() => setEditing(true)} disabled={busy}>
              <PenLine className="size-3" aria-hidden /> Edit
            </button>
            <button type="button" className={btn} onClick={onRedraft} disabled={busy}>
              {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RefreshCw className="size-3" aria-hidden />} Redraft
            </button>
            {!approved && (
              <button type="button" className={cn(btn, 'text-primary hover:text-primary')} onClick={onApprove} disabled={busy}>
                <Check className="size-3" aria-hidden /> Approve
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function AddPerson({ companyKey, onAdded }: { companyKey: string; onAdded: () => void }) {
  const [openForm, setOpenForm] = useState(false)
  const [form, setForm] = useState({ linkedin_url: '', full_name: '', title: '', branch: 'recruiting' })
  const [saving, setSaving] = useState(false)
  if (!openForm) {
    return (
      <Button size="sm" variant="ghost" className="self-start" onClick={() => setOpenForm(true)}>
        <Plus aria-hidden />
        Add person
      </Button>
    )
  }
  async function save() {
    setSaving(true)
    const res = await fetch('/api/people', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company_key: companyKey, ...form, title: form.title || undefined }),
    }).catch(() => null)
    const body = await res?.json().catch(() => null)
    setSaving(false)
    if (!res?.ok) return toast.error(body?.error ?? 'Could not add')
    toast.success(`Added ${body.full_name}`)
    setForm({ linkedin_url: '', full_name: '', title: '', branch: 'recruiting' })
    setOpenForm(false)
    onAdded()
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-2.5">
      <Input placeholder="LinkedIn profile URL" value={form.linkedin_url} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })} />
      <Input placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
      <Input placeholder="Title (optional)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <select
        value={form.branch}
        onChange={(e) => setForm({ ...form, branch: e.target.value })}
        aria-label="Branch"
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-[13px] text-fg dark:bg-input/30"
      >
        {(['alumni', 'recruiting', 'gtm_leadership', 'executive', 'other'] as const).map((b) => (
          <option key={b} value={b} className="bg-background">
            {BRANCH_LABEL[b]}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving || !form.linkedin_url || !form.full_name}>
          {saving ? 'Adding…' : 'Add'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpenForm(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
