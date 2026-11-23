import type { SupabaseClient } from '@supabase/supabase-js'
import type { CompanyView } from '@/lib/people/companies'
import { applyFilters, CLEARED, type Filters } from '@/lib/pipeline/filters'
import { peopleInOrder } from '@/lib/pipeline/load'
import { draftTargetIds } from '@/lib/drafts/targets'
import { EST_COST_PER_SEARCH, maxSearches } from '@/lib/people/targets'
import { runExport } from '@/lib/export/run'
import { DEFAULT_BATCH } from '@/lib/export/columns'
import type { FitTrack } from '@/lib/jobs/fit'

/** Same per-note estimate the page shows (note + after-accept message, with retries). */
export const DRAFT_COST = 0.02
const TIER_TRACK: Record<number, FitTrack> = { 1: 'gtm_eng', 2: 'sdr', 3: 'revops' }

export interface Scope {
  company_keys?: string[]
  tier?: 1 | 2 | 3
  limit?: number
}

/** The companies a request covers: named ones, or passing companies in a tier, in page order. */
export function scopeCompanies(companies: CompanyView[], s: Scope): CompanyView[] {
  if (s.company_keys?.length) {
    const want = new Set(s.company_keys.map((k) => k.toLowerCase()))
    return companies.filter((c) => want.has(c.key.toLowerCase()))
  }
  const f: Filters = { ...CLEARED, fit: 'passes', tiers: s.tier ? new Set([TIER_TRACK[s.tier]]) : new Set() }
  return applyFilters(companies, f)
}

/** People search: companies in scope not yet searched, at most `limit`; worst-case Exa cost. */
export function previewFindPeople(companies: CompanyView[], s: Scope) {
  const list = scopeCompanies(companies, s)
    .filter((c) => !c.searchedAt)
    .slice(0, s.limit ?? 25)
  const searches = list.reduce((n, c) => n + maxSearches(c.band, c.track, c.fitTrack === 'sdr'), 0)
  return {
    company_keys: list.map((c) => c.key),
    companies: list.map((c) => c.name),
    searches,
    est_cost_usd: Math.round(searches * EST_COST_PER_SEARCH * 100) / 100,
  }
}

/** Drafting: target people without a note at companies that can draft, at most `limit`. */
export function previewDraftNotes(companies: CompanyView[], s: Scope) {
  const scoped = scopeCompanies(companies, s).filter((c) => c.canDraft)
  const targets = draftTargetIds(
    companies.flatMap((c) => c.people),
    new Set(companies.filter((c) => c.fitTrack === 'sdr').map((c) => c.key))
  )
  const people = peopleInOrder(scoped)
    .filter((p) => targets.has(p.id) && !p.draft && p.outreach_status !== 'skip')
    .slice(0, s.limit ?? 25)
  const byKey = new Map(companies.map((c) => [c.key, c.name]))
  return {
    person_ids: people.map((p) => p.id),
    people: people.map((p) => ({ id: p.id, company: byKey.get(p.company_key) ?? p.company_key })),
    est_cost_usd: Math.round(people.length * DRAFT_COST * 100) / 100,
  }
}

/** Export: exactly what the next file would hold (page order, Approved only), without marking anything. */
export async function previewExport(db: SupabaseClient, companies: CompanyView[], o: { tiers: number[]; limit?: number | null; include_exported?: boolean }) {
  const visible = applyFilters(companies, { ...CLEARED, fit: 'passes' })
  const ids = peopleInOrder(visible)
    .filter((p) => p.outreach_status === 'approved' || p.outreach_status === 'exported')
    .map((p) => p.id)
  const r = await runExport(db, { ids, tiers: o.tiers, includeExported: !!o.include_exported, limit: o.limit === undefined ? DEFAULT_BATCH : o.limit, write: false })
  return { ...r, person_ids: r.people.map((p) => p.id) }
}
