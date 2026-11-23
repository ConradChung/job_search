'use client'

import { cn } from '@/lib/utils'
import type { Tone } from '@/lib/jobs/statuses'
import { CATEGORIES, isCategory } from '@/lib/jobs/categories'
import { PROFILE } from '@/lib/profile'
import type { FitFlag } from '@/lib/jobs/fit'

/* Shared bits for the Jobs and Companies screens (Lume pill / chip styles). */

export const TONE: Record<Tone, string> = {
  wait: 'bg-amber/12 text-amber border-amber/25',
  run: 'bg-violet/12 text-violet-soft border-violet/25',
  ok: 'bg-green/12 text-green border-green/25',
  bad: 'bg-red/12 text-red border-red/25',
  idle: 'bg-white/[.04] text-fg-46 border-line',
}

export function IconLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
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
export function LinkedInMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  )
}

export function Segmented<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode; count?: number }[]
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
            value === o.value && 'bg-muted text-fg',
            o.count === 0 && value !== o.value && 'opacity-40'
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1 font-mono text-[11px] tabular-nums opacity-70">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** dim: clicking would show no rows (kept visible, not hidden). */
export function Chip({ active, onClick, children, dim = false }: { active: boolean; onClick: (e?: React.MouseEvent) => void; children: React.ReactNode; dim?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors',
        active ? 'border-primary/40 bg-primary/12 text-fg' : 'border-line text-fg-46 hover:text-fg',
        dim && !active && 'opacity-40'
      )}
    >
      {children}
    </button>
  )
}

export function Count({ n }: { n: number }) {
  return <span className="font-mono tabular-nums opacity-70">{n}</span>
}

/** Role category from the classifier; low confidence (title only) is dashed and says so. */
export function CategoryPill({ category, confidence }: { category: string | null; confidence: string | null }) {
  if (!category || !isCategory(category)) {
    return <span className="rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-fg-46">Unclassified</span>
  }
  const meta = CATEGORIES[category]
  const tier = PROFILE.constraints.tracks[category]?.tier
  const low = confidence === 'low'
  const medium = confidence === 'medium'
  return (
    <span
      title={`${tier ? `Tier ${tier}. ` : ''}${meta.label}: ${meta.hint}. Confidence: ${confidence ?? 'unknown'}${low ? ' (title only, no posting text)' : ''}`}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] whitespace-nowrap',
        category === 'gtm_eng'
          ? 'border-primary/40 bg-primary/12 text-fg'
          : category === 'sdr'
            ? 'border-[#38bdf8]/40 bg-[#38bdf8]/12 text-fg'
            : category === 'revops'
              ? 'border-amber/30 bg-amber/10 text-fg'
              : 'border-line text-fg-70',
        low && 'border-dashed bg-transparent'
      )}
    >
      {tier ? <span className="font-mono text-[10px] text-fg-46">T{tier}</span> : null}
      {meta.label}
      {low && <span className="text-fg-46">· title only</span>}
      {medium && <span className="text-fg-46">?</span>}
    </span>
  )
}

const FLAG_TONE: Record<FitFlag['level'], string> = {
  block: 'border-red/30 bg-red/10 text-red',
  warn: 'border-amber/30 bg-amber/10 text-amber',
  info: 'border-line text-fg-46',
}

/** Fit flags. Compact mode shows the most severe one plus a count. */
export function FlagChips({ flags, override, compact = false }: { flags: FitFlag[]; override: boolean; compact?: boolean }) {
  const shown = flags.filter((f) => !compact || f.level !== 'info')
  if (!shown.length) return null
  const order = { block: 0, warn: 1, info: 2 }
  const sorted = [...shown].sort((a, b) => order[a.level] - order[b.level])
  const list = compact ? sorted.slice(0, 1) : sorted
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {list.map((f, i) => (
        <span key={i} title={f.message} className={cn('inline-flex h-5 items-center rounded-full border px-2 text-[10px] whitespace-nowrap', FLAG_TONE[f.level], override && f.level === 'block' && 'line-through opacity-70')}>
          {compact ? (f.level === 'block' ? '⚠ ' : '') + f.message : f.message}
        </span>
      ))}
      {compact && sorted.length > 1 && <span className="text-[10px] text-fg-46">+{sorted.length - 1}</span>}
      {override && <span className="text-[10px] text-primary">overridden</span>}
    </span>
  )
}
