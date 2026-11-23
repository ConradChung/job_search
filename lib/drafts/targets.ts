/**
 * Owner rules: per company, draft only the top alum (Blockchain @ UCLA first,
 * then UCLA alumni) and the top recruiter (2026-11-23). Everyone else is held
 * as a fallback: listed, not drafted.
 *
 * SDR companies (owner, 2026-11-24): the top sales leader or founder takes the
 * recruiter's place when one was found. A recruiter whose note is already
 * written keeps it (existing drafts are never orphaned). The alum is still drafted.
 */
export interface TargetCandidate {
  id: number
  company_key: string
  branch: string
  rank: number | null
  title?: string | null
  draft?: string | null
}

const SALES_LEADER = /\b(sales|revenue|cro|chief revenue|business development|gtm|go[- ]to[- ]market)\b/i
const CEO = /\b(ceo|chief executive)\b/i
const FOUNDER = /\bfounder\b/i

/** Sales leader first, then CEO, then any founder, then other GTM leads (growth, RevOps). */
export function leaderScore(p: Pick<TargetCandidate, 'branch' | 'title'>): number | null {
  if (p.branch !== 'gtm_leadership' && p.branch !== 'executive') return null
  const t = p.title ?? ''
  if (SALES_LEADER.test(t)) return 0
  if (CEO.test(t)) return 1
  if (FOUNDER.test(t)) return 2
  return p.branch === 'gtm_leadership' ? 3 : null
}

/** The sales leader or founder an SDR note goes to, if any. */
export function topLeader<T extends TargetCandidate>(list: T[]): T | undefined {
  return list
    .map((p) => ({ p, s: leaderScore(p) }))
    .filter((x): x is { p: T; s: number } => x.s != null)
    .sort((a, b) => a.s - b.s || (a.p.rank ?? 99) - (b.p.rank ?? 99))[0]?.p
}

export function draftTargetIds(people: TargetCandidate[], sdrCompanies: Set<string> = new Set()): Set<number> {
  const byCompany = new Map<string, TargetCandidate[]>()
  for (const p of people) byCompany.set(p.company_key, [...(byCompany.get(p.company_key) ?? []), p])
  const out = new Set<number>()
  const top = (list: TargetCandidate[]) => [...list].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0]
  for (const [key, list] of byCompany) {
    const club = list.filter((p) => p.branch === 'blockchain_ucla')
    const alum = top(club.length ? club : list.filter((p) => p.branch === 'alumni'))
    const recruiter = top(list.filter((p) => p.branch === 'recruiting'))
    const leader = sdrCompanies.has(key) ? topLeader(list) : undefined
    if (alum) out.add(alum.id)
    if (leader && !recruiter?.draft) out.add(leader.id)
    else if (recruiter) out.add(recruiter.id)
  }
  return out
}
