import { sizeBand, type SizeBand } from './size'
import type { PersonRow } from './types'

export interface CompanyJob {
  id: number
  company_key: string
  company: string
  title: string | null
  link: string
  fit_tier: number | null
  status: string
  company_website: string | null
  company_linkedin: string | null
  company_employees: number | null
  company_size: string | null
  funding_stage: string | null
  posted_at: string | null
}

export const COMPANY_JOB_COLUMNS =
  'id, company_key, company, title, link, fit_tier, status, company_website, company_linkedin, company_employees, company_size, funding_stage, posted_at'

export interface RunSummary {
  company_key: string
  cost_usd: number
  error: string | null
  finished_at: string | null
}

export interface CompanyView {
  key: string
  name: string
  website: string | null
  linkedin: string | null
  employees: number | null
  band: SizeBand
  funding: string | null
  bestTier: number | null
  latestPosted: string | null
  roles: { id: number; title: string | null; link: string; tier: number | null; status: string }[]
  people: PersonRow[]
  /** Last successful Exa search, if any. */
  searchedAt: string | null
  spend: number
}

/** Group job rows into companies and attach people and search history. */
export function buildCompanies(jobs: CompanyJob[], people: PersonRow[], runs: RunSummary[]): CompanyView[] {
  const byKey = new Map<string, CompanyView>()
  for (const j of jobs) {
    let c = byKey.get(j.company_key)
    if (!c) {
      c = {
        key: j.company_key,
        name: j.company,
        website: null,
        linkedin: null,
        employees: null,
        band: 'medium',
        funding: null,
        bestTier: null,
        latestPosted: null,
        roles: [],
        people: [],
        searchedAt: null,
        spend: 0,
      }
      byKey.set(j.company_key, c)
    }
    c.website ??= j.company_website
    c.linkedin ??= j.company_linkedin
    c.employees ??= j.company_employees
    c.funding ??= j.funding_stage
    if (j.fit_tier != null && (c.bestTier == null || j.fit_tier < c.bestTier)) c.bestTier = j.fit_tier
    if (j.posted_at && (!c.latestPosted || j.posted_at > c.latestPosted)) c.latestPosted = j.posted_at
    c.roles.push({ id: j.id, title: j.title, link: j.link, tier: j.fit_tier, status: j.status })
  }
  const sizeText = new Map<string, string | null>()
  for (const j of jobs) if (!sizeText.get(j.company_key)) sizeText.set(j.company_key, j.company_size)
  for (const c of byKey.values()) c.band = sizeBand(c.employees, sizeText.get(c.key))

  for (const p of people) byKey.get(p.company_key)?.people.push(p)
  for (const r of runs) {
    const c = byKey.get(r.company_key)
    if (!c) continue
    c.spend += Number(r.cost_usd) || 0
    if (!r.error && r.finished_at && (!c.searchedAt || r.finished_at > c.searchedAt)) c.searchedAt = r.finished_at
  }

  return [...byKey.values()].sort(
    (a, b) =>
      (a.bestTier ?? 9) - (b.bestTier ?? 9) ||
      (b.latestPosted ?? '').localeCompare(a.latestPosted ?? '') ||
      a.name.localeCompare(b.name)
  )
}
