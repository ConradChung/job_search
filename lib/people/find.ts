import { matchCompany, parseProfile, type ExaResult, type Profile } from './parse'
import { sizeBand, type SizeBand } from './size'
import { ALUMNI_QUERY, PLANS, type Branch, type Step } from './targets'

export const CAP_PER_BRANCH = 3

export interface CompanyInput {
  company: string
  company_key: string
  domain: string | null
  employees: number | null
  size_text: string | null
}

export type Searcher = (query: string) => Promise<{ results: ExaResult[]; cost: number }>

export interface FoundPerson {
  company_key: string
  company: string
  full_name: string
  title: string
  headline: string | null
  location: string | null
  linkedin_url: string
  linkedin_key: string
  branch: Branch
  level: number | null
  size_band: SizeBand
  is_ucla: boolean
  rank: number
  source: 'exa'
  confidence: 'high' | 'medium'
  raw: { step: string }
}

export interface FindResult {
  band: SizeBand
  searches: number
  cost: number
  /** Profiles returned by Exa that are at the company now (before branch caps). */
  atCompany: number
  people: FoundPerson[]
}

interface Candidate {
  profile: Profile
  title: string
  confidence: 'high' | 'medium'
  order: number
  foundBy: string
}

export function domainOf(website: string | null | undefined): string | null {
  if (!website) return null
  try {
    return new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Alumni ranking: sales / GTM / recruiting roles before everyone else. */
const RELEVANT = /sales|account exec|\bae\b|gtm|go[- ]to[- ]market|growth|revenue|rev ?ops|business dev|partnership|recruit|talent|founder|ceo/i
const relevance = (title: string) => (RELEVANT.test(title) ? 1 : 0)

const target = (c: CompanyInput) => (c.domain ? `${c.company} (${c.domain})` : c.company)

/**
 * Run the size band's search plan for one company.
 *
 * Alumni plus every unconditional step run in parallel; conditional steps run
 * in order once earlier hits are known. Every profile returned (by any search)
 * that is at the company now is classified against every step, so a recruiter
 * surfaced by the alumni search still counts. One person lands in one branch:
 * UCLA alumni first, else the first step whose titles match. Capped at
 * CAP_PER_BRANCH per branch, best level and confidence first.
 */
export async function findPeople(c: CompanyInput, search: Searcher): Promise<FindResult> {
  const band = sizeBand(c.employees, c.size_text)
  const plan = PLANS[band]
  const candidates = new Map<string, Candidate>()
  let searches = 0
  let cost = 0
  let order = 0

  const run = async (id: string, query: string) => {
    const q = `${query} at ${target(c)}`
    const { results, cost: spent } = await search(q)
    searches++
    cost += spent
    return { id, q, results }
  }

  const absorb = (batch: { id: string; results: ExaResult[] }) => {
    for (const r of batch.results) {
      const p = parseProfile(r)
      if (!p || candidates.has(p.linkedin_key)) continue
      const m = matchCompany(p, c.company, c.domain)
      if (!m) continue
      candidates.set(p.linkedin_key, { profile: p, title: m.title, confidence: m.confidence, order: order++, foundBy: batch.id })
    }
  }

  const stepOf = (cand: Candidate): Step | null => plan.find((s) => s.titles.test(cand.title)) ?? null
  const hits = () => {
    const h: Record<string, number> = {}
    for (const cand of candidates.values()) {
      const s = stepOf(cand)
      if (s) h[s.id] = (h[s.id] ?? 0) + 1
    }
    return h
  }

  const first = await Promise.all([run('alumni', ALUMNI_QUERY), ...plan.filter((s) => !s.when).map((s) => run(s.id, s.query))])
  first.forEach(absorb)

  const ran = new Set(plan.filter((s) => !s.when).map((s) => s.id))
  for (const s of plan) {
    if (ran.has(s.id) || !s.when) continue
    if (!s.when(hits())) continue
    absorb(await run(s.id, s.query))
    ran.add(s.id)
  }

  // A conditional step that was skipped must not contribute people either
  // (e.g. a founder surfaced by another search when the GTM head exists).
  const allowed = (s: Step) => ran.has(s.id)

  const byBranch = new Map<Branch, { cand: Candidate; level: number | null; step: string }[]>()
  for (const cand of candidates.values()) {
    const s = stepOf(cand)
    let branch: Branch | null = null
    let level: number | null = null
    let stepId = cand.foundBy
    if (cand.profile.is_ucla) {
      branch = 'alumni'
      level = s && allowed(s) ? s.level : null
    } else if (s && allowed(s)) {
      branch = s.branch
      level = s.level
      stepId = s.id
    }
    if (!branch) continue
    const list = byBranch.get(branch) ?? []
    list.push({ cand, level, step: stepId })
    byBranch.set(branch, list)
  }

  const people: FoundPerson[] = []
  for (const [branch, list] of byBranch) {
    list
      .sort(
        (a, b) =>
          (a.level ?? 99) - (b.level ?? 99) ||
          relevance(b.cand.title) - relevance(a.cand.title) ||
          (a.cand.confidence === b.cand.confidence ? 0 : a.cand.confidence === 'high' ? -1 : 1) ||
          a.cand.order - b.cand.order
      )
      .slice(0, CAP_PER_BRANCH)
      .forEach(({ cand, level, step }, i) => {
        const p = cand.profile
        people.push({
          company_key: c.company_key,
          company: c.company,
          full_name: p.full_name,
          title: cand.title,
          headline: p.headline,
          location: p.location,
          linkedin_url: p.linkedin_url,
          linkedin_key: p.linkedin_key,
          branch,
          level,
          size_band: band,
          is_ucla: p.is_ucla,
          rank: i + 1,
          source: 'exa',
          confidence: cand.confidence,
          raw: { step },
        })
      })
  }

  return { band, searches, cost, atCompany: candidates.size, people }
}
