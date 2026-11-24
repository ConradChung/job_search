import { PROFILE } from '@/lib/profile'
import { hasMetric, INTERNAL_NAMES } from './prompt'
import { contactType } from '@/lib/export/csv'

/**
 * After-accept message (owner, 2026-11-23): a fixed template per track, no model
 * call, so it can never repeat the note's ask, restate the graduation date or
 * refer to something the note didn't say.
 *
 * Tracks come from the person's `branch` (set when they were found):
 *   alumni / blockchain_ucla → Bruin track (the note was the alumni coffee-chat note)
 *   everyone else (recruiters, sales leaders, founders) → Role track (the note named the open role)
 */
/**
 * Persona comes from `branch` plus the person's title (lib/export/csv contactType):
 *   alum → Bruin track
 *   recruiter → "I've applied" message (only to go out once the role is marked Applied)
 *   sales leader (incl. CRO) → the write-up message
 *   founder → write-up message for now; template pending the owner's decision
 */
export type AfterAcceptTrack = 'bruin' | 'recruiter' | 'leader' | 'founder' | 'fallback'

export const AFTER_ACCEPT_MAX = 300
/** Recruiter message (owner, 2026-11-23): greeting, three bullets, close. */
export const RECRUITER_AFTER_ACCEPT_MAX = 450

/** Recruiter bullets, word for word as the owner wrote them (2026-11-23). */
export const RECRUITER_BULLETS = {
  /** Tier 1 (GTM Engineer) and Tier 3 (RevOps / systems). */
  gtm: [
    "GTM Engineering Head at ZenPort AI, where I'm the only GTM hire",
    'Built the outbound engine end to end: signals, enrichment, scoring, routing, sequencing',
    'Stack: Clay, Apify, Exa, Supabase, Instantly, Claude Code',
  ],
  /** Tier 2 (SDR / BDR). */
  sdr: [
    "Sourced and closed Blockchain @ UCLA's partnership with Kalshi, negotiating with its head of growth",
    'Cold outreach to Coinbase recruiters that turned into on-campus recruiting initiatives',
    'Run outbound end to end as the only GTM hire at ZenPort AI',
  ],
  /** Replaces the Kalshi bullet when the person's note already mentions Kalshi. */
  sdrFallback: 'Hosted ten events with a16z, Uniswap, Deloitte and others as Head of Growth and Partnerships',
} as const
const ALL_BULLETS: string[] = [...RECRUITER_BULLETS.gtm, ...RECRUITER_BULLETS.sdr, RECRUITER_BULLETS.sdrFallback]

/** Tier 2 bullets for SDR / BDR roles, Tier 1/3 bullets otherwise. */
export function recruiterBullets(isSdr: boolean, note: string | null | undefined): string[] {
  if (!isSdr) return [...RECRUITER_BULLETS.gtm]
  const [kalshi, ...rest] = RECRUITER_BULLETS.sdr
  return [/kalshi/i.test(note ?? '') ? RECRUITER_BULLETS.sdrFallback : kalshi, ...rest]
}

export function afterAcceptTrack(branch: string, title: string | null = null): Exclude<AfterAcceptTrack, 'fallback'> {
  const type = contactType(branch, title)
  if (type === 'alum') return 'bruin'
  if (type === 'recruiter') return 'recruiter'
  if (type === 'founder') return 'founder'
  return 'leader'
}

const TITLE_NOUN = /\b(engineer|engineering|manager|representative|rep|analyst|architect|associate|lead|specialist|operator|developer|marketer|strategist|coordinator|director|head|executive|partner|sdr|bdr|ae)\b/i
/** Most specific first: a GTM part beats a RevOps part beats a sales part beats a growth part. */
const ROLE_FIT = [/\b(gtm|go[- ]to[- ]market)\b/i, /\b(revops|revenue)\b/i, /\b(sdr|bdr|sales|business development)\b/i, /\bgrowth\b/i]
const LOCATION_OR_NOISE = /^(remote|hybrid|on-?site|us|usa|united states|nyc|new york|san francisco|sf|london|emea|amer|americas|contract(-to-hire)?|full[- ]time|part[- ]time)$/i

/**
 * The role as it reads in a sentence: "GTM Engineer", not "Software Engineer -
 * GTM Engineering". Splits on " - ", ",", ":", "/", "|"; prefers the part that
 * is both a job title and GTM-ish, else the first part that is a job title.
 */
export function cleanRoleTitle(title: string | null | undefined): string | null {
  if (!title?.trim()) return null
  const parts = title
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .split(/\s+[-–—|]\s+|\s*[,:/|]\s*/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p && !LOCATION_OR_NOISE.test(p))
  if (!parts.length) return null
  const titled = parts.filter((p) => TITLE_NOUN.test(p))
  const pick = ROLE_FIT.map((re) => titled.find((p) => re.test(p))).find(Boolean) ?? titled[0] ?? parts[0]
  return pick
    .replace(/\bgo[- ]to[- ]market\b/i, 'GTM')
    .replace(/\bEngineering$/i, 'Engineer')
    .replace(/\b(I{1,3}|IV)$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function cleanCompany(company: string | null | undefined): string | null {
  const c = (company ?? '').replace(/,?\s+(inc|llc|ltd|corp|co|gmbh|s\.?a\.?)\.?$/i, '').replace(/\.$/, '').trim()
  return c || null
}

const possessive = (name: string) => `${name}'s`

/**
 * Owner (2026-11-23): only say "outbound" for outbound roles: GTM Engineer
 * (plain or with a level / scope word), SDR / BDR, GTM Automation. Systems,
 * analytics, operations, RevOps, data and anything else are not outbound.
 */
const NOT_OUTBOUND = /\b(systems?|analytics?|operations|ops|revops|revenue|data|platform|software)\b/i
export function isOutboundRole(role: string | null | undefined): boolean {
  const r = role ?? ''
  if (/\b(sdr|bdr|sales development|business development rep)/i.test(r)) return true
  if (/\bgtm automation\b/i.test(r)) return true
  return /\b(gtm|go[- ]to[- ]market) engineer\b/i.test(r) && !NOT_OUTBOUND.test(r)
}

export interface AfterAcceptInput {
  firstName: string
  branch: string
  company: string | null
  /** The role the note was about (already short for SDR roles, e.g. "Early Stage SDR"). */
  roleTitle: string | null
  /** The person's own connection note: its "Interested in the X role at Y." line wins, so the message matches what they read. */
  note?: string | null
  /** Their job title (tells a CRO, a sales leader, from a founder). */
  title?: string | null
  /** The company's fit track: 'sdr' (Tier 2) picks the SDR bullets for recruiters. Read from the role title when missing. */
  fitTrack?: string | null
}

/** Role and company as the note named them ("Interested in the X role at Y."), if it did. */
export function roleFromNote(note: string | null | undefined): { role: string; company: string } | null {
  const m = /Interested in the (.+?) role at (.+?)\.\s*Open to connecting\?\s*$/i.exec(note ?? '')
  return m ? { role: m[1].trim(), company: m[2].trim() } : null
}

/** One message per person. Variation is light and deterministic (by first name), structure fixed. */
export function afterAcceptMessage(i: AfterAcceptInput): { text: string; track: AfterAcceptTrack } {
  const name = i.firstName.trim()
  const fromNote = roleFromNote(i.note)
  const company = cleanCompany(fromNote?.company ?? i.company)
  const role = cleanRoleTitle(fromNote?.role ?? i.roleTitle)
  const v = [...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 2
  const track = afterAcceptTrack(i.branch, i.title ?? null)

  // Recruiters (owner, 2026-11-23): says you applied, so it must only go out once the role is marked Applied.
  // Role wording exactly as the note named it; bullets by tier.
  const noteRole = fromNote?.role ?? role
  if (track === 'recruiter' && noteRole && company) {
    const isSdr = i.fitTrack ? i.fitTrack === 'sdr' : /\b(sdr|bdr|sales development|business development)\b/i.test(noteRole)
    const bullets = recruiterBullets(isSdr, i.note).map((b) => `\u2022 ${b}`).join('\n')
    return {
      track,
      text: `Thanks for connecting, ${name}. I've applied for the ${noteRole} role at ${company}.\n\nQuick background:\n${bullets}\n\nIf it looks like a fit, I'd love to set up a quick call.`,
    }
  }
  if ((track === 'leader' || track === 'founder') && role && company) {
    const opener = !isOutboundRole(role)
      ? `I've been thinking about how I'd approach the ${role} seat at ${company}.`
      : v
        ? `I've been thinking about how I'd approach outbound to ${possessive(company)} ICP in the ${role} seat.`
        : `I've been sketching how I'd run outbound to ${possessive(company)} ICP from the ${role} seat.`
    return { track, text: `Thanks for connecting, ${name}.\n${opener} Happy to send a short write-up, or walk you through it in 15 minutes, whichever is easier.` }
  }
  if (track === 'bruin' && company) {
    const ask = v ? 'Would 15 minutes next week work?' : 'Could we find 15 minutes next week?'
    return { track, text: `Thanks, ${name}! ${ask} I'd love to hear how you ended up at ${company} after UCLA.` }
  }
  // Role or company missing: the 15-minute ask without the UCLA line.
  return { track: 'fallback', text: `Thanks, ${name}! Would 15 minutes next week work? I'd love to hear how you got to where you are.` }
}

/**
 * Code checks for an after-accept message (owner, 2026-11-23). [] = fine.
 * `note` is that person's own connection note: nothing it didn't say may be referred back to.
 */
export function afterAcceptProblems(text: string, note = '', company: string | null = null): string[] {
  const problems: string[] = []
  const t = text.trim()
  const recruiter = /^Thanks for connecting, [^.]+\. I've applied for the /.test(t) && /\nQuick background:\n/.test(t)
  const max = recruiter ? RECRUITER_AFTER_ACCEPT_MAX : AFTER_ACCEPT_MAX
  if (t.length > max) problems.push(`It is ${t.length} characters; keep it under ${max}.`)
  // Recruiter bullets are the owner's own wording: checked against the approved list, not the note.
  const lines = t.split('\n')
  const bulletLines = lines.filter((l) => /^\s*[\u2022\-*]\s/.test(l)).map((l) => l.replace(/^\s*[\u2022\-*]\s+/, '').trim())
  if (recruiter) {
    if (bulletLines.length !== 3) problems.push('Exactly three bullets.')
    for (const b of bulletLines) if (!ALL_BULLETS.includes(b)) problems.push(`Bullet not on the approved list: "${b}"`)
    if (!/\n\nIf it looks like a fit, I'd love to set up a quick call\.$/.test(t)) problems.push('Must end with the quick-call line.')
    if (/write-up|hiring manager/i.test(t)) problems.push('No write-up offer to recruiters.')
  } else if (bulletLines.length) problems.push('Bullets are for recruiter messages only.')
  const frame = recruiter ? lines.filter((l) => !/^\s*[\u2022\-*]\s/.test(l)).join('\n') : t
  if (!recruiter) {
    const afterGreeting = t.replace(/^Thanks[^.!?]*[.!?]\s*/, '')
    const sentences = afterGreeting.split(/(?<=[.!?])\s+/).filter((s) => s.trim())
    if (sentences.length > 2) problems.push('At most two sentences after the greeting.')
  }
  if (/march 2027|graduat|class of|\bgrad\b/i.test(t)) problems.push('Never mention the graduation date.')
  if (/in scope|in-scope|eligible|qualif(y|ied) for/i.test(t)) problems.push('Never ask whether you are in scope.')
  if (/\b(audit|teardown|tear-down|free|no[- ]cost|complimentary|our (service|agency)|we can help)\b/i.test(t)) problems.push('Sounds like a vendor pitch; write as a candidate.')
  const backRef = /\b(beyond the|on top of the|as i (said|mentioned)|i mentioned|the .{0,40} i mentioned|like i said|following up on)\b/i
  if (backRef.test(t)) problems.push('Refers back to something; only what this message says.')
  for (const word of ['kalshi', 'coinbase', 'outbound work', 'pipelines', 'platform', 'prospecting']) {
    if (frame.toLowerCase().includes(word) && !note.toLowerCase().includes(word)) problems.push(`Mentions "${word}", which the note did not say.`)
  }
  if ((t.match(/\?/g) ?? []).length > 1) problems.push('One ask only.')
  // A company name like "11x" is not a number. Approved bullets are checked above, not here.
  if (hasMetric(withoutCompany(frame, company))) problems.push('No numbers of any kind (counts, money, rates).')
  if (INTERNAL_NAMES.test(t)) problems.push('No internal project names.')
  if (/\u2014/.test(t)) problems.push('No em dashes.')
  void PROFILE
  return problems
}

/** Text with the company's name removed, so names like "11x" or "1Password" aren't read as figures. */
export function withoutCompany(text: string, company: string | null | undefined): string {
  const names = [company, cleanCompany(company)].filter((n): n is string => !!n && n.length > 1)
  return names.reduce((t, n) => t.split(n).join(' '), text)
}
