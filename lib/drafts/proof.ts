import { PROFILE, type ProofKey } from '@/lib/profile'
import { isSdr } from '@/lib/jobs/fit'

export interface ProofInput {
  company: string
  category: string | null
  cryptoOrFintech: boolean | null
  /** Posting text + industries, for crypto / prediction-market detection. */
  context: string | null
  roleTitle: string | null
  branch: string
  /** Notes already drafted for other people at this company. */
  siblingCount: number
}

export interface ProofChoice {
  key: ProofKey
  /** Set when the recipient's company is a Blockchain @ UCLA partner. */
  partner?: string
  /** Why this proof point (shown in tests / logs). */
  why: string
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(inc|llc|ltd|labs?|corp|co)\b/g, ' ').replace(/\s+/g, ' ').trim()

/** The Blockchain @ UCLA partner this company is, if any. */
export function partnerOf(company: string) {
  const c = norm(company)
  for (const p of Object.values(PROFILE.club.partners)) {
    const names = [p.name, ...('aliases' in p ? p.aliases : [])].map(norm)
    if (names.some((n) => c === n || c.startsWith(`${n} `))) return p
  }
  return null
}

const SYSTEMS_FITS = ['gtm_eng', 'revops', 'sales']
const PREDICTION = /prediction market|event contracts?|forecasting market/i
const CRYPTO = /\bcrypto|blockchain|web3|stablecoin|\bdefi\b|on-?chain|digital assets?|\bnft/i

/**
 * Owner rules (2026-11-23), in order. One proof point per note, never two:
 * 1. Recipient's company is a partner: that relationship outranks everything.
 * 2. Blockchain @ UCLA alumni: the club is the opener; use systems when it fits.
 * 3. Prediction-market / fintech companies: Kalshi. Crypto companies: Coinbase.
 * 4. Partnerships / BD or founding GTM roles anywhere: Kalshi (a deal sourced and closed).
 * 5. GTM Eng: systems first; Coinbase (cold outreach that converted) is the
 *    one club fact that fits, used to vary a second note at the same company.
 * 6. RevOps / sales: systems.
 * Null = nothing honestly matches the role: poor fit, no draft.
 */
export function chooseProof(i: ProofInput): ProofChoice | null {
  const partner = partnerOf(i.company)
  if (partner) return { key: partner.proof as ProofKey, partner: partner.name, why: `${partner.name} is a Blockchain @ UCLA partner` }

  const ctx0 = i.context ?? ''
  // SDR roles (owner, 2026-11-23): own prospecting by default; Kalshi / Coinbase
  // to vary a second note at the company, or at crypto / fintech companies.
  if (isSdr({ category: i.category, title: i.roleTitle })) {
    if (i.cryptoOrFintech && CRYPTO.test(ctx0)) return { key: 'coinbase', why: 'SDR at a crypto company' }
    if (i.cryptoOrFintech || PREDICTION.test(ctx0)) return { key: 'kalshi', why: 'SDR at a fintech company' }
    if (i.siblingCount % 2 === 1) return { key: i.siblingCount % 4 === 1 ? 'kalshi' : 'coinbase', why: 'SDR, varying a later note' }
    return { key: 'sdr', why: 'SDR: own prospecting' }
  }

  const systemsFits = !!i.category && SYSTEMS_FITS.includes(i.category)
  if (i.branch === 'blockchain_ucla' && systemsFits) return { key: 'systems', why: 'shared club opens the note; systems fits the role' }

  const ctx = i.context ?? ''
  // Crypto / fintech per the classifier; the text only decides which club fact.
  if (PREDICTION.test(ctx)) return { key: 'kalshi', why: 'prediction-market company' }
  if (i.cryptoOrFintech && CRYPTO.test(ctx)) return { key: 'coinbase', why: 'crypto company' }
  if (i.cryptoOrFintech) return { key: 'kalshi', why: 'fintech company' }

  const founding = /\bfounding\b/i.test(i.roleTitle ?? '') && systemsFits
  if (i.category === 'partnerships_bd' || founding) return { key: 'kalshi', why: founding ? 'founding GTM role' : 'partnerships / BD role' }

  if (i.category === 'gtm_eng') {
    return i.siblingCount % 2 === 1 ? { key: 'coinbase', why: 'GTM Eng, varying a second note' } : { key: 'systems', why: 'GTM Eng: systems first' }
  }
  if (systemsFits) return { key: 'systems', why: `${i.category}: systems` }
  return null
}
