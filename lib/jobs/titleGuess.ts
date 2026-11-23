import type { Category, Seniority } from './categories'

/**
 * Free, title-only guess for closed postings with no description (no Claude
 * call). Always low confidence. A bare "Growth Engineer" is NOT GTM Eng here:
 * without the posting it can't be told apart from product growth.
 */
const RULES: [RegExp, Category][] = [
  [/\b(gtm|go[- ]to[- ]market)\s+(engineer|systems|automation)|revenue (systems|engineer)|sales (systems|automation) engineer/i, 'gtm_eng'],
  [/growth engineer|website|\bseo\b|\bcro\b|conversion|experimentation/i, 'growth_eng_product'],
  [/rev ?ops|revenue operations|sales operations|marketing operations|gtm operations|business operations/i, 'revops'],
  [/account executive|\bae\b|\bsdr\b|\bbdr\b|sales development|account manager|sales engineer|solutions engineer|\bsales\b/i, 'sales'],
  [/partnership|business development|alliances|channel/i, 'partnerships_bd'],
  [/marketing|demand gen|content|brand|lifecycle|growth/i, 'marketing'],
  [/engineer|developer/i, 'engineering'],
]

export function guessFromTitle(title: string | null): { category: Category; seniority: Seniority } {
  const t = title ?? ''
  const category = RULES.find(([re]) => re.test(t))?.[1] ?? 'other'
  const seniority: Seniority = /\b(head of|director|vp|vice president|chief)\b/i.test(t)
    ? 'director_plus'
    : /\b(senior|sr\.?|staff|lead|principal)\b/i.test(t)
      ? 'senior'
      : /\bintern\b/i.test(t)
        ? 'intern'
        : 'unknown'
  return { category, seniority }
}
