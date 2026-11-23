import type { ProofKey } from '@/lib/profile'

/** Categories each proof point honestly matches. */
const SYSTEMS_FITS = ['gtm_eng', 'revops', 'sales']
const CLUB_FITS = ['partnerships_bd', 'marketing']

/**
 * Owner rule: lead with the club for crypto / fintech companies and for
 * partnerships / BD roles; otherwise the systems proof point when it matches
 * the role, the club only if systems doesn't fit, and never both. Null means
 * nothing in the profile matches the role's actual work: flag a poor fit.
 */
export function chooseProof(category: string | null, cryptoOrFintech: boolean | null): ProofKey | null {
  if (cryptoOrFintech || category === 'partnerships_bd') return 'club'
  if (category && SYSTEMS_FITS.includes(category)) return 'systems'
  if (category && CLUB_FITS.includes(category)) return 'club'
  return null
}
