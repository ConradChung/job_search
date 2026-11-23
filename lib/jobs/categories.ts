/**
 * Role categories. The classifier (lib/jobs/classify.ts) outputs the eight
 * CLASSIFIER_CATEGORIES; a `sales` result is then split by title into SDR/BDR,
 * AE, account management and customer success (splitSales), so the stored
 * category is one of CATEGORY_KEYS.
 */
export const CATEGORIES = {
  gtm_eng: { label: 'GTM Eng', track: 'sales', hint: 'Revenue systems: outbound, sales tooling, RevOps, CRM, enrichment, lead pipelines' },
  sdr: { label: 'Sales – SDR/BDR', track: 'sales', hint: 'Sales / business / market development reps: prospecting and booking meetings' },
  revops: { label: 'RevOps', track: 'sales', hint: 'Revenue / sales / marketing operations' },
  growth_eng_product: { label: 'Growth Eng (product)', track: 'technical', hint: 'Website conversion, SEO, product growth, onboarding, experimentation' },
  ae: { label: 'Sales – AE', track: 'sales', hint: 'Account executives and other closing roles' },
  account_management: { label: 'Account management', track: 'sales', hint: 'Post-sale: account managers, renewals, expansion' },
  customer_success: { label: 'Customer success', track: 'sales', hint: 'Post-sale: customer success, implementation, onboarding' },
  sales: { label: 'Sales – other', track: 'sales', hint: 'Sales roles that are not SDR, AE or post-sale (sales engineering, enablement, BD managers)' },
  partnerships_bd: { label: 'Partnerships / BD', track: 'sales', hint: 'Business development, partnerships, alliances' },
  marketing: { label: 'Marketing', track: 'other', hint: 'Growth marketing, demand gen, content, brand' },
  engineering: { label: 'Engineering', track: 'technical', hint: 'Software / product engineering outside growth' },
  other: { label: 'Other', track: 'other', hint: 'Anything else' },
} as const

export type Category = keyof typeof CATEGORIES
/** Routing track (which people-search chain): not the same as the owner's fit tracks in lib/profile.ts. */
export type Track = 'sales' | 'technical' | 'other'
export type Confidence = 'high' | 'medium' | 'low'
export type Seniority = 'intern' | 'entry' | 'mid' | 'senior' | 'director_plus' | 'unknown'

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[]

/** What the classifier itself may answer; `sales` is split afterwards. */
export const CLASSIFIER_CATEGORIES = ['gtm_eng', 'growth_eng_product', 'sales', 'revops', 'partnerships_bd', 'marketing', 'engineering', 'other'] as const
export type ClassifierCategory = (typeof CLASSIFIER_CATEGORIES)[number]

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && v in CATEGORIES
}

/** Routing track: sales/GTM roles vs engineering/product roles. Marketing / other use the sales chain. */
export function trackOf(category: string | null | undefined): Track {
  return isCategory(category) ? CATEGORIES[category].track : 'other'
}

export const SDR_TITLE = /\b(sdrs?|bdrs?|mdrs?|sales development|business development rep(resentative)?s?|market development rep(resentative)?s?)\b/i
const AM_TITLE = /\baccount manag|\brenewals?\b|\bexpansion manager\b|\bkey accounts?\b/i
const CS_TITLE = /customer success|\bcsm\b|implementation|onboarding|customer support|support (specialist|engineer)|client success/i
const AE_TITLE = /account executive|\bae\b|\bclosers?\b|sales executive|sales representative|\bsales rep\b|inside sales|enterprise sales|sales pioneer|ai native sales/i

/**
 * Owner split (2026-11-23): Sales → SDR/BDR, AE, account management, customer
 * success. Title decides (the classifier already judged it a sales role);
 * anything else (sales engineering, enablement, BD managers) stays `sales`.
 */
export function splitSales(title: string | null | undefined): Category {
  const t = title ?? ''
  if (SDR_TITLE.test(t)) return 'sdr'
  if (CS_TITLE.test(t)) return 'customer_success'
  if (AM_TITLE.test(t)) return 'account_management'
  if (AE_TITLE.test(t)) return 'ae'
  return 'sales'
}

/** The stored category for a classifier answer. */
export function finalCategory(category: string, title: string | null | undefined): Category {
  if (category === 'sales') return splitSales(title)
  return isCategory(category) ? category : 'other'
}

/**
 * The posting asks for prior closing experience of two years or more
 * ("2+ years of closing", "3 years full-cycle", "quota-carrying experience...").
 * SDR roles that ask for it are AE roles in disguise: they block.
 */
export function requiresClosingExperience(description: string | null | undefined): boolean {
  const d = description ?? ''
  const re = /\b(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(?:\d{1,2}\s*)?\+?\s*years?\b([^.\n]{0,90})/gi
  for (const m of d.matchAll(re)) {
    if (Number(m[1]) >= 2 && /\b(clos(e|ed|ing)|quota|full[- ]cycle|account executive|\bae\b|carrying a (number|bag))/i.test(m[2])) return true
  }
  return false
}
