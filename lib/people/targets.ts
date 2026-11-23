import type { SizeBand } from './size'
import type { Track } from '@/lib/jobs/categories'

export type Branch = 'blockchain_ucla' | 'alumni' | 'recruiting' | 'gtm_leadership' | 'executive' | 'poster' | 'other'

export const BRANCH_LABEL: Record<Branch, string> = {
  blockchain_ucla: 'Blockchain @ UCLA alumni',
  alumni: 'UCLA alumni',
  recruiting: 'Recruiting',
  gtm_leadership: 'GTM leadership',
  executive: 'Executive',
  poster: 'Job poster',
  other: 'Other',
}

export const BRANCH_ORDER: Branch[] = ['blockchain_ucla', 'alumni', 'recruiting', 'gtm_leadership', 'executive', 'poster', 'other']

/** Title patterns (tested against the person's current title at the company). */
export const TITLES = {
  salesRecruiting:
    /(recruit|talent|hiring|sourc)[^|]*\b(sales|gtm|go[- ]to[- ]market|revenue|business|commercial)\b|\b(sales|gtm|go[- ]to[- ]market|revenue|business|commercial)\b[^|]*(recruit|talent|hiring)/i,
  technicalRecruiting:
    /\b(technical|engineering|tech|software|product|r&d)\b[^|]*\b(recruit\w*|talent|sourc\w*|hiring)\b|\b(recruit\w*|talent|sourc\w*)\b[^|]*\b(engineering|technical|tech|r&d|product)\b/i,
  recruitingLead:
    /\b(head|director|vp|vice president|lead|manager)\b[^|]*\b(recruit\w*|talent|people)\b|\b(recruit\w*|talent acquisition)\b[^|]*\b(lead|manager|head|director)\b|founding recruiter/i,
  recruiter: /recruit|talent acquisition|talent partner|sourcer|\bhiring\b/i,
  gtmLead:
    /\b(head|director|vp|vice president|lead)\b[^|]*\b(gtm|go[- ]to[- ]market|sales|growth|rev ?ops|revenue operations)\b|\b(gtm|growth|sales|revops)\s+lead\b/i,
  seniorRevenue: /\b(cro|chief revenue officer|vp,? (of )?revenue|vice president,? revenue|coo|chief operating officer)\b/i,
  founderCeo: /\b(co-?founder|founder|ceo|chief executive officer)\b/i,
  /** Executive / leadership / fractional recruiters: skipped unless the role is director-level or above. */
  leadershipRecruiter:
    /\b(leadership|executive|exec)\b[^|]*\b(talent|recruit\w*|search|hiring)\b|\bfractional\b[^|]*\b(talent|recruit\w*)\b|\b(talent|recruit\w*)\b[^|]*\b(leadership|executive)\b/i,
}

/** Alumni ranking: how close a person's function is to the role's track. */
const FUNCTION: Record<Track, RegExp> = {
  sales: /gtm|go[- ]to[- ]market|growth|rev ?ops|revenue|sales|account exec|\bae\b|\bsdr\b|\bbdr\b|business dev|partnership|marketing|customer success/i,
  technical: /engineer|developer|product|data|design|technical|growth|seo/i,
  other: /marketing|growth|gtm|sales|operations/i,
}
const ADJACENT = /recruit|talent|founder|ceo|chief|head of|people/i
export function functionScore(title: string, track: Track): number {
  if (FUNCTION[track].test(title)) return 2
  if (ADJACENT.test(title)) return 1
  return 0
}

/** One search + the titles that count as a hit for it. */
export interface Step {
  id: string
  branch: 'recruiting' | 'gtm_leadership' | 'executive'
  level: number
  /** Natural-language Exa query; the company is appended. */
  query: string
  titles: RegExp
  /** Run only if this returns true given hit counts of earlier steps. */
  when?: (hits: Record<string, number>) => boolean
}

const sum = (h: Record<string, number>, ...ids: string[]) => ids.reduce((n, id) => n + (h[id] ?? 0), 0)

/** Sales / GTM roles: the owner's size-band rules (docs/specs/people-tree.md). */
const SALES: Record<SizeBand, Step[]> = {
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

/** Engineering / product roles, any size: technical recruiters → head of recruiting / talent → recruiters. */
const TECHNICAL: Step[] = [
  { id: 'tech_recruiting', branch: 'recruiting', level: 1, titles: TITLES.technicalRecruiting, query: 'Technical recruiter or engineering recruiter' },
  { id: 'recruiting_lead', branch: 'recruiting', level: 2, titles: TITLES.recruitingLead, query: 'Head of Recruiting, Head of Talent or Recruiting Manager', when: (h) => sum(h, 'tech_recruiting') === 0 },
  { id: 'recruiter', branch: 'recruiting', level: 3, titles: TITLES.recruiter, query: 'Recruiter or Talent Acquisition Partner', when: (h) => sum(h, 'tech_recruiting', 'recruiting_lead') === 0 },
]

/** SDR / BDR roles under 30 people: the sales leader or founder first, recruiting only if neither is found. */
const SDR_SMALL: Step[] = [
  { id: 'gtm_lead', branch: 'gtm_leadership', level: 1, titles: TITLES.gtmLead, query: 'Head of Sales, VP Sales, Head of GTM or Head of Growth' },
  { id: 'executive', branch: 'executive', level: 1, titles: new RegExp(`${TITLES.seniorRevenue.source}|${TITLES.founderCeo.source}`, 'i'), query: 'Co-founder, CEO or Chief Revenue Officer' },
  { id: 'recruiting', branch: 'recruiting', level: 2, titles: TITLES.recruiter, query: 'Head of Talent, Founding Recruiter or recruiter', when: (h) => sum(h, 'gtm_lead', 'executive') === 0 },
]

export function planFor(track: Track, band: SizeBand, sdr = false): Step[] {
  if (sdr && band === 'small') return SDR_SMALL
  return track === 'technical' ? TECHNICAL : SALES[band]
}

const SALES_RULE: Record<SizeBand, string> = {
  small: 'Sales/GTM role, small company: head of recruiting + head of GTM / sales; no GTM head → founder / CEO / CRO',
  medium: 'Sales/GTM role, medium company: recruiting + GTM leadership; no GTM head → CRO / VP Revenue; nothing → founder',
  large: 'Sales/GTM role, large company: sales recruiting lead → else head of recruiting / talent → else recruiters',
}

/** Human-readable routing rule, shown on the company row. */
export function ruleFor(track: Track, band: SizeBand, sdr = false): string {
  if (sdr && band === 'small') return 'SDR role, small company: sales leader + founder / CEO first; neither found → recruiting'
  if (sdr) return `SDR role: ${SALES_RULE[band].replace(/^Sales\/GTM role, /, '')}`
  return track === 'technical' ? 'Engineering/product role: technical recruiters → else head of recruiting / talent → else recruiters' : SALES_RULE[band]
}

export const ALUMNI_QUERY = 'UCLA (University of California, Los Angeles) alumni currently working'
export const BLOCKCHAIN_QUERY = 'Blockchain at UCLA (Blockchain @ UCLA club) members or alumni currently working'

/** Upper bound on searches per company (Blockchain @ UCLA + alumni + every step). */
export function maxSearches(band: SizeBand, track: Track = 'sales', sdr = false): number {
  return 2 + planFor(track, band, sdr).length
}

/** Conservative per-search price for previews (measured $0.007 with text, 2026-11-22). */
export const EST_COST_PER_SEARCH = 0.01
