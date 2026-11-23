import { PROFILE } from '@/lib/profile'
import type { ProofChoice } from './proof'

/** Words the reader has never heard of: never allowed in a draft (code check too). */
export const INTERNAL_NAMES = /\b(lume|kaspen)\b/i

const PARTNER_NAMES = /\b(kalshi|coinbase|a16z|andreessen|uniswap|deloitte|aptos|zksync|wave digital)\b/gi

export interface DraftContext {
  firstName: string
  title: string | null
  branch: 'blockchain_ucla' | 'alumni' | 'recruiting' | 'gtm_leadership' | 'executive' | 'poster' | 'other'
  company: string
  roleTitle: string | null
  /** Alumni only: name the role only when the alum works in the role's function. */
  mentionRole: boolean
  proof: ProofChoice
  /** Tool names only for technical recruiters and alumni in engineering. */
  allowTools: boolean
  /** SDR role, note to the sales leader or founder: recruiter note shape, leader after-accept ask. */
  sdrLeader?: boolean
  /** Status of the role in the tracker (recruiter after-accept message depends on it). */
  roleStatus?: string | null
  /** Notes already drafted for other people at this company (must not be reused). */
  siblings: string[]
  limit: number
}

const RECRUITER_SHAPE = (c: DraftContext) =>
  `Write exactly this shape, in this order: "Hi ${c.firstName}, I'm Conrad at UCLA, ${GRAD_LINE}." then ONE short proof sentence, then exactly "${recruiterClose(c)}". No other question. If it runs long, shorten the proof sentence, never the role.`

const ANGLE: Record<DraftContext['branch'], (c: DraftContext) => string> = {
  blockchain_ucla: (c) =>
    `They were in Blockchain @ UCLA, the club Conrad is in now. Open with that shared club (not "fellow Bruin"); no partner names needed for the opener. Then ask ONE specific question about their team or function at ${c.company} that they can answer over DM.${c.mentionRole ? ` You may mention the ${c.roleTitle} role since it is in their function.` : ' Do not name the open role.'}`,
  alumni: (c) =>
    `They went to UCLA. Open with "fellow Bruin" (that already says UCLA, so never add "I'm at UCLA"), then ask ONE specific question about their team or function at ${c.company} that they can answer over DM.${c.mentionRole ? ` You may mention the ${c.roleTitle} role since it is in their function.` : ' Do not name the open role.'}`,
  recruiting: (c) => `They recruit at ${c.company}. ${RECRUITER_SHAPE(c)}`,
  gtm_leadership: (c) =>
    c.sdrLeader ? `They lead sales / GTM at ${c.company}, hiring for an SDR role. ${RECRUITER_SHAPE(c)}` : `They lead GTM / sales / growth at ${c.company}. Name the ${c.roleTitle ?? 'open'} role, give the proof point, and make ONE ask.`,
  executive: (c) =>
    c.sdrLeader ? `They are a founder or executive at ${c.company}, hiring for an SDR role. ${RECRUITER_SHAPE(c)}` :
    `They are an executive or founder at ${c.company}. Be brief: name the ${c.roleTitle ?? 'open'} role and ask ONE thing: who the right person to talk to is.`,
  poster: (c) => `They posted the ${c.roleTitle ?? 'open'} role at ${c.company}. Name it and make ONE ask.`,
  other: (c) => `Name the ${c.roleTitle ?? 'open'} role at ${c.company} and make ONE ask.`,
}

export const GRAD_LINE = 'graduating March 2027'

/** Owner rule (2026-11-24): no frequency or volume claims in any message. */
export const FREQUENCY = /\b(every|each|per|a)\s+(single\s+)?(day|week|month|morning|quarter)\b|\b(part of|in) my (day|week)\b|\b(daily|weekly|monthly|nightly|hundreds|thousands|dozens|countless|constantly|nonstop|all the time|day in,? day out|lots of|tons of|a ton of|a lot of)\b/i

/**
 * SDR / BDR roles in notes (owner, 2026-11-24): "SDR" or "BDR", no parentheticals
 * or suffixes. A qualifier only when the company has more than one open SDR /
 * BDR role, or when it names a sales segment ("Early Stage SDR": one of several teams).
 */
const SEGMENT = /^(early[- ]stage|mid[- ]?market|enterprise|smb|commercial|strategic|startup)$/i
export function shortSdrTitle(title: string, otherSdrTitles: string[] = []): string {
  const kind = /\bbdr\b|business development rep/i.test(title) ? 'BDR' : 'SDR'
  const qualifier = title
    .replace(/\(.*?\)/g, ' ')
    .replace(/\s+[-–|]\s+.*$/, ' ')
    .replace(/\b(sales|business) development representatives?\b|\b[sb]drs?\b/gi, ' ')
    .replace(/\b(remote|hybrid|on-?site|us|usa|united states|nyc|new york|san francisco|sf)\b/gi, ' ')
    .replace(/[,/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return qualifier && (otherSdrTitles.length || SEGMENT.test(qualifier)) ? `${qualifier} ${kind}` : kind
}
export const TOOL_NAMES = /\b(clay|supabase|exa|apify)\b/i

/** Recruiter notes end with this, word for word (owner rule, 2026-11-23). */
export function recruiterClose(c: Pick<DraftContext, 'roleTitle' | 'company'>): string {
  // Legal suffixes read badly mid-sentence ("Checkr, Inc..").
  const company = c.company.replace(/,?\s+(inc|llc|ltd|corp|co)\.?$/i, '').replace(/\.$/, '')
  return `Interested in the ${c.roleTitle ?? 'open'} role at ${company}. Open to connecting?`
}

/** SDR notes to a sales leader or founder: their after-accept message ends with this (owner, 2026-11-24). */
export const LEADER_QUESTION = 'Are you the right person to talk to about it, or should I go through recruiting?'

/** The single fact block a note may use, in the owner's words. Tool names stripped unless allowed. */
export function proofFacts(p: ProofChoice, allowTools = true): { label: string; facts: string[]; short?: string } {
  if (p.key === 'systems' && p.variant === 'platform') return { label: 'GTM systems', facts: ['Built and shipped a full-stack GTM platform solo.'] }
  if (p.key === 'systems' && p.variant === 'pipelines') return { label: 'GTM systems', facts: ['I build outbound lead pipelines for two startups I co-founded.'] }
  if (p.key === 'systems' && !allowTools) {
    const s = PROFILE.proof.systems
    return { label: s.label, facts: s.facts.map((f) => f.replace(/\s+with tools like [^.]+/i, '')) }
  }
  if (p.key === 'partner_team') {
    return {
      label: `Blockchain @ UCLA worked with ${p.partner}`,
      facts: ['Worked with your team on a campus partnership (through Blockchain @ UCLA).'],
      short: 'worked with your team on a campus partnership',
    }
  }
  if (p.key === 'events' && p.partner) {
    return {
      label: `Blockchain @ UCLA events with ${p.partner}`,
      facts: [`Hosted events with ${p.partner} at Blockchain @ UCLA.`],
      short: `ran events with ${p.partner} at Blockchain @ UCLA`,
    }
  }
  return PROFILE.proof[p.key]
}

const CLUB_RULES = `Club fact rules:
- Use only this one club fact. Name the partner, not Conrad's title.
- These were campus partnerships for a student club. Never call partners clients or customers, never imply revenue, and never imply Conrad worked at any of them.
- There are no counts on record (events, attendance, members, dollars). Never state or imply a number.
- Leave out valuations and funding rounds.`

export function systemPrompt(proof: ProofChoice, limit: number, allowTools = true, softLimit: number = PROFILE.noteSoftLimit): string {
  const p = proofFacts(proof, allowTools)
  const club = proof.key !== 'systems'
  return `You write LinkedIn connection request notes for ${PROFILE.name}.

The only facts you may use about Conrad:
- He is at ${PROFILE.school}. If you mention graduation, write exactly "${GRAD_LINE}", never another phrasing (no "finishing", "through", "class of").
- Proof point (${p.label}):
${p.facts.map((f) => `  - ${f}`).join('\n')}${p.short ? `\n  Short form that fits: "${p.short}"` : ''}
${proof.key === 'partner_team' ? `\nThe recipient works at ${proof.partner}. Say Conrad worked with their team on a campus partnership and stop there: no details, they can check.\n` : ''}${club ? `\n${CLUB_RULES}\n` : ''}
Rules:
- Aim for ${Math.min(softLimit, limit)} characters or fewer; never more than ${limit} in total. Shorter is better. Use the short form of the proof point and cut its second clause first (e.g. drop "working out terms with their head of growth").
- Plain text, first person, as Conrad. Greet by first name. No emojis, hashtags, em dashes or exclamation marks.
- Exactly one ask and at most one question mark. Never "X, or Y?" double asks.
- No frequency or volume claims ("every week", "daily", "hundreds", "a lot of").
- Say "Blockchain @ UCLA", never "my blockchain club".
- Vary the proof wording and the question, not the graduation line.
- Use only the facts above, in your own words. One proof point only. Never use project or brand names that aren't in them; describe the work instead.
- Never invent anything: no numbers, partners, shared history, mutual connections, or claims about the recipient beyond their title. Don't say Conrad applied, admires their work, or saw a post.
- Don't assume anything about the recipient's team, priorities or needs.
- Sound like a person writing a short note, not a template. No "I hope this finds you well", "I came across", or "I'd love to pick your brain".

Return only the note text.`
}

export function userPrompt(c: DraftContext): string {
  const lines = [`Recipient: ${c.firstName}${c.title ? `, ${c.title}` : ''} at ${c.company}`, `Angle: ${ANGLE[c.branch](c)}`]
  if (c.siblings.length) {
    lines.push(
      `Notes already written to other people at ${c.company}. Yours must differ from each in its opening, how it states the proof point, and its ask:`,
      ...c.siblings.map((s, i) => `${i + 1}. ${s}`)
    )
  }
  return lines.join('\n')
}

export function firstName(fullName: string): string {
  const cleaned = fullName.replace(/\(.*?\)/g, ' ').replace(/,.*$/, '').trim()
  return cleaned.split(/\s+/)[0] ?? fullName
}

/** Trim whitespace and stray wrapping quotes the model sometimes adds. */
export function cleanDraft(text: string): string {
  return text.trim().replace(/^["“]([\s\S]*)["”]$/, '$1').trim()
}

/** Word-trigram overlap between two notes (0 to 1). */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const w = s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
    const out = new Set<string>()
    for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`)
    return out
  }
  const A = grams(a)
  const B = grams(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / Math.min(A.size, B.size)
}

export const MAX_SIMILARITY = 0.35

const NOUNS =
  'meetings?|calls?|demos?|replies|responses|leads|accounts|deals|opportunit\\w*|emails?|messages?|events?|members?|attendees?|students|people|partners?|sponsors?|companies|customers?|clients?|signups?|users'
const METRICS = [
  new RegExp(`\\b\\d[\\d,.]*\\s*[km]?\\+?\\s*(${NOUNS})\\b`, 'i'),
  new RegExp(`\\b(one|two|three|four|five|six|seven|eight|nine|ten|dozen|twenty|thirty|fifty|hundred|thousand)\\s+(${NOUNS})\\b`, 'i'),
  /\$\s?\d|\b\d+(\.\d+)?\s?%|\b\d+x\b/i,
  /\b(reply|response|open|conversion|booking|meeting|win|close) rates?\b/i,
  /\b\d[\d,.]*\s*[km]?\s*(in\s+)?(pipeline|revenue|arr|mrr|bookings|quota)\b|\b(pipeline|revenue|arr|mrr|quota)\s+(of|worth)\b/i,
  /\b(dozens|hundreds|thousands|millions) of\b/i,
]
/** Owner rule: no numbers of any kind (counts, money, rates, pipeline) in any note. */
export function hasMetric(text: string): boolean {
  return METRICS.some((re) => re.test(text))
}

/** Partner names a proof point is allowed to mention. */
function allowedPartners(p: ProofChoice): string[] {
  if (p.key === 'sdr') return []
  if (p.key === 'kalshi') return ['kalshi']
  if (p.key === 'coinbase') return ['coinbase']
  if (p.key === 'events') return p.partner ? [p.partner.toLowerCase()] : ['a16z', 'andreessen', 'uniswap', 'deloitte', 'aptos', 'zksync', 'wave digital']
  if (p.key === 'partner_team') return [p.partner!.toLowerCase()]
  return []
}

/**
 * Soft limit (owner, 2026-11-23): a note between the soft and hard limits is
 * allowed but flagged. Over the hard limit is a problem (draftProblems), not a warning.
 */
export function draftWarnings(text: string, soft: number = PROFILE.noteSoftLimit, hard: number = PROFILE.noteLimit): string[] {
  const n = text.trim().length
  return n > soft && n <= hard ? [`It is ${n} characters; aim for ${soft} or fewer (the hard limit is ${hard}).`] : []
}

/** Problems with a draft, or [] if it passes every rule checked in code. */
export function draftProblems(
  text: string,
  c: Pick<DraftContext, 'limit' | 'siblings' | 'proof'> & Partial<Pick<DraftContext, 'branch' | 'allowTools' | 'roleTitle' | 'company' | 'sdrLeader'>>
): string[] {
  const problems: string[] = []
  if (/march 2027/i.test(text) && !/graduating march 2027/i.test(text)) problems.push(`Write the graduation line exactly as "${GRAD_LINE}".`)
  if (/\bblockchain club\b/i.test(text)) problems.push('Say "Blockchain @ UCLA", not "my blockchain club".')
  if (c.allowTools === false && TOOL_NAMES.test(text)) problems.push('No tool names for this reader; describe the work plainly.')
  if ((c.branch === 'alumni' || c.branch === 'blockchain_ucla') && /\b(i'?m|i am)\s+(a\s+\w+\s+)?at ucla\b/i.test(text))
    problems.push('"fellow Bruin" already says UCLA; drop "I\'m at UCLA".')
  if ((c.branch === 'recruiting' || c.sdrLeader) && c.company) {
    const close = recruiterClose({ roleTitle: c.roleTitle ?? null, company: c.company })
    if (!text.trim().endsWith(close)) problems.push(`End with exactly: "${close}" (shorten the proof, never the role).`)
    if (!text.includes(GRAD_LINE)) problems.push(`Open with "I'm Conrad at UCLA, ${GRAD_LINE}."`)
    if (/cold-?email\w*\s+coinbase/i.test(text)) problems.push('Never use the Coinbase cold-email line with a recruiter.')
  }
  if (text.length > c.limit) problems.push(`It is ${text.length} characters; the limit is ${c.limit}.`)
  if (INTERNAL_NAMES.test(text)) problems.push('It uses an internal project name; describe the work instead.')
  if ((text.match(/\?/g) ?? []).length > 1) problems.push('It asks more than one question; keep exactly one ask.')
  // Conrad's own title (not Kalshi's head of growth, which is part of the Kalshi fact).
  if (/head of growth and partnerships|\b(i'm|i am|as|was)\s+(the\s+)?head of growth/i.test(text)) problems.push("Name the partner, not Conrad's title.")
  if (hasMetric(text)) problems.push('It states or implies a number (count, dollar amount, rate or pipeline); none are on record.')
  if (FREQUENCY.test(text)) problems.push('No frequency or volume claims ("every week", "daily", "hundreds").')
  if (/^([\w -]+ )?[SB]DR$/.test(c.roleTitle ?? '') && /development representative/i.test(text)) problems.push(`Call the role "${c.roleTitle} role".`)
  if (c.proof.key === 'kalshi' && /kalshi/i.test(text) && !/sourced and closed/i.test(text))
    problems.push('Say Conrad "sourced and closed" the Kalshi partnership, in those words (not "won" or "landed").')
  if (/\b(clients?|customers?)\b/i.test(text) && c.proof.key !== 'systems') problems.push('Club partners were campus partners, not clients or customers.')
  if (/\b(revenue|valuation|funding|raised|series [a-e])\b/i.test(text) && c.proof.key !== 'systems') problems.push('Leave out revenue, valuations and funding.')
  if (/\b(worked|work|interned|employed)\s+(at|for)\s+(kalshi|coinbase|a16z|uniswap|deloitte|aptos|zksync|wave)/i.test(text))
    problems.push('Never imply Conrad worked at a partner.')
  const named = [...new Set((text.match(PARTNER_NAMES) ?? []).map((n) => n.toLowerCase()))]
  const allowed = allowedPartners(c.proof)
  const extra = named.filter((n) => !allowed.some((a) => n.startsWith(a.split(' ')[0])))
  if (extra.length) problems.push(`It names ${extra.join(', ')}, which is a second proof point; use only the one given.`)
  const close = c.siblings.find((s) => similarity(text, s) > MAX_SIMILARITY)
  if (close) problems.push('It is too close to another note at this company; change the opening, the proof wording and the ask.')
  return problems
}

/** After-accept message: sent once they accept the connection. 2-3 sentences. */
export function followupSystemPrompt(proof: ProofChoice, allowTools = true): string {
  const p = proofFacts(proof, allowTools)
  const extra = PROFILE.proof.systems.facts.map((f) => (allowTools ? f : f.replace(/\s+with tools like [^.]+/i, '')))
  return `You write the message ${PROFILE.name} sends on LinkedIn right after someone accepts his connection request.

Facts you may use (never anything else):
- He is at ${PROFILE.school}, graduating ${PROFILE.graduation.label}.
- Already said in the connection note: ${p.facts.join(' ')}
- Other facts for one more line of proof:
${extra.map((f) => `  - ${f}`).join('\n')}
${proof.key !== 'systems' ? `\n${CLUB_RULES}\n` : ''}
Rules:
- Two or three sentences. Plain text, first person. Thank them briefly for connecting.
- Add exactly one more line of proof: ONE of the other facts, in one clause, different from what the connection note said. Never two.
- This is the first conversation. Never refer to earlier contact (no "since we last spoke", "great to reconnect", "as we discussed").
- No exclamation marks, no em dashes.
- No numbers of any kind (counts, money, rates, pipeline), and no frequency or volume claims ("every week", "daily", "hundreds"). No internal project names. Never invent anything.
- Say "Blockchain @ UCLA", never "my blockchain club". Never imply Conrad worked at a partner.

Return only the message text.`
}

export function followupUserPrompt(c: DraftContext, note: string): string {
  const ask =
    c.branch === 'recruiting' || c.sdrLeader
      ? `End with exactly: "${recruiterFollowupClose(c)}"`
      : `End with one light ask: whether they would be open to a quick chat about their team at ${c.company}. One question only.${(c.branch === 'alumni' || c.branch === 'blockchain_ucla') && !c.mentionRole ? ' Do not name the open role (they are not in its function).' : ''}`
  return [`Recipient: ${c.firstName}${c.title ? `, ${c.title}` : ''} at ${c.company} (${c.branch}).`, `Role: ${c.roleTitle ?? 'open role'}.`, `Connection note already sent:\n${note}`, ask].join('\n')
}

/**
 * SDR notes to a sales leader or founder (owner, 2026-11-24): the after-accept
 * message is two sentences, written in code: thanks plus interest in the role, then the question.
 */
export function leaderFollowup(c: Pick<DraftContext, 'firstName' | 'roleTitle' | 'company'>): string {
  const company = c.company.replace(/,?\s+(inc|llc|ltd|corp|co)\.?$/i, '').replace(/\.$/, '')
  return `Thanks for connecting, ${c.firstName}, and I'm interested in the ${c.roleTitle ?? 'open'} role at ${company}. ${LEADER_QUESTION}`
}

/** Role title without parentheticals or " - Remote" style suffixes (SDR titles are already short). */
export function shortRole(title: string | null | undefined): string {
  const t = (title ?? '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\s+[-–|]\s+.*$/, ' ')
    .replace(/,\s*(remote|hybrid|us|usa|united states|nyc|new york|san francisco|sf)\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t || 'open'
}

const plainCompany = (company: string) => company.replace(/,?\s+(inc|llc|ltd|corp|co)\.?$/i, '').replace(/\.$/, '')

/** Recruiters (owner, 2026-11-24): applied names the application; otherwise the scope question for the role. */
export function recruiterFollowupClose(c: Partial<Pick<DraftContext, 'roleStatus' | 'roleTitle' | 'sdrLeader' | 'company'>>): string {
  if (c.sdrLeader) return LEADER_QUESTION
  const role = shortRole(c.roleTitle)
  return c.roleStatus === 'applied'
    ? `I've applied for the ${role} role at ${plainCompany(c.company ?? '')}. Is a March 2027 grad in scope?`
    : `Is a March 2027 grad in scope for the ${role} role?`
}

/** Proof lines for the recruiter after-accept message, in the owner's words, each with what marks it in a note. */
const PROOF_LINES = {
  prospecting: { mark: /prospect|outbound|outreach|copy and (handle )?replies/i, text: () => 'I do my own prospecting, write the copy and handle replies for two startups I co-founded.' },
  kalshi: { mark: /kalshi/i, text: () => "I sourced and closed Blockchain @ UCLA's partnership with Kalshi." },
  platform: { mark: /platform/i, text: () => 'I built and shipped a full-stack GTM platform solo.' },
  pipelines: {
    mark: /pipelines?|enrichment/i,
    text: (tools: boolean) =>
      tools ? 'I build outbound lead pipelines, enrichment and lead validation with tools like Clay, Exa, Apify and Supabase.' : 'I build outbound lead pipelines for two startups I co-founded.',
  },
} as const

/** One proof line the note didn't use. SDR roles follow the SDR order (prospecting, then Kalshi). */
export function recruiterProofLine(note: string, sdr: boolean, allowTools: boolean): string {
  // Only the proof sentence counts: the role title ("Growth Data Platform") must not look like a used line.
  note = note.replace(/Interested in the [\s\S]*$/, '')
  const order: (keyof typeof PROOF_LINES)[] = sdr ? ['prospecting', 'kalshi', 'platform', 'pipelines'] : ['platform', 'pipelines', 'kalshi']
  // The pipelines line also says "two startups I co-founded": skip it when the note already does.
  const key = order.find((k) => !PROOF_LINES[k].mark.test(note) && !(k === 'pipelines' && !allowTools && /co-?founded/i.test(note))) ?? order[0]
  return PROOF_LINES[key].text(allowTools)
}

/**
 * Recruiter after-accept message (owner, 2026-11-24): fixed template, no model call.
 * Thanks, one proof line different from the note, then the close.
 */
export function recruiterFollowup(c: Pick<DraftContext, 'firstName' | 'roleTitle' | 'company' | 'allowTools'> & Partial<Pick<DraftContext, 'roleStatus'>>, note: string, sdr: boolean): string {
  if (c.roleStatus === 'applied') return `Thanks for connecting, ${c.firstName}. ${recruiterFollowupClose(c)}`
  return `Thanks for connecting, ${c.firstName}. ${recruiterProofLine(note, sdr, c.allowTools)} ${recruiterFollowupClose(c)}`
}

export function followupProblems(text: string, c: Pick<DraftContext, 'branch' | 'allowTools'> & Partial<Pick<DraftContext, 'roleStatus' | 'roleTitle' | 'sdrLeader' | 'company'>>): string[] {
  const problems: string[] = []
  const sentences = text.split(/(?<=[.?!])\s+/).filter((s) => s.trim())
  if (sentences.length < 2 || sentences.length > 4) problems.push('Write two or three sentences.')
  if (hasMetric(text)) problems.push('No numbers of any kind.')
  if (FREQUENCY.test(text)) problems.push('No frequency or volume claims ("every week", "daily", "hundreds").')
  if (/^([\w -]+ )?[SB]DR$/.test(c.roleTitle ?? '') && /development representative/i.test(text)) problems.push(`Call the role "${c.roleTitle} role".`)
  if (INTERNAL_NAMES.test(text)) problems.push('No internal project names.')
  if (/\bblockchain club\b/i.test(text)) problems.push('Say "Blockchain @ UCLA".')
  if (c.allowTools === false && TOOL_NAMES.test(text)) problems.push('No tool names for this reader.')
  if (c.sdrLeader) {
    if (sentences.length !== 2) problems.push('Two sentences: thanks plus interest in the role, then the question.')
  }
  if (c.branch === 'recruiting' || c.sdrLeader) {
    if (!text.trim().endsWith(recruiterFollowupClose(c))) problems.push(`End with exactly: "${recruiterFollowupClose(c)}"`)
    if (/cold-?email\w*\s+coinbase/i.test(text)) problems.push('Never use the Coinbase cold-email line with a recruiter.')
  }
  if ((text.match(/\?/g) ?? []).length > 1) problems.push('One question only.')
  if (/!/.test(text)) problems.push('No exclamation marks.')
  if (/since we (last )?(spoke|talked|met|connected)|great to (hear from you|reconnect)|as we discussed|last time we/i.test(text))
    problems.push('Never refer to earlier contact; this is the first conversation.')
  const factHits = PROFILE.proof.systems.facts.filter((f) => {
    const key = f.toLowerCase().split(/\s+/).slice(0, 4).join(' ').replace(/[^a-z ]/g, '')
    return key && text.toLowerCase().replace(/[^a-z ]/g, '').includes(key)
  }).length
  if (factHits > 1 || /\b(platform|startups i co-?founded)\b[^.?]*\band i\b[^.?]*\b(pipelines|platform|startups)\b/i.test(text))
    problems.push('Use one more fact only, not two.')
  return problems
}
