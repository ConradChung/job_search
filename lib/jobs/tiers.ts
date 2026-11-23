/**
 * fit_tier: how well the JOB TITLE fits, set by the gtm-job-scrape skill
 * (title regex, first match wins; lower is better). It says nothing about the
 * company. Kept in sync with that skill's Step 3.
 */
export const TIERS = [
  { tier: 1, short: 'GTM Eng', label: 'GTM / founding / growth engineer', rule: 'Title has "founding", "GTM engineer", "go-to-market engineer" or "growth engineer".' },
  { tier: 2, short: 'Growth', label: 'Growth / demand gen', rule: 'Title has "growth" or "demand gen" (but not a tier 1 engineer title).' },
  { tier: 3, short: 'RevOps', label: 'RevOps / sales & GTM ops', rule: 'Title has RevOps, revenue/sales/marketing operations, or "GTM" / "go-to-market".' },
  { tier: 4, short: 'Sales / BD', label: 'AE / BD / sales / partnerships', rule: 'Title has "account executive", "business development", "sales" or "partnerships".' },
  { tier: 5, short: 'Other', label: 'Other title', rule: 'Passed the role filters but matched none of the above.' },
] as const

export function tierMeta(t: number | null) {
  return TIERS.find((x) => x.tier === t) ?? null
}
