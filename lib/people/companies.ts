import { sizeBand, type SizeBand } from './size'
import type { PersonRow } from './types'
import { ruleFor } from './targets'
import { trackOf, type Track } from '@/lib/jobs/categories'
import { companyFit, TRACK_RANK, type FitFlag, type FitTrack } from '@/lib/jobs/fit'

export interface CompanyJob {
  id: number
  company_key: string
  company: string
  title: string | null
  link: string
  industries?: string | null
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
  closing_required: boolean | null
  section: 'main' | 'referrals'
  salary_text: string | null
  salary_min: number | null
  salary_max: number | null
  location: string | null
  board: string | null
  notes: string | null
  /** Classification spend for this role (classification->>cost). */
  classify_cost: string | null
  /** The classifier's one-line reason for the category. */
  classify_reason?: string | null
}

export const COMPANY_JOB_COLUMNS =
  'id, company_key, company, title, link, fit_tier, status, company_website, company_linkedin, company_employees, company_size, funding_stage, posted_at, liveness, category, category_confidence, department, seniority, work_mode, work_locations, start_requirement, start_date, company_city:raw->>companyCity, industries:raw->>industries, closing_required, section, salary_text, salary_min, salary_max, location, board, notes, classify_cost:classification->>cost, classify_reason:classification->>reason'

export interface RunSummary {
  company_key: string
  cost_usd: number
  error: string | null
  finished_at: string | null
  rule: string | null
}

/** Researched hook and fit line for the after-accept messages (lib/research). */
export interface CompanyResearchView {
  hook_source_url: string | null
  hook_title: string | null
  hook_date: string | null
  hook_summary: string | null
  hook_sentence: string | null
  hook_short: string | null
  fit_items: string[]
  hook_reviewed_at: string | null
  why_no_hook: string | null
  researched_at: string
}

export interface CompanyView {
  key: string
  /** Set by loadCompanies when the company has been researched. */
  research?: CompanyResearchView | null
  name: string
  website: string | null
  linkedin: string | null
  employees: number | null
  band: SizeBand
  funding: string | null
  bestTier: number | null
  latestPosted: string | null
  /** All roles, best fit first, each with its own flags. */
  roles: CompanyJob[]
  roleFlags: Record<number, FitFlag[]>
  people: PersonRow[]
  /** The role the fit flags, routing and drafts are based on. */
  primary: CompanyJob | null
  /** Routing track (people-search chain). */
  track: Track
  /** Owner track of the primary role: gtm_eng, sdr, revops or blocked. */
  fitTrack: FitTrack
  /** Tracks of every role (for the track filter). */
  fitTracks: FitTrack[]
  draftPaused: boolean
  /** Main sheet section vs referrals (a company can have both). */
  sections: ('main' | 'referrals')[]
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
  /** Exa people-search spend. */
  spend: number
  /** Classification + draft spend (Claude). */
  claudeSpend: number
}

/** Group job rows into companies and attach people, fit and search history. */
export function buildCompanies(jobs: CompanyJob[], people: PersonRow[], runs: RunSummary[], overrides: Set<string> = new Set(), holds: Map<string, string> = new Map()): CompanyView[] {
  const groups = new Map<string, CompanyJob[]>()
  for (const j of jobs) groups.set(j.company_key, [...(groups.get(j.company_key) ?? []), j])

  const out = new Map<string, CompanyView>()
  for (const [key, roles] of groups) {
    const first = <K extends keyof CompanyJob>(k: K) => roles.find((r) => r[k] != null)?.[k] ?? null
    const fit = companyFit(roles, overrides.has(key), undefined, holds.get(key) ?? null)
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
      roles: fit.ranked.map((r) => r.role),
      roleFlags: Object.fromEntries(fit.ranked.map((r) => [r.role.id, r.flags])),
      people: [],
      primary: fit.primary,
      track,
      fitTrack: fit.track,
      fitTracks: [...new Set(fit.ranked.map((r) => r.track))],
      draftPaused: fit.draftPaused,
      sections: [...new Set(roles.map((r) => r.section))],
      flags: fit.flags,
      passes: fit.passes,
      canDraft: fit.canDraft,
      override: fit.override,
      home: fit.home,
      rule: ruleFor(track, band, fit.track === 'sdr'),
      ruleApplied: false,
      searchedAt: null,
      spend: 0,
      claudeSpend: roles.reduce((n, r) => n + (Number(r.classify_cost) || 0), 0),
    })
  }

  for (const p of people) {
    const c = out.get(p.company_key)
    if (!c) continue
    c.people.push(p)
    c.claudeSpend += Number(p.draft_cost_usd) || 0
  }
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
      // Owner order: Blockchain @ UCLA alumni first, then track (GTM Eng, SDR, RevOps, then blocked), then NYC roles, then newest postings.
      Number(b.people.some((p) => p.branch === 'blockchain_ucla')) - Number(a.people.some((p) => p.branch === 'blockchain_ucla')) ||
      TRACK_RANK[a.passes ? a.fitTrack : 'blocked'] - TRACK_RANK[b.passes ? b.fitTrack : 'blocked'] ||
      Number(b.home) - Number(a.home) ||
      (b.latestPosted ?? '').localeCompare(a.latestPosted ?? '') ||
      a.name.localeCompare(b.name)
  )
}
