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
  /** Their text, so a systems note can take the other systems line. */
  siblingTexts?: string[]
}

export interface ProofChoice {
  key: ProofKey
  /** systems only: which line (recruiter and alum at one company get different ones). */
  variant?: 'platform' | 'pipelines'
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
 * 3. Blockchain @ UCLA alumni: Kalshi (Coinbase at crypto companies); the club also opens the note.
 * 4. Other alumni: crypto → Coinbase; fintech / prediction market → Kalshi; otherwise
 *    systems, taking the line the recruiter didn't (recruiter: platform, alum: pipelines).
 * Null = nothing honestly matches the role: poor fit, no draft.
 */
/** Recruiter gets the platform line, the alum the pipelines line, or the other way round if a sibling already took one. */
function systemsVariant(i: ProofInput, preferred: 'platform' | 'pipelines'): 'platform' | 'pipelines' {
  const sibs = (i.siblingTexts ?? []).join(' ').toLowerCase()
  if (sibs.includes('platform')) return 'pipelines'
  if (sibs.includes('pipelines')) return 'platform'
  return preferred
}

export function chooseProof(i: ProofInput): ProofChoice | null {
  const partner = partnerOf(i.company)
  if (partner) return { key: partner.proof as ProofKey, partner: partner.name, why: `${partner.name} is a Blockchain @ UCLA partner` }

  const ctx = i.context ?? ''
  const crypto = !!i.cryptoOrFintech && CRYPTO.test(ctx)
  const fintech = PREDICTION.test(ctx) || (!!i.cryptoOrFintech && !crypto)
  const sdr = isSdr({ category: i.category, title: i.roleTitle })
  const systemsFits = !!i.category && SYSTEMS_FITS.includes(i.category)

  // SDR / BDR roles (owner, 2026-11-23): (1) own prospecting, (2) Kalshi, (3) Coinbase, alumni only.
  // The next one is used when a colleague's note already took the earlier one.
  if (sdr) {
    // Owner, 2026-11-24: the recruiter, sales leader or founder always gets the
    // prospecting line; the alum gets Kalshi (Coinbase if a colleague's note already has Kalshi).
    const alum = i.branch === 'alumni' || i.branch === 'blockchain_ucla'
    if (!alum) return { key: 'sdr', why: 'SDR role: own prospecting' }
    const sibs = (i.siblingTexts ?? []).join(' ').toLowerCase()
    if (!sibs.includes('kalshi')) return { key: 'kalshi', why: 'SDR role, alum: Kalshi' }
    return { key: 'coinbase', why: 'SDR role, alum: Kalshi taken, Coinbase next' }
  }

  if (i.branch === 'recruiting') {
    if (crypto || fintech) return { key: 'kalshi', why: 'recruiter at a crypto / fintech company' }
    if (i.category === 'partnerships_bd') return { key: 'kalshi', why: 'recruiter, partnerships / BD role' }
    if (systemsFits) return { key: 'systems', variant: systemsVariant(i, 'platform'), why: 'recruiter: systems work' }
    return null
  }

  // Kalshi / Coinbase lines: alumni at crypto / fintech companies and Blockchain @ UCLA alumni only (owner, 2026-11-23).
  if (i.branch === 'blockchain_ucla') return crypto ? { key: 'coinbase', why: 'Blockchain @ UCLA alum, crypto company' } : { key: 'kalshi', why: 'Blockchain @ UCLA alum' }

  if (crypto) return { key: 'coinbase', why: 'crypto company' }
  if (fintech) return { key: 'kalshi', why: 'fintech / prediction-market company' }
  if (i.category === 'partnerships_bd' && i.branch !== 'alumni') return { key: 'kalshi', why: 'partnerships / BD role' }
  if (systemsFits || sdr || i.category === 'partnerships_bd')
    return { key: 'systems', variant: systemsVariant(i, i.branch === 'alumni' ? 'pipelines' : 'platform'), why: `${i.branch}: systems line` }
  return null
}
