'use client'

import { useMemo, useState, useTransition, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, Globe, Info, RefreshCw, Search, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import { PageHead } from '@/components/shell/PageHead'
import { GlassCard } from '@/components/ui/glass-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { STATUSES, statusMeta, type Tone } from '@/lib/jobs/statuses'
import type { JobRow } from '@/lib/jobs/types'
import { TIERS, tierMeta } from '@/lib/jobs/tiers'

const TONE: Record<Tone, string> = {
  wait: 'bg-amber/12 text-amber border-amber/25',
  run: 'bg-violet/12 text-violet-soft border-violet/25',
  ok: 'bg-green/12 text-green border-green/25',
  bad: 'bg-red/12 text-red border-red/25',
  idle: 'bg-white/[.04] text-fg-46 border-line',
}

const LIVENESS: Record<JobRow['liveness'], { dot: string; label: string }> = {
  live: { dot: 'bg-green', label: 'Live' },
  dead: { dot: 'bg-red', label: 'Dead' },
  unchecked: { dot: 'bg-fg-24', label: 'Not checked' },
}

type Section = 'all' | 'main' | 'referrals'

export function JobsScreen({ initial }: { initial: JobRow[] }) {
  const router = useRouter()
  const [jobs, setJobs] = useState(initial)
  const [query, setQuery] = useState('')
  const [tier, setTier] = useState<number | 'all'>('all')
  const [status, setStatus] = useState<string>('all')
  const [section, setSection] = useState<Section>('all')
  const [openNotes, setOpenNotes] = useState<number | null>(null)
  const [showTierHelp, setShowTierHelp] = useState(false)
  const [syncing, startSync] = useTransition()

  // Keep local state in step with a server refresh (after a sync).
  const [seen, setSeen] = useState(initial)
  if (seen !== initial) {
    setSeen(initial)
    setJobs(initial)
  }

  const stats = useMemo(() => {
    const by = (s: string) => jobs.filter((j) => j.status === s).length
    return [
      { label: 'Roles', value: jobs.length, hint: `${jobs.filter((j) => j.section === 'referrals').length} in referrals` },
      { label: 'Tier 1 roles', value: jobs.filter((j) => j.fit_tier === 1).length, hint: 'GTM / founding / growth engineer' },
      { label: 'Reached out', value: by('reached_out'), hint: 'messaged, not applied' },
      { label: 'Applied', value: by('applied'), hint: 'application in' },
      { label: 'Interviewing', value: by('interviewing') + by('offer'), hint: `${by('offer')} offer` },
      {
        label: 'Live',
        value: jobs.filter((j) => j.liveness === 'live').length,
        hint: `${jobs.filter((j) => j.liveness === 'unchecked').length} not checked`,
      },
    ]
  }, [jobs])

  const statusCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const j of jobs) m.set(j.status, (m.get(j.status) ?? 0) + 1)
    return m
  }, [jobs])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return jobs.filter(
      (j) =>
        (tier === 'all' || j.fit_tier === tier) &&
        (status === 'all' || j.status === status) &&
        (section === 'all' || j.section === section) &&
        (!q ||
          j.company.toLowerCase().includes(q) ||
          (j.title ?? '').toLowerCase().includes(q) ||
          (j.location ?? '').toLowerCase().includes(q))
    )
  }, [jobs, query, tier, status, section])

  async function patch(id: number, body: { status?: string; notes?: string | null }) {
    const before = jobs.find((j) => j.id === id)
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...body } : j)))
    const res = await fetch(`/api/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
    if (!res?.ok) {
      if (before) setJobs((js) => js.map((j) => (j.id === id ? before : j)))
      toast.error('Could not save. Try again.')
      return
    }
    const saved = await res.json()
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...saved } : j)))
  }

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

  return (
    <div className="flex flex-col gap-5">
      <PageHead
        eyebrow="Job hunt"
        title="Jobs"
        sub="Roles from the Jobs Final sheet. Status and notes live here; sync only adds new rows and refreshes sheet details."
        actions={
          <Button variant="outline" onClick={sync} disabled={syncing}>
            <RefreshCw className={cn(syncing && 'animate-spin')} aria-hidden />
            {syncing ? 'Syncing…' : 'Sync from sheet'}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <GlassCard key={s.label} size="sm" className="gap-0 px-4">
            <div className="text-[13px] font-medium text-muted-foreground">{s.label}</div>
            <div className="mt-2 font-mono text-3xl leading-none font-semibold tracking-tight text-foreground tabular-nums">
              {s.value}
            </div>
            <div className="mt-2 text-xs text-fg-46">{s.hint}</div>
          </GlassCard>
        ))}
      </div>

      <section className="surface min-w-0 overflow-hidden rounded-panel" aria-label="Jobs">
        <div className="flex flex-wrap items-center gap-2 px-[18px] py-3">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-46" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Company, role or location"
              aria-label="Search jobs"
              className="pl-8"
            />
          </div>
          <Segmented
            label="Tier"
            value={tier}
            onChange={setTier}
            options={[{ value: 'all', label: 'All tiers' }, ...TIERS.map((t) => ({ value: t.tier, label: `${t.tier} · ${t.short}` }))]}
          />
          <button
            type="button"
            onClick={() => setShowTierHelp((v) => !v)}
            aria-expanded={showTierHelp}
            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-fg-46 transition-colors hover:text-fg"
          >
            <Info className="size-3.5" aria-hidden />
            How tiers work
          </button>
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
            {visible.length} / {jobs.length}
          </span>
        </div>

        {showTierHelp && (
          <div className="border-t border-line px-[18px] py-3 text-[12px] text-fg-70">
            <p className="mb-2 text-fg-46">
              Fit tier ranks the <span className="text-fg">job title only</span> (not the company), set when the jobs were
              scraped. The first rule that matches wins; 1 is the best fit.
            </p>
            <ul className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-5">
              {TIERS.map((t) => (
                <li key={t.tier} className="rounded-lg border border-line px-2.5 py-2">
                  <div className="font-medium text-fg">
                    Tier {t.tier} · {t.label}
                  </div>
                  <div className="mt-0.5 text-fg-46">{t.rule}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 border-t border-line px-[18px] py-2.5">
          <Chip active={status === 'all'} onClick={() => setStatus('all')}>
            All statuses <Count n={jobs.length} />
          </Chip>
          {STATUSES.map((s) => (
            <Chip key={s.value} active={status === s.value} onClick={() => setStatus(s.value)}>
              {s.label} <Count n={statusCounts.get(s.value) ?? 0} />
            </Chip>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="border-t border-line px-[18px] py-10 text-center text-[13px] text-fg-46">No roles match these filters.</p>
        ) : (
          <div className="max-h-[calc(100dvh-360px)] min-h-[320px] overflow-auto border-t border-line">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 z-[1] bg-surface text-left text-[11px] text-fg-46">
                <tr>
                  {['Company', 'Role', 'Posting', 'Fit tier', 'Status', 'Funding', 'Salary', 'Location', 'Posted', 'Live', ''].map((c, i) => (
                    <th
                      key={i}
                      scope="col"
                      className={cn(
                        'border-b border-line px-3 py-2.5 font-medium first:pl-[18px] last:pr-[18px]',
                        ['Funding', 'Salary', 'Posted'].includes(c) && 'hidden lg:table-cell',
                        c === 'Location' && 'hidden md:table-cell'
                      )}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((j) => (
                  <Fragment key={j.id}>
                    <tr className="border-b border-line/60 text-fg-70 transition-colors hover:bg-accent">
                      <td className="max-w-[180px] px-3 py-2.5 pl-[18px]">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-fg">{j.company}</span>
                          {j.company_website && (
                            <IconLink href={j.company_website} label={`${j.company} website`}>
                              <Globe className="size-3.5" aria-hidden />
                            </IconLink>
                          )}
                          {j.company_linkedin && (
                            <IconLink href={j.company_linkedin} label={`${j.company} on LinkedIn`}>
                              <LinkedInMark />
                            </IconLink>
                          )}
                          {j.section === 'referrals' && (
                            <span className="rounded-full border border-line px-1.5 text-[10px] text-fg-46">ref</span>
                          )}
                        </div>
                      </td>
                      <td className="max-w-[280px] px-3 py-2.5">
                        <span className="block truncate" title={j.title ?? undefined}>
                          {j.title ?? 'Untitled role'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <a
                          href={j.link}
                          target="_blank"
                          rel="noreferrer"
                          title={j.link}
                          className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[11px] whitespace-nowrap text-fg-70 transition-colors hover:border-primary/40 hover:text-fg"
                        >
                          {BOARD_LABEL[j.board ?? 'other'] ?? 'Job page'}
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                      </td>
                      <td className="px-3 py-2.5">
                        <TierPill tier={j.fit_tier} />
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusSelect value={j.status} onChange={(v) => patch(j.id, { status: v })} />
                      </td>
                      <td className="hidden px-3 py-2.5 whitespace-nowrap lg:table-cell">{j.funding_stage ?? '—'}</td>
                      <td className="hidden px-3 py-2.5 whitespace-nowrap font-mono tabular-nums lg:table-cell">
                        {salaryLabel(j)}
                      </td>
                      <td className="hidden max-w-[180px] truncate px-3 py-2.5 md:table-cell" title={j.location ?? undefined}>
                        {j.location ?? '—'}
                      </td>
                      <td className="hidden px-3 py-2.5 whitespace-nowrap text-fg-46 lg:table-cell">{j.posted_at ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-fg-46" title={LIVENESS[j.liveness].label}>
                          <span className={cn('size-1.5 rounded-full', LIVENESS[j.liveness].dot)} aria-hidden />
                          <span className="sr-only">{LIVENESS[j.liveness].label}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 pr-[18px] text-right">
                        <button
                          type="button"
                          onClick={() => setOpenNotes(openNotes === j.id ? null : j.id)}
                          aria-expanded={openNotes === j.id}
                          aria-label={`Notes for ${j.company}`}
                          className={cn(
                            'inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-muted',
                            j.notes ? 'text-primary' : 'text-fg-46'
                          )}
                        >
                          <StickyNote className="size-3.5" aria-hidden />
                        </button>
                      </td>
                    </tr>
                    {openNotes === j.id && (
                      <tr className="border-b border-line/60 bg-accent/40">
                        <td colSpan={11} className="px-[18px] py-3">
                          <NotesEditor
                            initial={j.notes ?? ''}
                            onSave={(notes) => {
                              patch(j.id, { notes: notes.trim() ? notes : null })
                              setOpenNotes(null)
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

const BOARD_LABEL: Record<string, string> = {
  ashby: 'Ashby',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  linkedin: 'LinkedIn',
  other: 'Job page',
}

function IconLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-fg-46 transition-colors hover:text-primary"
    >
      {children}
    </a>
  )
}

/** LinkedIn "in" mark (lucide dropped brand icons). */
function LinkedInMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  )
}

function TierPill({ tier }: { tier: number | null }) {
  const meta = tierMeta(tier)
  if (!meta) return <span className="text-fg-46" title="No tier in the sheet">—</span>
  return (
    <span
      title={`Tier ${meta.tier}: ${meta.label}. ${meta.rule}`}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] whitespace-nowrap',
        meta.tier === 1 ? 'border-primary/40 bg-primary/12 text-fg' : 'border-line text-fg-70'
      )}
    >
      <span className="font-mono tabular-nums">{meta.tier}</span>
      {meta.short}
    </span>
  )
}

function salaryLabel(j: JobRow) {
  const k = (n: number) => `$${Math.round(n / 1000)}k`
  if (j.salary_min && j.salary_max) return `${k(j.salary_min)}–${k(j.salary_max)}`
  if (j.salary_min) return `${k(j.salary_min)}+`
  return '—'
}

function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const meta = statusMeta(value)
  return (
    <select
      value={meta.value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Status"
      className={cn(
        'h-6 cursor-pointer appearance-none rounded-full border px-2.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
        TONE[meta.tone]
      )}
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
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
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

function Segmented<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-6 rounded-md px-2 text-[12px] text-fg-46 transition-colors hover:text-fg',
            value === o.value && 'bg-muted text-fg'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors',
        active ? 'border-primary/40 bg-primary/12 text-fg' : 'border-line text-fg-46 hover:text-fg'
      )}
    >
      {children}
    </button>
  )
}

function Count({ n }: { n: number }) {
  return <span className="font-mono tabular-nums opacity-70">{n}</span>
}
