/**
 * Owner rule (2026-11-23): per company, draft only the top alum (Blockchain @
 * UCLA first, then UCLA alumni) and the top recruiter. Everyone else is held as
 * a fallback: listed, not drafted.
 */
export interface TargetCandidate {
  id: number
  company_key: string
  branch: string
  rank: number | null
}

export function draftTargetIds(people: TargetCandidate[]): Set<number> {
  const byCompany = new Map<string, TargetCandidate[]>()
  for (const p of people) byCompany.set(p.company_key, [...(byCompany.get(p.company_key) ?? []), p])
  const out = new Set<number>()
  const top = (list: TargetCandidate[]) => [...list].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0]
  for (const list of byCompany.values()) {
    const club = list.filter((p) => p.branch === 'blockchain_ucla')
    const alum = top(club.length ? club : list.filter((p) => p.branch === 'alumni'))
    const recruiter = top(list.filter((p) => p.branch === 'recruiting'))
    if (alum) out.add(alum.id)
    if (recruiter) out.add(recruiter.id)
  }
  return out
}
