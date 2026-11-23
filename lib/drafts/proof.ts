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
 * Owner rules (2026-11-23), in order. One proof point per note:
 * 1. Recipient's company is a partner: that relationship outranks everything.
 * 2. Recruiters: crypto / fintech / prediction market → Kalshi; SDR roles →
 *    own prospecting; anything else that fits → systems. Never the Coinbase
 *    cold-email line (it stays for alumni).
 * 3. Blockchain @ UCLA alumni: the club is the opener; systems when it fits.
 * 4. Other alumni and contacts: crypto → Coinbase; fintech / prediction market →
 *    Kalshi; partnerships / BD or founding GTM → Kalshi; GTM Eng → Coinbase
 *    (the recruiter gets systems, so the alum's note is the one that varies);
 *    SDR → Kalshi; RevOps / sales → systems.
 * Null = nothing honestly matches the role: poor fit, no draft.
 */
export function chooseProof(i: ProofInput): ProofChoice | null {
  const partner = partnerOf(i.company)
  if (partner) return { key: partner.proof as ProofKey, partner: partner.name, why: `${partner.name} is a Blockchain @ UCLA partner` }

  const ctx = i.context ?? ''
  const crypto = !!i.cryptoOrFintech && CRYPTO.test(ctx)
  const fintech = PREDICTION.test(ctx) || (!!i.cryptoOrFintech && !crypto)
  const sdr = isSdr({ category: i.category, title: i.roleTitle })
  const systemsFits = !!i.category && SYSTEMS_FITS.includes(i.category)
  const founding = /\bfounding\b/i.test(i.roleTitle ?? '') && systemsFits

  if (i.branch === 'recruiting') {
    if (crypto || fintech) return { key: 'kalshi', why: 'recruiter at a crypto / fintech company' }
    if (sdr) return { key: 'sdr', why: 'recruiter, SDR role: own prospecting' }
    if (i.category === 'partnerships_bd') return { key: 'kalshi', why: 'recruiter, partnerships / BD role' }
    if (systemsFits) return { key: 'systems', why: 'recruiter: systems work' }
    return null
  }

  if (i.branch === 'blockchain_ucla' && systemsFits) return { key: 'systems', why: 'shared club opens the note; systems fits the role' }

  if (crypto) return { key: 'coinbase', why: 'crypto company' }
  if (fintech) return { key: 'kalshi', why: 'fintech / prediction-market company' }
  if (i.category === 'partnerships_bd' || founding) return { key: 'kalshi', why: founding ? 'founding GTM role' : 'partnerships / BD role' }
  if (sdr) return { key: 'kalshi', why: "SDR role: Kalshi varies from the recruiter's prospecting note" }
  if (i.category === 'gtm_eng') return { key: 'coinbase', why: 'GTM Eng: recruiter gets systems, the alum note varies' }
  if (systemsFits) return { key: 'systems', why: `${i.category}: systems` }
  return null
}
