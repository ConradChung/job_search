import { PROFILE, type ProofKey } from '@/lib/profile'

/** Words the reader has never heard of: never allowed in a draft (code check too). */
export const INTERNAL_NAMES = /\b(lume|kaspen)\b/i

export interface DraftContext {
  firstName: string
  title: string | null
  branch: 'blockchain_ucla' | 'alumni' | 'recruiting' | 'gtm_leadership' | 'executive' | 'poster' | 'other'
  company: string
  roleTitle: string | null
  /** Alumni only: name the role only when the alum works in the role's function. */
  mentionRole: boolean
  proof: ProofKey
  /** Notes already drafted for other people at this company (must not be reused). */
  siblings: string[]
  limit: number
}

const ANGLE: Record<DraftContext['branch'], (c: DraftContext) => string> = {
  blockchain_ucla: (c) =>
    `They were in Blockchain @ UCLA, the club Conrad is in now. Open with that shared club (not "fellow Bruin"). Then ask ONE specific question about their team or function at ${c.company} that they can answer over DM.${c.mentionRole ? ` You may mention the ${c.roleTitle} role since it is in their function.` : ' Do not name the open role.'}`,
  alumni: (c) =>
    `They went to UCLA. Open with the UCLA connection, then ask ONE specific question about their team or function at ${c.company} that they can answer over DM.${c.mentionRole ? ` You may mention the ${c.roleTitle} role since it is in their function.` : ' Do not name the open role.'}`,
  recruiting: (c) => `They recruit at ${c.company}. Name the ${c.roleTitle ?? 'open'} role and ask ONE question: whether Conrad is in scope for it.`,
  gtm_leadership: (c) => `They lead GTM / sales / growth at ${c.company}. Name the ${c.roleTitle ?? 'open'} role, give the proof point, and make ONE ask.`,
  executive: (c) => `They are an executive or founder at ${c.company}. Be brief: name the ${c.roleTitle ?? 'open'} role and ask ONE thing: who the right person to talk to is.`,
  poster: (c) => `They posted the ${c.roleTitle ?? 'open'} role at ${c.company}. Name it and make ONE ask.`,
  other: (c) => `Name the ${c.roleTitle ?? 'open'} role at ${c.company} and make ONE ask.`,
}

export function systemPrompt(proof: ProofKey, limit: number): string {
  const p = PROFILE.proof[proof]
  return `You write LinkedIn connection request notes for ${PROFILE.name}.

The only facts you may use about Conrad:
- He is at ${PROFILE.school}, graduating ${PROFILE.graduation.label}.
- Proof point (${p.label}):
${p.facts.map((f) => `  - ${f}`).join('\n')}

Rules:
- At most ${limit} characters in total. Shorter is better.
- Plain text, first person, as Conrad. Greet by first name. No emojis, hashtags, em dashes or exclamation marks.
- Exactly one ask and at most one question mark. Never "X, or Y?" double asks.
- Use only the facts above, in your own words. Never use project or brand names that aren't in them; describe the work instead.
- Never invent anything: no numbers, partners, shared history, mutual connections, or claims about the recipient beyond their title. Don't say Conrad applied, admires their work, or saw a post.
- Don't assume anything about the recipient's team, priorities or needs.
- Sound like a person writing a short note, not a template. No "I hope this finds you well", "I came across", or "I'd love to pick your brain".

Return only the note text.`
}

export function userPrompt(c: DraftContext): string {
  const lines = [
    `Recipient: ${c.firstName}${c.title ? `, ${c.title}` : ''} at ${c.company}`,
    `Angle: ${ANGLE[c.branch](c)}`,
  ]
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

/** Problems with a draft, or [] if it passes every rule checked in code. */
export function draftProblems(text: string, c: Pick<DraftContext, 'limit' | 'siblings'>): string[] {
  const problems: string[] = []
  if (text.length > c.limit) problems.push(`It is ${text.length} characters; the limit is ${c.limit}.`)
  if (INTERNAL_NAMES.test(text)) problems.push('It uses an internal project name; describe the work instead.')
  if ((text.match(/\?/g) ?? []).length > 1) problems.push('It asks more than one question; keep exactly one ask.')
  const close = c.siblings.find((s) => similarity(text, s) > MAX_SIMILARITY)
  if (close) problems.push('It is too close to another note at this company; change the opening, the proof wording and the ask.')
  return problems
}
