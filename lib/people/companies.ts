import { sizeBand, type SizeBand } from './size'
import type { PersonRow } from './types'
import { ruleFor } from './targets'
import { trackOf, type Track } from '@/lib/jobs/categories'
import { companyFit, type FitFlag } from '@/lib/jobs/fit'

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
  liveness: string | null
  category: string | null
  category_confidence: string | null
  department: string | null
  seniority: string | null
  work_mode: string | null
  work_locations: string[] | null
  start_requirement: string | null
  start_date: string | null
  company_city: string | null
}

export const COMPANY_JOB_COLUMNS =
  'id, company_key, company, title, link, fit_tier, status, company_website, company_linkedin, company_employees, company_size, funding_stage, posted_at, liveness, category, category_confidence, department, seniority, work_mode, work_locations, start_requirement, start_date, company_city:raw->>companyCity'

export interface RunSummary {
  company_key: string
  cost_usd: number
  error: string | null
  finished_at: string | null
  rule: string | null
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
  roles: CompanyJob[]
  people: PersonRow[]
  /** The role the fit flags, routing and drafts are based on. */
  primary: CompanyJob | null
  track: Track
  flags: FitFlag[]
  passes: boolean
  canDraft: boolean
  override: boolean
  /** Primary role is in NYC (or HQ there): sorted to the top within its track. */
  home: boolean
  /** Routing rule: the one the last search applied, else the one it would apply. */
  rule: string
  ruleApplied: boolean
  /** Last successful Exa search, if any. */
  searchedAt: string | null
  spend: number
}

/** Group job rows into companies and attach people, fit and search history. */
export function buildCompanies(jobs: CompanyJob[], people: PersonRow[], runs: RunSummary[], overrides: Set<string> = new Set()): CompanyView[] {
  const groups = new Map<string, CompanyJob[]>()
  for (const j of jobs) groups.set(j.company_key, [...(groups.get(j.company_key) ?? []), j])

  const out = new Map<string, CompanyView>()
  for (const [key, roles] of groups) {
    const first = <K extends keyof CompanyJob>(k: K) => roles.find((r) => r[k] != null)?.[k] ?? null
    const fit = companyFit(roles, overrides.has(key))
    const band = sizeBand(first('company_employees') as number | null, first('company_size') as string | null)
    const track = trackOf(fit.primary?.category)
    const tiers = roles.map((r) => r.fit_tier).filter((t): t is number => t != null)
    out.set(key, {
      key,
      name: roles[0].company,
      website: first('company_website') as string | null,
      linkedin: first('company_linkedin') as string | null,
      employees: first('company_employees') as number | null,
      band,
      funding: first('funding_stage') as string | null,
      bestTier: tiers.length ? Math.min(...tiers) : null,
      latestPosted: roles.map((r) => r.posted_at ?? '').sort().pop() || null,
      roles,
      people: [],
      primary: fit.primary,
      track,
      flags: fit.flags,
      passes: fit.passes,
      canDraft: fit.canDraft,
      override: fit.override,
      home: fit.home,
      rule: ruleFor(track, band),
      ruleApplied: false,
      searchedAt: null,
      spend: 0,
    })
  }

  for (const p of people) out.get(p.company_key)?.people.push(p)
  for (const r of runs) {
    const c = out.get(r.company_key)
    if (!c) continue
    c.spend += Number(r.cost_usd) || 0
    if (!r.error && r.finished_at && (!c.searchedAt || r.finished_at > c.searchedAt)) {
      c.searchedAt = r.finished_at
      if (r.rule) {
        c.rule = r.rule
        c.ruleApplied = true
      }
    }
  }

  return [...out.values()].sort(
    (a, b) =>
      // Owner order: Blockchain @ UCLA alumni first, then NYC roles, then newest postings.
      Number(b.passes) - Number(a.passes) ||
      Number(b.people.some((p) => p.branch === 'blockchain_ucla')) - Number(a.people.some((p) => p.branch === 'blockchain_ucla')) ||
      Number(b.home) - Number(a.home) ||
      (b.latestPosted ?? '').localeCompare(a.latestPosted ?? '') ||
      a.name.localeCompare(b.name)
  )
}
