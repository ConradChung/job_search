import { PROFILE } from '@/lib/profile'
import { CATEGORIES, isCategory } from './categories'

/** The fields fit flags read from a classified job. */
export interface FitInput {
  category: string | null
  category_confidence: string | null
  seniority: string | null
  work_mode: string | null
  work_locations: string[] | null
  start_requirement: string | null
  start_date: string | null
  liveness?: string | null
}

export interface FitFlag {
  code: 'category' | 'seniority' | 'location' | 'start' | 'unclassified' | 'dead'
  /** block: drafting is skipped until the owner overrides. warn: shown, still drafts. info: shown only. */
  level: 'block' | 'warn' | 'info'
  message: string
}

type Constraints = {
  categories: readonly string[]
  seniorityBlock: readonly string[]
  seniorityWarn: readonly string[]
  locations: readonly string[]
  remoteOk: boolean
  earliestStart: string
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Constraint checks for one job (lib/profile.ts → constraints). */
export function fitFlags(job: FitInput, c: Constraints = PROFILE.constraints): FitFlag[] {
  const flags: FitFlag[] = []
  if (job.liveness === 'dead') flags.push({ code: 'dead', level: 'block', message: 'Posting is closed' })

  if (!job.category) {
    flags.push({ code: 'unclassified', level: 'block', message: 'Not classified yet' })
    return flags
  }
  if (!c.categories.includes(job.category)) {
    const label = isCategory(job.category) ? CATEGORIES[job.category].label : job.category
    flags.push({ code: 'category', level: 'block', message: `Category is ${label}, not GTM Eng` })
  }

  if (job.seniority && c.seniorityBlock.includes(job.seniority)) {
    flags.push({ code: 'seniority', level: 'block', message: `Seniority: ${job.seniority === 'director_plus' ? 'director or above' : job.seniority}` })
  } else if (job.seniority && c.seniorityWarn.includes(job.seniority)) {
    flags.push({ code: 'seniority', level: 'warn', message: 'Mid-level role' })
  }

  if (!c.locations.length) {
    flags.push({ code: 'location', level: 'info', message: 'Location not checked (no locations in profile)' })
  } else if (job.work_mode === 'remote' && c.remoteOk) {
    // remote passes
  } else if (job.work_mode === 'onsite' || job.work_mode === 'hybrid') {
    const places = (job.work_locations ?? []).map(norm)
    const ok = places.length === 0 || places.some((p) => c.locations.some((l) => p.includes(norm(l)) || norm(l).includes(p)))
    if (!ok) flags.push({ code: 'location', level: 'block', message: `Requires ${job.work_mode} in ${(job.work_locations ?? []).join(' / ')}` })
  }

  if (job.start_requirement === 'immediate') {
    flags.push({ code: 'start', level: 'block', message: 'Needs an immediate start (you graduate March 2027)' })
  } else if (job.start_requirement === 'specific_date' && job.start_date && job.start_date < c.earliestStart) {
    flags.push({ code: 'start', level: 'block', message: `Start date ${job.start_date} is before March 2027` })
  }

  return flags
}

export const blocks = (flags: FitFlag[]) => flags.some((f) => f.level === 'block')

/**
 * A company passes when at least one of its roles has no blocking flag. The
 * "primary" role is the first passing role, else the best-ranked role, and its
 * flags are what the company row shows.
 */
export function companyFit<J extends FitInput & { id: number; fit_tier: number | null }>(roles: J[], override = false) {
  const scored = roles
    .map((r) => ({ role: r, flags: fitFlags(r) }))
    .sort((a, b) => Number(blocks(a.flags)) - Number(blocks(b.flags)) || (a.role.fit_tier ?? 9) - (b.role.fit_tier ?? 9))
  const primary = scored[0] ?? null
  const passes = !!primary && !blocks(primary.flags)
  return { primary: primary?.role ?? null, flags: primary?.flags ?? [], passes, canDraft: passes || override, override }
}
