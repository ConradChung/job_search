import { PROFILE } from './profile'

export const MAX_CHARS = 300 // LinkedIn connection note limit
export const TARGET_CHARS = 280

export interface DraftContext {
  firstName: string
  title: string | null
  branch: 'alumni' | 'recruiting' | 'gtm_leadership' | 'executive' | 'poster' | 'other'
  isUcla: boolean
  company: string
  sizeBand: 'small' | 'medium' | 'large' | null
  roleTitle: string | null
}

const ANGLE: Record<DraftContext['branch'], string> = {
  alumni: 'They went to UCLA like Conrad. Lead with the UCLA connection (e.g. "Fellow Bruin here"), then the role, then a light ask.',
  recruiting: 'They recruit at the company. Name the role and give one line of fit from the facts, then ask who to talk to or whether they are open to a quick chat.',
  gtm_leadership: 'They lead GTM / sales / growth. Speak operator to operator: one line on what Conrad builds that is relevant to their team, the role, and a light ask.',
  executive: 'They are an executive or founder. Be brief and respectful of their time: the role, one line of fit, and ask who the best person to talk to is.',
  poster: 'They posted the role. Reference that they are hiring for it, one line of fit, and a light ask.',
  other: 'Mention the role, one line of fit, and a light ask.',
}

/** Stable across every request, so it can be cached. */
export const SYSTEM_PROMPT = `You write LinkedIn connection request notes for ${PROFILE.name}, who is looking for ${PROFILE.lookingFor}.

Facts about Conrad. These are the only things you may say about him:
- School: ${PROFILE.school}
${PROFILE.facts.map((f) => `- ${f}`).join('\n')}

Rules:
- Under ${TARGET_CHARS} characters in total. LinkedIn cuts notes at ${MAX_CHARS}.
- Plain text, first person, as Conrad. Greet by first name. No emojis, hashtags, em dashes or exclamation marks.
- Mention the specific role and company.
- One low-friction ask, such as a quick chat or who the right person to talk to is. Never ask for a referral outright.
- Never invent anything: no experiences, numbers, mutual connections, shared history, or claims about the recipient beyond their title. Don't say Conrad applied, admires their work, or saw a post.
- For school, say only "from UCLA" or "fellow Bruin". Never say whether Conrad is a student, a graduate, or a class year.
- Don't assume anything about the recipient's team, priorities or needs (no "what your SDR team needs").
- Sound like a person writing a short note, not a template. No "I hope this finds you well", "I came across", or "I'd love to pick your brain".

Return only the note text.`

export function userPrompt(c: DraftContext): string {
  return [
    `Recipient: ${c.firstName}${c.title ? `, ${c.title}` : ''} at ${c.company}`,
    `Why them: ${ANGLE[c.branch]}${c.isUcla && c.branch !== 'alumni' ? ' They also went to UCLA; mention it briefly.' : ''}`,
    `Role Conrad is interested in: ${c.roleTitle ?? 'a GTM role'} at ${c.company}`,
    c.sizeBand ? `Company size: ${c.sizeBand}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

export function firstName(fullName: string): string {
  const cleaned = fullName.replace(/\(.*?\)/g, ' ').replace(/,.*$/, '').trim()
  return cleaned.split(/\s+/)[0] ?? fullName
}

/** Trim whitespace and stray wrapping quotes the model sometimes adds. */
export function cleanDraft(text: string): string {
  return text.trim().replace(/^["“]([\s\S]*)["”]$/, '$1').trim()
}
