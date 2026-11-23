import { matchCompany, parseProfile, type ExaResult, type Profile } from './parse'
import { sizeBand, type SizeBand } from './size'
import { ALUMNI_QUERY, BLOCKCHAIN_QUERY, functionScore, planFor, ruleFor, TITLES, type Branch, type Step } from './targets'
import type { Track } from '@/lib/jobs/categories'

export const CAP_PER_BRANCH = 3

export interface CompanyInput {
  company: string
  company_key: string
  domain: string | null
  employees: number | null
  size_text: string | null
  /** Routing track of the company's primary role (sales/GTM vs engineering/product). */
  track: Track
  /** Seniority of that role: leadership recruiters are only kept for director-level roles. */
  roleSeniority: string | null
  /** Primary role is SDR / BDR: small companies go to the sales leader or founder first. */
  sdr?: boolean
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
  in_blockchain_ucla: boolean
  rank: number
  source: 'exa'
  confidence: 'high' | 'medium'
  profile_text: string
  raw: { step: string }
}

export interface FindResult {
  band: SizeBand
  track: Track
  rule: string
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

const target = (c: CompanyInput) => (c.domain ? `${c.company} (${c.domain})` : c.company)

/**
 * Run the routing plan for one company: Blockchain @ UCLA, UCLA alumni, then
 * the track's steps (sales/GTM by size band, or the engineering chain).
 *
 * Unconditional searches run in parallel; conditional steps run in order once
 * earlier hits are known. Every profile returned that is at the company now is
 * classified against every step. One person lands in one branch: Blockchain
 * @ UCLA first, then UCLA alumni, then the first matching step that ran.
 * Leadership / executive / fractional recruiters are dropped unless the role
 * is director-level or above. Capped at CAP_PER_BRANCH per branch.
 */
export async function findPeople(c: CompanyInput, search: Searcher): Promise<FindResult> {
  const band = sizeBand(c.employees, c.size_text)
  const plan = planFor(c.track, band, c.sdr)
  const directorRole = c.roleSeniority === 'director_plus'
  const candidates = new Map<string, Candidate>()
  let searches = 0
  let cost = 0
  let order = 0

  const run = async (id: string, query: string) => {
    const { results, cost: spent } = await search(`${query} at ${target(c)}`)
    searches++
    cost += spent
    return { id, results }
  }

  const absorb = (batch: { id: string; results: ExaResult[] }) => {
    for (const r of batch.results) {
      const p = parseProfile(r)
      if (!p || candidates.has(p.linkedin_key)) continue
      const m = matchCompany(p, c.company, c.domain)
      if (!m) continue
      if (!directorRole && TITLES.leadershipRecruiter.test(m.title)) continue
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

  const first = await Promise.all([
    run('blockchain_ucla', BLOCKCHAIN_QUERY),
    run('alumni', ALUMNI_QUERY),
    ...plan.filter((s) => !s.when).map((s) => run(s.id, s.query)),
  ])
  first.forEach(absorb)

  const ran = new Set(plan.filter((s) => !s.when).map((s) => s.id))
  for (const s of plan) {
    if (ran.has(s.id) || !s.when) continue
    if (!s.when(hits())) continue
    absorb(await run(s.id, s.query))
    ran.add(s.id)
  }

  // A conditional step that was skipped must not contribute people either.
  const allowed = (s: Step) => ran.has(s.id)

  const byBranch = new Map<Branch, { cand: Candidate; level: number | null; step: string; fn: number }[]>()
  for (const cand of candidates.values()) {
    const s = stepOf(cand)
    const stepOk = s && allowed(s)
    let branch: Branch | null = null
    if (cand.profile.in_blockchain_ucla) branch = 'blockchain_ucla'
    else if (cand.profile.is_ucla) branch = 'alumni'
    else if (stepOk) branch = s.branch
    if (!branch) continue
    const list = byBranch.get(branch) ?? []
    list.push({ cand, level: stepOk ? s.level : null, step: stepOk ? s.id : cand.foundBy, fn: functionScore(cand.title, c.track) })
    byBranch.set(branch, list)
  }

  const people: FoundPerson[] = []
  for (const [branch, list] of byBranch) {
    const alumniLike = branch === 'alumni' || branch === 'blockchain_ucla'
    list
      .sort(
        (a, b) =>
          // Alumni groups: closeness to the role's function first.
          (alumniLike ? b.fn - a.fn : 0) ||
          (a.level ?? 99) - (b.level ?? 99) ||
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
          in_blockchain_ucla: p.in_blockchain_ucla,
          rank: i + 1,
          source: 'exa',
          confidence: cand.confidence,
          profile_text: p.text,
          raw: { step },
        })
      })
  }

  return { band, track: c.track, rule: ruleFor(c.track, band, c.sdr), searches, cost, atCompany: candidates.size, people }
}
