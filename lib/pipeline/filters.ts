import type { CompanyJob, CompanyView } from '@/lib/people/companies'
import type { FitTrack } from '@/lib/jobs/fit'
import type { SizeBand } from '@/lib/people/size'

/**
 * Pipeline page filters, in one place so the table, every chip count and the
 * tests agree (owner, 2026-11-23): a chip's number is how many rows would show
 * if it were clicked, given every other active filter.
 */
export interface Filters {
  /** Empty = all tiers (and blocked). */
  tiers: ReadonlySet<FitTrack>
  fit: 'passes' | 'flagged' | 'all'
  people: 'all' | 'none' | 'has'
  section: 'all' | 'main' | 'referrals'
  status: string
  band: SizeBand | 'all'
  query: string
}
export type Group = keyof Filters

/** The tier a company row sits in: its best role's track when it passes (or is overridden), else blocked. */
export const rowTrack = (c: Pick<CompanyView, 'passes' | 'override' | 'fitTrack'>): FitTrack => (c.passes || c.override ? c.fitTrack : 'blocked')

const STATUS_RANK: Record<string, number> = { offer: 6, interviewing: 5, applied: 4, reached_out: 3, new: 2, rejected: 1, not_fit: 0 }
/** A company's status: the furthest-along status across its roles (one per company, so status chips add up). */
export const rollupStatus = (roles: Pick<CompanyJob, 'status'>[]) =>
  roles.reduce((best, r) => ((STATUS_RANK[r.status] ?? 0) > (STATUS_RANK[best] ?? 0) ? r.status : best), roles[0]?.status ?? 'new')

const TESTS: { [G in Group]: (c: CompanyView, v: Filters[G]) => boolean } = {
  tiers: (c, v) => v.size === 0 || v.has(rowTrack(c)),
  fit: (c, v) => v === 'all' || (v === 'passes' ? c.passes || c.override : !(c.passes || c.override)),
  people: (c, v) => v === 'all' || (v === 'none' ? c.people.length === 0 : c.people.length > 0),
  section: (c, v) => v === 'all' || c.sections.includes(v),
  status: (c, v) => v === 'all' || rollupStatus(c.roles) === v,
  band: (c, v) => v === 'all' || c.band === v,
  query: (c, v) => {
    const q = v.trim().toLowerCase()
    return (
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.roles.some((r) => (r.title ?? '').toLowerCase().includes(q) || (r.location ?? '').toLowerCase().includes(q)) ||
      c.people.some((p) => p.full_name.toLowerCase().includes(q))
    )
  },
}
const GROUPS = Object.keys(TESTS) as Group[]

export function matches(c: CompanyView, f: Filters): boolean {
  return GROUPS.every((g) => (TESTS[g] as (c: CompanyView, v: unknown) => boolean)(c, f[g]))
}

export function applyFilters(companies: CompanyView[], f: Filters): CompanyView[] {
  return companies.filter((c) => matches(c, f))
}

/** Rows that would show if this group were set to `value`: the group's own selection is replaced, every other group still applies. */
export function countFor<G extends Group>(companies: CompanyView[], f: Filters, group: G, value: Filters[G]): number {
  const g = { ...f, [group]: value } as Filters
  return companies.filter((c) => matches(c, g)).length
}

/** Each group's "no filter" value. */
export const CLEARED: Filters = { tiers: new Set(), fit: 'all', people: 'all', section: 'all', status: 'all', band: 'all', query: '' }

export function isActive(f: Filters, g: Group): boolean {
  return g === 'tiers' ? f.tiers.size > 0 : f[g] !== CLEARED[g]
}

/**
 * Empty table: the active filters that, cleared on their own, bring rows back
 * (with how many). Empty list = only clearing several at once helps.
 */
export function culprits(companies: CompanyView[], f: Filters): { group: Group; rows: number }[] {
  return GROUPS.filter((g) => isActive(f, g))
    .map((g) => ({ group: g, rows: countFor(companies, f, g, CLEARED[g]) }))
    .filter((x) => x.rows > 0)
    .sort((a, b) => b.rows - a.rows)
}

/**
 * Picking tiers: Blocked never overlaps "Passes", so choosing it switches the
 * fit filter to All; any tier choice that would leave the table empty does too.
 */
export function fitAfterTierChange(companies: CompanyView[], f: Filters, tiers: ReadonlySet<FitTrack>): Filters['fit'] {
  if (f.fit === 'all') return 'all'
  if (tiers.has('blocked')) return 'all'
  return countFor(companies, f, 'tiers', tiers) === 0 ? 'all' : f.fit
}

/** Tier chip count: rows after clicking it, including the automatic switch of the fit filter. */
export function countTiers(companies: CompanyView[], f: Filters, tiers: ReadonlySet<FitTrack>): number {
  return applyFilters(companies, { ...f, tiers, fit: fitAfterTierChange(companies, f, tiers) }).length
}
