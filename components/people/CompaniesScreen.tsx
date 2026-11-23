'use client'

import { Fragment, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronRight, Copy, ExternalLink, Globe, Loader2, PenLine, Plus, RefreshCw, Search, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { PageHead } from '@/components/shell/PageHead'
import { GlassCard } from '@/components/ui/glass-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Chip, Count, IconLink, LinkedInMark, Segmented, TONE, TierPill } from '@/components/ui/bits'
import { cn } from '@/lib/utils'
import type { CompanyView } from '@/lib/people/companies'
import { BAND_LABEL, type SizeBand } from '@/lib/people/size'
import { BRANCH_LABEL, BRANCH_ORDER, EST_COST_PER_SEARCH, maxSearches, type Branch } from '@/lib/people/targets'
import { OUTREACH, type PersonRow } from '@/lib/people/types'

/** Measured 2026-11-22: about $0.004 per note; preview rounds up. */
const DRAFT_COST = 0.006

type PeopleFilter = 'all' | 'none' | 'has'
type TierFilter = 'all' | 1 | 2

const BAND_RULE: Record<SizeBand, string> = {
  small: 'Head of recruiting + head of GTM / sales; no GTM head → founder / CEO / CRO',
  medium: 'Recruiting + GTM leadership; no GTM head → CRO / VP Revenue; nothing → founder',
  large: 'Sales recruiting lead → else head of recruiting / talent → else recruiters',
}

export function CompaniesScreen({ initial, openKey }: { initial: CompanyView[]; openKey: string | null }) {
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
  const [tier, setTier] = useState<TierFilter>(1)
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>('all')
  const [confirming, setConfirming] = useState(false)
  const [confirmingDrafts, setConfirmingDrafts] = useState(false)
  const [drafting, setDrafting] = useState<Set<number>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number; spent: number; current: string } | null>(null)
  const stopRef = useRef(false)

  const stats = useMemo(() => {
    const people = companies.flatMap((c) => c.people)
    return [
      { label: 'Companies', value: companies.length, hint: `${companies.filter((c) => c.bestTier === 1).length} with a tier 1 role` },
      { label: 'Searched', value: companies.filter((c) => c.searchedAt).length, hint: 'Exa people search run' },
      { label: 'People', value: people.length, hint: `${people.filter((p) => p.branch === 'poster').length} job posters` },
      { label: 'UCLA alumni', value: people.filter((p) => p.is_ucla).length, hint: 'warmest first touch' },
      { label: 'Contacted', value: people.filter((p) => p.outreach_status === 'sent' || p.outreach_status === 'replied').length, hint: `${people.filter((p) => p.outreach_status === 'replied').length} replied` },
      { label: 'Exa spend', value: `$${companies.reduce((n, c) => n + c.spend, 0).toFixed(2)}`, hint: 'all searches so far' },
    ]
  }, [companies])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return companies.filter(
      (c) =>
        (band === 'all' || c.band === band) &&
        (tier === 'all' || (c.bestTier != null && c.bestTier <= tier)) &&
        (peopleFilter === 'all' || (peopleFilter === 'none' ? c.people.length === 0 : c.people.length > 0)) &&
        (!q || c.name.toLowerCase().includes(q) || c.people.some((p) => p.full_name.toLowerCase().includes(q)))
    )
  }, [companies, query, band, tier, peopleFilter])

  const unsearched = visible.filter((c) => !c.searchedAt)
  const estimate = (list: CompanyView[]) => list.reduce((n, c) => n + maxSearches(c.band), 0) * EST_COST_PER_SEARCH

  const undrafted = visible.flatMap((c) => c.people.filter((p) => !p.draft && p.outreach_status !== 'skip').map((p) => ({ c, p })))

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
    if (!quiet && body.tooLong) toast.warning('Draft is over 300 characters; trim it before sending.')
    return true
  }

  async function draftAll(list: { c: CompanyView; p: PersonRow }[]) {
    setConfirmingDrafts(false)
    stopRef.current = false
    let done = 0
    for (let i = 0; i < list.length; i += 4) {
      if (stopRef.current) break
      setProgress({ done: i, total: list.length, spent: 0, current: list[i].p.full_name })
      // Small parallel batches keep it quick without tripping rate limits.
      const ok = await Promise.all(list.slice(i, i + 4).map(({ c, p }) => draftPerson(c, p, true)))
      done += ok.filter(Boolean).length
    }
    setProgress(null)
    toast.success(`Drafted ${done} notes`)
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

  return (
    <div className="flex flex-col gap-5">
      <PageHead
        eyebrow="Job hunt"
        title="Companies"
        sub="Who to reach out to at each company, by size band. Searches use Exa and only run after you confirm the cost."
        actions={
          busy ? (
            <Button variant="outline" onClick={() => (stopRef.current = true)}>
              <Loader2 className="animate-spin" aria-hidden />
              {progress.done}/{progress.total}{progress.spent ? ` · $${progress.spent.toFixed(2)}` : ''} · Stop
            </Button>
          ) : (
            <>
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
            <span className="font-mono text-fg">{unsearched.reduce((n, c) => n + maxSearches(c.band), 0)}</span> Exa searches, at most{' '}
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
            Draft LinkedIn notes for <span className="text-fg">{undrafted.length}</span> people in this view with Claude Opus 5.5: about{' '}
            <span className="font-mono text-fg">${(undrafted.length * DRAFT_COST).toFixed(2)}</span>. Nothing is sent; you review each one.
          </div>
          <Button variant="ghost" onClick={() => setConfirmingDrafts(false)}>
            Cancel
          </Button>
          <Button onClick={() => draftAll(undrafted)}>Draft notes</Button>
        </GlassCard>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <GlassCard key={s.label} size="sm" className="gap-0 px-4">
            <div className="text-[13px] font-medium text-muted-foreground">{s.label}</div>
            <div className="mt-2 font-mono text-3xl leading-none font-semibold tracking-tight text-foreground tabular-nums">{s.value}</div>
            <div className="mt-2 text-xs text-fg-46">{s.hint}</div>
          </GlassCard>
        ))}
      </div>

      <section className="surface min-w-0 overflow-hidden rounded-panel" aria-label="Companies">
        <div className="flex flex-wrap items-center gap-2 px-[18px] py-3">
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-46" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Company or person" aria-label="Search companies" className="pl-8" />
          </div>
          <Segmented
            label="Best tier"
            value={tier}
            onChange={setTier}
            options={[
              { value: 1, label: 'Tier 1' },
              { value: 2, label: 'Tier 1–2' },
              { value: 'all', label: 'All tiers' },
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
          <span className="ml-auto font-mono text-[11px] text-fg-46 tabular-nums">
            {visible.length} / {companies.length}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 border-t border-line px-[18px] py-2.5">
          <Chip active={band === 'all'} onClick={() => setBand('all')}>
            All sizes <Count n={companies.length} />
          </Chip>
          {(['small', 'medium', 'large'] as const).map((b) => (
            <Chip key={b} active={band === b} onClick={() => setBand(b)}>
              {BAND_LABEL[b]} <Count n={companies.filter((c) => c.band === b).length} />
            </Chip>
          ))}
          {band !== 'all' && <span className="self-center pl-1 text-[11px] text-fg-46">Targets: {BAND_RULE[band]}</span>}
        </div>

        {visible.length === 0 ? (
          <p className="border-t border-line px-[18px] py-10 text-center text-[13px] text-fg-46">No companies match these filters.</p>
        ) : (
          <ul className="max-h-[calc(100dvh-380px)] min-h-[320px] overflow-auto border-t border-line">
            {visible.map((c) => {
              const isOpen = open.has(c.key)
              return (
                <li key={c.key} className="border-b border-line/60 last:border-0">
                  <div className="flex items-center gap-3 px-[18px] py-2.5 text-[12px] text-fg-70 transition-colors hover:bg-accent">
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${c.name}`}
                      className="inline-flex size-6 items-center justify-center rounded text-fg-46 hover:text-fg"
                    >
                      <ChevronRight className={cn('size-4 transition-transform', isOpen && 'rotate-90')} aria-hidden />
                    </button>
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
                    <span className="hidden rounded-full border border-line px-2 py-0.5 text-[11px] whitespace-nowrap text-fg-46 sm:inline" title={BAND_RULE[c.band]}>
                      {c.band[0].toUpperCase() + c.band.slice(1)}
                      {c.employees ? ` · ${c.employees.toLocaleString()}` : ''}
                    </span>
                    <TierPill tier={c.bestTier} />
                    <span className="hidden text-fg-46 md:inline">
                      {c.roles.length} role{c.roles.length === 1 ? '' : 's'}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className={cn('font-mono tabular-nums', c.people.length ? 'text-fg' : 'text-fg-46')}>
                        {c.people.length} {c.people.length === 1 ? 'person' : 'people'}
                      </span>
                      {c.people.some((p) => p.is_ucla) && (
                        <span className="rounded-full border border-primary/40 bg-primary/12 px-1.5 text-[10px] text-fg">UCLA</span>
                      )}
                      <Button
                        size="sm"
                        variant={c.searchedAt ? 'ghost' : 'outline'}
                        disabled={busy}
                        onClick={() => findPeople([c])}
                        title={`At most ${maxSearches(c.band)} Exa searches, about $${(maxSearches(c.band) * EST_COST_PER_SEARCH).toFixed(2)}`}
                      >
                        {c.searchedAt ? 'Re-run' : 'Find people'}
                      </Button>
                    </span>
                  </div>
                  {isOpen && (
                    <CompanyTree
                      company={c}
                      actions={{ onOutreach: setOutreach, onRemove: removePerson, onDraft: (co, p) => draftPerson(co, p), onSaveDraft: saveDraft, drafting }}
                      onAdded={() => router.refresh()}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

interface PersonActions {
  onOutreach: (c: CompanyView, p: PersonRow, v: string) => void
  onRemove: (c: CompanyView, p: PersonRow) => void
  onDraft: (c: CompanyView, p: PersonRow) => void
  onSaveDraft: (c: CompanyView, p: PersonRow, draft: string) => void
  drafting: Set<number>
}

function CompanyTree({ company: c, actions, onAdded }: { company: CompanyView; actions: PersonActions; onAdded: () => void }) {
  const groups = BRANCH_ORDER.map((b) => ({
    branch: b,
    people: c.people.filter((p) => p.branch === b).sort((a, z) => (a.rank ?? 9) - (z.rank ?? 9)),
  })).filter((g) => g.people.length)
  const li = (q: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${c.name} ${q}`)}`

  return (
    <div className="grid gap-4 bg-accent/30 px-[18px] pt-1 pb-4 pl-[52px] lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">
        <div className="mb-2 text-[11px] text-fg-46">{BAND_RULE[c.band]}</div>
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
            {groups.map((g) => (
              <div key={g.branch}>
                <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-fg-46 uppercase">
                  <span className={cn('size-1.5 rounded-full', g.branch === 'alumni' ? 'bg-primary' : 'bg-fg-24')} aria-hidden />
                  {BRANCH_LABEL[g.branch as Branch]}
                  <span className="font-mono normal-case">{g.people.length}</span>
                </div>
                <ul className="mt-1.5 ml-[3px] border-l border-line pl-4">
                  {g.people.map((p) => (
                    <Fragment key={p.id}>
                      <PersonLine company={c} person={p} actions={actions} />
                    </Fragment>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <div className="mb-1.5 text-[11px] font-medium tracking-wide text-fg-46 uppercase">Open roles</div>
          <ul className="flex flex-col gap-1">
            {c.roles.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-[12px]">
                <TierPill tier={r.tier} />
                <a href={r.link} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-fg-70 hover:text-fg">
                  <span className="truncate">{r.title ?? 'Untitled role'}</span>
                  <ExternalLink className="size-3 shrink-0 opacity-60" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </div>
        <AddPerson companyKey={c.key} onAdded={onAdded} />
      </div>
    </div>
  )
}

function PersonLine({ company, person: p, actions }: { company: CompanyView; person: PersonRow; actions: PersonActions }) {
  const { onOutreach, onRemove, onDraft, onSaveDraft, drafting } = actions
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
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => onDraft(company, p)}
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-fg-46 transition-colors hover:text-fg disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <PenLine className="size-3" aria-hidden />}
          {busy ? 'Drafting…' : 'Draft note'}
        </button>
      )}
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
        <span className={cn('mr-auto font-mono text-[10px] tabular-nums', len > 300 ? 'text-red' : 'text-fg-46')}>{len}/300</span>
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
