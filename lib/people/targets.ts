import type { SizeBand } from './size'

export type Branch = 'alumni' | 'recruiting' | 'gtm_leadership' | 'executive' | 'poster' | 'other'

export const BRANCH_LABEL: Record<Branch, string> = {
  alumni: 'UCLA alumni',
  recruiting: 'Recruiting',
  gtm_leadership: 'GTM leadership',
  executive: 'Executive',
  poster: 'Job poster',
  other: 'Other',
}

export const BRANCH_ORDER: Branch[] = ['alumni', 'recruiting', 'gtm_leadership', 'executive', 'poster', 'other']

/** Title patterns (tested against the person's current title at the company). */
export const TITLES = {
  salesRecruiting:
    /(recruit|talent|hiring|sourc)[^|]*\b(sales|gtm|go[- ]to[- ]market|revenue|business|commercial)\b|\b(sales|gtm|go[- ]to[- ]market|revenue|business|commercial)\b[^|]*(recruit|talent|hiring)/i,
  recruitingLead:
    /\b(head|director|vp|vice president|lead|manager)\b[^|]*\b(recruit\w*|talent|people)\b|\b(recruit\w*|talent acquisition)\b[^|]*\b(lead|manager|head|director)\b|founding recruiter/i,
  recruiter: /recruit|talent acquisition|talent partner|sourcer|\bhiring\b/i,
  gtmLead:
    /\b(head|director|vp|vice president|lead)\b[^|]*\b(gtm|go[- ]to[- ]market|sales|growth|rev ?ops|revenue operations)\b|\b(gtm|growth|sales|revops)\s+lead\b/i,
  seniorRevenue: /\b(cro|chief revenue officer|vp,? (of )?revenue|vice president,? revenue|coo|chief operating officer)\b/i,
  founderCeo: /\b(co-?founder|founder|ceo|chief executive officer)\b/i,
}

/** One search + the titles that count as a hit for it. */
export interface Step {
  id: string
  branch: Exclude<Branch, 'alumni' | 'poster' | 'other'>
  level: number
  /** Natural-language Exa query; the company is appended. */
  query: string
  titles: RegExp
  /** Run only if this returns true given hit counts of earlier steps. */
  when?: (hits: Record<string, number>) => boolean
}

const sum = (h: Record<string, number>, ...ids: string[]) => ids.reduce((n, id) => n + (h[id] ?? 0), 0)

/**
 * Owner rules (docs/specs/people-tree.md):
 * - large: sales recruiting lead → else adjacent recruiting lead → else recruiters.
 * - small: head of recruiting AND head of GTM / sales; if no GTM / sales head, go higher (CRO, COO, founder / CEO).
 * - medium (proposed default): recruiting AND GTM leadership; no GTM head → VP Revenue / CRO / COO;
 *   founder / CEO only when nothing else turned up.
 */
export const PLANS: Record<SizeBand, Step[]> = {
  large: [
    { id: 'sales_recruiting', branch: 'recruiting', level: 1, titles: TITLES.salesRecruiting, query: 'Recruiter or talent acquisition lead who hires for the sales / go-to-market team' },
    { id: 'recruiting_lead', branch: 'recruiting', level: 2, titles: TITLES.recruitingLead, query: 'Head of Recruiting, Head of Talent or Recruiting Manager', when: (h) => sum(h, 'sales_recruiting') === 0 },
    { id: 'recruiter', branch: 'recruiting', level: 3, titles: TITLES.recruiter, query: 'Recruiter or Talent Acquisition Partner', when: (h) => sum(h, 'sales_recruiting', 'recruiting_lead') === 0 },
  ],
  medium: [
    { id: 'recruiting', branch: 'recruiting', level: 1, titles: TITLES.recruiter, query: 'Head of Talent, Recruiting Lead or GTM recruiter' },
    { id: 'gtm_lead', branch: 'gtm_leadership', level: 2, titles: TITLES.gtmLead, query: 'Head of Sales, Head of GTM, Head of Growth, VP Sales or Head of RevOps' },
    { id: 'senior_revenue', branch: 'executive', level: 3, titles: TITLES.seniorRevenue, query: 'Chief Revenue Officer, VP Revenue or COO', when: (h) => sum(h, 'gtm_lead') === 0 },
    { id: 'founder', branch: 'executive', level: 4, titles: TITLES.founderCeo, query: 'Co-founder and CEO', when: (h) => sum(h, 'recruiting', 'gtm_lead', 'senior_revenue') === 0 },
  ],
  small: [
    { id: 'recruiting', branch: 'recruiting', level: 1, titles: TITLES.recruiter, query: 'Head of Talent, Founding Recruiter or recruiter' },
    { id: 'gtm_lead', branch: 'gtm_leadership', level: 2, titles: TITLES.gtmLead, query: 'Head of Sales, Head of GTM, Head of Growth, VP Sales or Head of RevOps' },
    { id: 'executive', branch: 'executive', level: 3, titles: new RegExp(`${TITLES.seniorRevenue.source}|${TITLES.founderCeo.source}`, 'i'), query: 'Co-founder, CEO, COO or Chief Revenue Officer', when: (h) => sum(h, 'gtm_lead') === 0 },
  ],
}

export const ALUMNI_QUERY = 'UCLA (University of California, Los Angeles) alumni currently working'

/** Upper bound on searches per company (alumni + every step). */
export function maxSearches(band: SizeBand): number {
  return 1 + PLANS[band].length
}

/** Conservative per-search price for previews (measured $0.007 with text, 2026-11-22). */
export const EST_COST_PER_SEARCH = 0.01
