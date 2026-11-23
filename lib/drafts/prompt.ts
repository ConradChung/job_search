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
  /** Notes already drafted for other people at this company (must not be reused). */
  siblings: string[]
  limit: number
}

const ANGLE: Record<DraftContext['branch'], (c: DraftContext) => string> = {
  blockchain_ucla: (c) =>
    `They were in Blockchain @ UCLA, the club Conrad is in now. Open with that shared club (not "fellow Bruin"); no partner names needed for the opener. Then ask ONE specific question about their team or function at ${c.company} that they can answer over DM.${c.mentionRole ? ` You may mention the ${c.roleTitle} role since it is in their function.` : ' Do not name the open role.'}`,
  alumni: (c) =>
    `They went to UCLA. Open with the UCLA connection, then ask ONE specific question about their team or function at ${c.company} that they can answer over DM.${c.mentionRole ? ` You may mention the ${c.roleTitle} role since it is in their function.` : ' Do not name the open role.'}`,
  recruiting: (c) => `They recruit at ${c.company}. Name the ${c.roleTitle ?? 'open'} role and ask ONE question: whether Conrad is in scope for it.`,
  gtm_leadership: (c) => `They lead GTM / sales / growth at ${c.company}. Name the ${c.roleTitle ?? 'open'} role, give the proof point, and make ONE ask.`,
  executive: (c) => `They are an executive or founder at ${c.company}. Be brief: name the ${c.roleTitle ?? 'open'} role and ask ONE thing: who the right person to talk to is.`,
  poster: (c) => `They posted the ${c.roleTitle ?? 'open'} role at ${c.company}. Name it and make ONE ask.`,
  other: (c) => `Name the ${c.roleTitle ?? 'open'} role at ${c.company} and make ONE ask.`,
}

/** The single fact block a note may use, in the owner's words. */
export function proofFacts(p: ProofChoice): { label: string; facts: string[]; short?: string } {
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

export function systemPrompt(proof: ProofChoice, limit: number): string {
  const p = proofFacts(proof)
  const club = proof.key !== 'systems'
  return `You write LinkedIn connection request notes for ${PROFILE.name}.

The only facts you may use about Conrad:
- He is at ${PROFILE.school}, graduating ${PROFILE.graduation.label}.
- Proof point (${p.label}):
${p.facts.map((f) => `  - ${f}`).join('\n')}${p.short ? `\n  Short form that fits: "${p.short}"` : ''}
${proof.key === 'partner_team' ? `\nThe recipient works at ${proof.partner}. Say Conrad worked with their team on a campus partnership and stop there: no details, they can check.\n` : ''}${club ? `\n${CLUB_RULES}\n` : ''}
Rules:
- At most ${limit} characters in total. Shorter is better.
- Plain text, first person, as Conrad. Greet by first name. No emojis, hashtags, em dashes or exclamation marks.
- Exactly one ask and at most one question mark. Never "X, or Y?" double asks.
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

/** Partner names a proof point is allowed to mention. */
function allowedPartners(p: ProofChoice): string[] {
  if (p.key === 'kalshi') return ['kalshi']
  if (p.key === 'coinbase') return ['coinbase']
  if (p.key === 'events') return p.partner ? [p.partner.toLowerCase()] : ['a16z', 'andreessen', 'uniswap', 'deloitte', 'aptos', 'zksync', 'wave digital']
  if (p.key === 'partner_team') return [p.partner!.toLowerCase()]
  return []
}

/** Problems with a draft, or [] if it passes every rule checked in code. */
export function draftProblems(text: string, c: Pick<DraftContext, 'limit' | 'siblings' | 'proof'>): string[] {
  const problems: string[] = []
  if (text.length > c.limit) problems.push(`It is ${text.length} characters; the limit is ${c.limit}.`)
  if (INTERNAL_NAMES.test(text)) problems.push('It uses an internal project name; describe the work instead.')
  if ((text.match(/\?/g) ?? []).length > 1) problems.push('It asks more than one question; keep exactly one ask.')
  // Conrad's own title (not Kalshi's head of growth, which is part of the Kalshi fact).
  if (/head of growth and partnerships|\b(i'm|i am|as|was)\s+(the\s+)?head of growth/i.test(text)) problems.push("Name the partner, not Conrad's title.")
  if (/\b\d[\d,]*\+?\s*(events?|members?|attendees?|students|people|partners?|sponsors?|companies)\b|\$\s?\d|\b(dozens|hundreds|thousands) of\b/i.test(text))
    problems.push('It states or implies a count or dollar amount; none are on record.')
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
