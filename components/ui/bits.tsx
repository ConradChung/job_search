'use client'

import { cn } from '@/lib/utils'
import type { Tone } from '@/lib/jobs/statuses'
import { tierMeta } from '@/lib/jobs/tiers'

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

export function TierPill({ tier }: { tier: number | null }) {
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

export function Segmented<T extends string | number>({
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

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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

export function Count({ n }: { n: number }) {
  return <span className="font-mono tabular-nums opacity-70">{n}</span>
}
