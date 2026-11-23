import { PROFILE } from '@/lib/profile'
import { CATEGORIES, isCategory, SDR_TITLE } from './categories'

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
  /** SDR roles: the posting asks for 2+ years of closing experience. */
  closing_required?: boolean | null
}

export interface FitFlag {
  code: 'category' | 'seniority' | 'location' | 'start' | 'unclassified' | 'dead'
  /** block: drafting is skipped until the owner overrides. warn: shown, still drafts. info: shown only. */
  level: 'block' | 'warn' | 'info'
  message: string
}

type Level = 'pass' | 'warn' | 'block'
type Constraints = {
  categoryLevels: Record<string, Level>
  tracks: Record<string, { label: string; primary: boolean; draft: boolean }>
  seniorityBlock: readonly string[]
  seniorityWarn: readonly string[]
  /** Regex source matching the home city (e.g. NYC and its boroughs). */
  homePattern: string
  homeLabel: string
  earliestStart: string
}

const US = /\b(united states|usa|u\.s\.?a?\.?|us|remote|anywhere)\b/i
/** A place in the US: country name, a ", ST" state code, or a major US city. */
const US_PLACE =
  /\b(united states|usa|u\.s\.)|,\s*(A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b|\b(new york|nyc|brooklyn|san francisco|bay area|oakland|palo alto|mountain view|san jose|los angeles|seattle|austin|boston|chicago|denver|miami|atlanta|dallas|houston|philadelphia|washington|san diego|salt lake|phoenix|portland|minneapolis|nashville|raleigh|pittsburgh|detroit)\b/i

/** SDR / BDR role (its own category since the Sales split; old `sales` rows fall back to the title). */
export function isSdr(job: Pick<FitInput, 'category' | 'title'>): boolean {
  return job.category === 'sdr' || (job.category === 'sales' && SDR_TITLE.test(job.title ?? ''))
}

/** Owner tracks: GTM Eng, Sales – SDR/BDR, RevOps. Every other category is "blocked". */
export type FitTrack = 'gtm_eng' | 'sdr' | 'revops' | 'blocked'
export const FIT_TRACKS = ['gtm_eng', 'sdr', 'revops'] as const

export function fitTrack(category: string | null | undefined, c: Pick<Constraints, 'tracks'> = PROFILE.constraints): FitTrack {
  return category && category in c.tracks ? (category as FitTrack) : 'blocked'
}

const GTM_ENGINEER_TITLE = /\b(gtm|go[- ]to[- ]market)\s+engineer/i
const MANAGER_TITLE = /\b(manager|head|director|lead|vp|vice president|supervisor)\b/i

/** Fit level of a role's category, with the owner's exceptions. */
export function categoryLevel(job: Pick<FitInput, 'category' | 'category_confidence' | 'title'>, c: Pick<Constraints, 'categoryLevels'> = PROFILE.constraints): { level: 'warn' | 'block'; message: string } | null {
  const cat = job.category ?? ''
  const label = isCategory(cat) ? CATEGORIES[cat].label : cat
  // A "GTM Engineer" title the classifier called RevOps with low confidence warns, never blocks.
  if (cat === 'revops' && job.category_confidence === 'low' && GTM_ENGINEER_TITLE.test(job.title ?? '')) {
    return { level: 'warn', message: 'Titled GTM Engineer, classified RevOps (low confidence)' }
  }
  const level = c.categoryLevels[cat] ?? 'block'
  if (level === 'pass') return null
  if (level === 'warn') return { level, message: `${label} track` }
  return { level: 'block', message: `Category is ${label}, not GTM Eng or SDR` }
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
  const cat = categoryLevel(job, c)
  if (cat) flags.push({ code: 'category', ...cat })

  if (job.seniority && c.seniorityBlock.includes(job.seniority)) {
    flags.push({ code: 'seniority', level: 'block', message: `Seniority: ${job.seniority === 'director_plus' ? 'director or above' : job.seniority}` })
  } else if (job.category === 'sdr' && MANAGER_TITLE.test(job.title ?? '')) {
    flags.push({ code: 'seniority', level: 'block', message: 'SDR manager role' })
  } else if (job.category === 'sdr' && job.closing_required) {
    flags.push({ code: 'seniority', level: 'block', message: 'Asks for 2+ years of closing experience' })
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
  } else if (!locs.some((l) => US_PLACE.test(l))) {
    // Owner rule (2026-11-23): roles based outside the US block.
    flags.push({ code: 'location', level: 'block', message: `Based outside the US: ${locs.join(' / ')}` })
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

const TRACK_RANK: Record<FitTrack, number> = { gtm_eng: 0, sdr: 1, revops: 2, blocked: 3 }

/**
 * A company passes when at least one of its roles has no blocking flag. The
 * primary role is the best passing one: GTM Eng (primary track) first, then
 * SDR, then RevOps; NYC roles first within a track; then the sheet's tier.
 * Its flags and track are what the company row shows. Drafting also needs the
 * primary role's track to allow drafting (SDR is paused).
 */
export function companyFit<J extends FitInput & { id: number; fit_tier: number | null }>(roles: J[], override = false, c: Constraints = PROFILE.constraints) {
  const scored = roles
    .map((r) => ({ role: r, flags: fitFlags(r, c), home: isHomeRole(r, c), track: fitTrack(r.category, c) }))
    .sort(
      (a, b) =>
        Number(blocks(a.flags)) - Number(blocks(b.flags)) ||
        TRACK_RANK[a.track] - TRACK_RANK[b.track] ||
        Number(b.home) - Number(a.home) ||
        (a.role.fit_tier ?? 9) - (b.role.fit_tier ?? 9)
    )
  const primary = scored[0] ?? null
  const passes = !!primary && !blocks(primary.flags)
  const track: FitTrack = primary?.track ?? 'blocked'
  const draftPaused = track !== 'blocked' && c.tracks[track]?.draft === false
  return {
    primary: primary?.role ?? null,
    flags: primary?.flags ?? [],
    passes,
    track,
    draftPaused,
    canDraft: (passes || override) && !draftPaused,
    override,
    home: primary?.home ?? false,
    /** Every role with its own flags, best first. */
    ranked: scored,
  }
}
