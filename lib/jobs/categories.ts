/** Role categories from the classifier (lib/jobs/classify.ts). */
export const CATEGORIES = {
  gtm_eng: { label: 'GTM Eng', track: 'sales', hint: 'Revenue systems: outbound, sales tooling, RevOps, CRM, enrichment, lead pipelines' },
  growth_eng_product: { label: 'Growth Eng (product)', track: 'technical', hint: 'Website conversion, SEO, product growth, onboarding, experimentation' },
  sales: { label: 'Sales', track: 'sales', hint: 'AE, SDR / BDR, account management' },
  revops: { label: 'RevOps', track: 'sales', hint: 'Revenue / sales / marketing operations' },
  partnerships_bd: { label: 'Partnerships / BD', track: 'sales', hint: 'Business development, partnerships, alliances' },
  marketing: { label: 'Marketing', track: 'other', hint: 'Growth marketing, demand gen, content, brand' },
  engineering: { label: 'Engineering', track: 'technical', hint: 'Software / product engineering outside growth' },
  other: { label: 'Other', track: 'other', hint: 'Anything else' },
} as const

export type Category = keyof typeof CATEGORIES
export type Track = 'sales' | 'technical' | 'other'
export type Confidence = 'high' | 'medium' | 'low'
export type Seniority = 'intern' | 'entry' | 'mid' | 'senior' | 'director_plus' | 'unknown'

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[]

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && v in CATEGORIES
}

/** Routing track: sales/GTM roles vs engineering/product roles. Marketing / other use the sales chain. */
export function trackOf(category: string | null | undefined): Track {
  return isCategory(category) ? CATEGORIES[category].track : 'other'
}
