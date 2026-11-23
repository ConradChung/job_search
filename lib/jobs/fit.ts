import { PROFILE } from '@/lib/profile'
import { CATEGORIES, isCategory } from './categories'

/** The fields fit flags read from a classified job. */
export interface FitInput {
  title?: string | null
  category: string | null
  category_confidence: string | null
  seniority: string | null
  work_mode: string | null
  work_locations: string[] | null
  start_requirement: string | null
  start_date: string | null
  liveness?: string | null
  /** Company HQ city from the sheet (raw.companyCity). */
  company_city?: string | null
}

export interface FitFlag {
  code: 'category' | 'seniority' | 'location' | 'start' | 'unclassified' | 'dead'
  /** block: drafting is skipped until the owner overrides. warn: shown, still drafts. info: shown only. */
  level: 'block' | 'warn' | 'info'
  message: string
}

type Constraints = {
  categories: readonly string[]
  allowSdr: boolean
  seniorityBlock: readonly string[]
  seniorityWarn: readonly string[]
  /** Regex source matching the home city (e.g. NYC and its boroughs). */
  homePattern: string
  homeLabel: string
  earliestStart: string
}

const SDR = /\b(sdr|bdr|sales development|business development rep(resentative)?|market development rep(resentative)?)\b/i
const US = /\b(united states|usa|u\.s\.?a?\.?|us|remote|anywhere)\b/i

/** Sales roles that are SDR / BDR (allowed) rather than AE (blocked). */
export function isSdr(job: Pick<FitInput, 'category' | 'title'>): boolean {
  return job.category === 'sales' && SDR.test(job.title ?? '')
}

/** Role based in the home city, or company headquartered there. */
export function isHomeRole(job: Pick<FitInput, 'work_locations' | 'company_city'>, c: Pick<Constraints, 'homePattern'> = PROFILE.constraints): boolean {
  const home = new RegExp(c.homePattern, 'i')
  return (job.work_locations ?? []).some((l) => home.test(l)) || home.test(job.company_city ?? '')
}

/** Constraint checks for one job (lib/profile.ts → constraints). */
export function fitFlags(job: FitInput, c: Constraints = PROFILE.constraints): FitFlag[] {
  const flags: FitFlag[] = []
  if (job.liveness === 'dead') flags.push({ code: 'dead', level: 'block', message: 'Posting is closed' })

  if (!job.category) {
    flags.push({ code: 'unclassified', level: 'block', message: 'Not classified yet' })
    return flags
  }
  const sdrOk = c.allowSdr && isSdr(job)
  if (!c.categories.includes(job.category) && !sdrOk) {
    const label = job.category === 'sales' ? 'Sales (AE)' : isCategory(job.category) ? CATEGORIES[job.category].label : job.category
    flags.push({ code: 'category', level: 'block', message: `Category is ${label}, not GTM Eng or SDR` })
  }

  if (job.seniority && c.seniorityBlock.includes(job.seniority)) {
    flags.push({ code: 'seniority', level: 'block', message: `Seniority: ${job.seniority === 'director_plus' ? 'director or above' : job.seniority}` })
  } else if (job.seniority && c.seniorityWarn.includes(job.seniority)) {
    flags.push({ code: 'seniority', level: 'warn', message: 'Mid-level role' })
  }

  // Location: pass in the home city / HQ there / remote within the US; warn for
  // another city; unknown (country only, nothing clearer in the posting) passes.
  const locs = (job.work_locations ?? []).map((l) => l.trim()).filter(Boolean)
  const countryOnly = locs.length === 0 || locs.every((l) => US.test(l) && !/,/.test(l))
  if (isHomeRole(job, c)) {
    // passes
  } else if (job.work_mode === 'remote' && (locs.length === 0 || locs.some((l) => US.test(l)))) {
    // remote within the US passes
  } else if (countryOnly) {
    flags.push({ code: 'location', level: 'info', message: 'Location unknown' })
  } else {
    flags.push({ code: 'location', level: 'warn', message: `Not ${c.homeLabel}: ${job.work_mode && job.work_mode !== 'unknown' ? `${job.work_mode} in ` : ''}${locs.join(' / ')}` })
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
 * primary role is the first passing role (home-city roles first), else the
 * best-ranked role; its flags are what the company row shows.
 */
export function companyFit<J extends FitInput & { id: number; fit_tier: number | null }>(roles: J[], override = false) {
  const scored = roles
    .map((r) => ({ role: r, flags: fitFlags(r), home: isHomeRole(r) }))
    .sort(
      (a, b) =>
        Number(blocks(a.flags)) - Number(blocks(b.flags)) ||
        Number(b.home) - Number(a.home) ||
        (a.role.fit_tier ?? 9) - (b.role.fit_tier ?? 9)
    )
  const primary = scored[0] ?? null
  const passes = !!primary && !blocks(primary.flags)
  return { primary: primary?.role ?? null, flags: primary?.flags ?? [], passes, canDraft: passes || override, override, home: primary?.home ?? false }
}
