import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { hasMetric, INTERNAL_NAMES } from '@/lib/drafts/prompt'
import { BANK_KEYS, BANK_NAMES, bankFactsText, isBankKey, type BankKey } from './bank'
import { namedShows, type HookCandidate } from './research'

/**
 * Message wording (owner, 2026-11-23, writing rules v3). One Claude call per company
 * writes, for every hook candidate:
 *   li_hook   the hook in one sentence
 *   li_link   one sentence tying it to Conrad, using ONE bank item that relates to the hook
 *   email_hook the hook plus why it matters for the role (email paragraph)
 * and once per company:
 *   li_nohook one sentence on why the role fits him, for when there is no hook
 *   email_fit one natural sentence using the three fit items
 * The bank is the list of allowed facts, not wording: rephrase freely, add nothing.
 * Code checks every sentence; a candidate that fails keeps no wording and can't be used.
 */

export const WRITE_MODEL = 'claude-opus-5-5'
const PRICE = { input: 4 / 1e6, output: 20 / 1e6 }
export const EST_WRITE_COST = 0.03

export interface CandidateWording {
  li_hook: string
  li_link: string
  li_item: BankKey
  email_hook: string
}

export interface CompanyWording {
  li_nohook: string
  li_nohook_item: BankKey
  email_fit: string
}

const PerCandidate = z.object({
  index: z.number().int(),
  li_hook: z.string().describe('The hook in ONE sentence, at most 28 words: what Conrad enjoyed and the specific idea. No experience claims.'),
  li_item: z.enum(BANK_KEYS as [BankKey, ...BankKey[]]).describe('The ONE bank item that relates most to this hook.'),
  li_link: z.string().describe('ONE sentence, at most 32 words, linking the hook to Conrad through that one item. Honest: if the hook is about something he has not done, say so and frame it as what he wants to learn.'),
  email_hook: z.string().describe('At most 45 words, at most two sentences: the hook, then why it matters for the work this role does. No experience claims, nothing that assumes he already has the job.'),
})
const WriteOutput = z.object({
  candidates: z.array(PerCandidate),
  li_nohook: z.string().describe('For when there is no hook: ONE sentence, at most 30 words, on why the role fits him, using one bank item.'),
  li_nohook_item: z.enum(BANK_KEYS as [BankKey, ...BankKey[]]),
  email_fit: z.string().describe('ONE natural sentence, at most 50 words, saying why the role fits him using the three given fit items. Not a list of labels.'),
})

const SYSTEM = `You write short pieces of a thank-you note from Conrad, a UCLA student who just applied for a GTM role, to a recruiter at the company.

Allowed facts about Conrad (the ONLY facts you may state about him; rephrase freely, never add a fact, tool, company, number or result that is not here):
${bankFactsText()}

Rules:
- Plain, warm, specific. No flattery words (impressive, amazing, inspiring), no em dashes, no questions, no numbers or amounts (ratios in words like "two to one" are fine inside a hook).
- Never join the hook and Conrad's experience in one sentence with "and". The hook sentence is only about the company; the link sentence is about Conrad.
- Never imply experience the facts don't support. If the hook is about something he has not done (for example cold calling: he has not done it), say so plainly and frame it as what he wants to learn.
- Never assume he already has the job: no "my AE", "my team", "my reps", "when I join", "our customers".
- The link sentence uses ONE fact, written as a natural sentence, not a pasted label. Example of the voice: "Most of what I've built so far is outbound plumbing, routing and scoring leads in Clay and Exa, so that problem feels familiar."
- Name the speaker and show only as given.`

function prompt(company: string, role: string, posting: string, fit: BankKey[], cands: HookCandidate[]): string {
  return [
    `Company: ${company}. Role applied for: ${role}.`,
    `Posting (excerpt): ${posting.slice(0, 1500) || '(none)'}`,
    `Three fit items for the email sentence: ${fit.join(', ')}`,
    `Hook candidates:\n${cands
      .map((c, i) => `[${i}] ${c.speaker ? `${c.speaker}${c.speaker_title ? ` (${c.speaker_title})` : ''}` : 'company post'} · ${c.title}\nIdea: ${c.idea}\nQuote: ${c.evidence}\nWhy it matters for the role: ${c.role_clause}\nCurrent hook (style reference only): ${c.hook_sentence}`)
      .join('\n\n') || '(none)'}`,
  ].join('\n\n')
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length
const sentences = (s: string) => (s.trim().match(/[.!](\s|$)/g) ?? []).length
const PRESUMES = /\bmy (ae|aes|team|manager|reps?|pipeline|quota|territory|book|accounts|customers)\b|\bwhen i (join|start)\b|\bour (team|customers|reps?|pipeline|product)\b/i
const EXPERIENCE_CLAIM = /\b(i've|i have|i had|i did|i do|i built|i ran|i run|i led|i used|i booked|i made|my experience|i'm experienced|i've done|i've been)\b/i
const COLD = /\bcold[- ]?call|\bcalling\b|\bphone\b|\bdials?\b/i
const HONEST = /\b(haven't|have not|never|not yet|want to learn|learn|new to|eager to|looking forward to)\b/i
/** GTM tools and names that are not in the bank: Conrad may not claim them. */
const NOT_IN_BANK = /\b(Salesforce|HubSpot|Hubspot|Gong|Outreach\.io|Salesloft|Apollo|ZoomInfo|Marketo|Snowflake|dbt|Looker|Tableau|Segment|Clari|Chorus|Hightouch|Census|Zapier|n8n|Make\.com)\b/
/** Role and industry terms, not facts about Conrad. */
const GENERIC_TERMS = ['SDR', 'SDRs', 'BDR', 'BDRs', 'AE', 'AEs', 'CRM', 'ROI', 'ICP', 'ICPs', 'B2B', 'SaaS', 'RevOps', 'API', 'APIs', 'LLM', 'LLMs', 'AI-first', 'AI-native', 'AI-powered', 'GTM', 'US', 'CRO', 'VP', 'CEO', 'CFO', 'CISO', 'CISOs', 'IT', 'Ops', 'MEDDICC', 'Series']

/** Checks one sentence about Conrad (link sentences, email fit). [] = fine. */
export function conradSentenceProblems(s: string, allowedNames: string[], maxWords: number): string[] {
  const out: string[] = []
  const t = s.trim()
  if (!t) return ['Empty.']
  if (words(t) > maxWords) out.push(`Over ${maxWords} words.`)
  if (sentences(t) > 1) out.push('More than one sentence.')
  if (/^and\b/i.test(t)) out.push('Starts with "And".')
  if (PRESUMES.test(t)) out.push('Assumes he already has the job.')
  if (COLD.test(t) && !HONEST.test(t)) out.push('Implies cold-calling experience.')
  if (NOT_IN_BANK.test(t) && !HONEST.test(t)) out.push(`Claims a tool not in the bank (${t.match(NOT_IN_BANK)![0]}).`)
  // Proper names about him must come from the bank (or the company, speaker and role).
  const allowed = new Set([...BANK_NAMES, ...GENERIC_TERMS, ...allowedNames.flatMap((n) => n.split(/[\s@/,.()-]+/))].map((w) => w.toLowerCase()))
  const names = t
    .split(/(?<=[.!?])\s+/)
    .flatMap((sent) => sent.split(/\s+/).slice(1))
    .map((w) => w.replace(/^[^\w]+/, '').replace(/[^\w]+$/, '').replace(/['’]s$/, ''))
    .filter((w) => /^[A-Z]/.test(w) && !/^(I|I'm|I've|I'd|I'll)$/.test(w))
  const unknown = names.filter((w) => !allowed.has(w.toLowerCase()))
  if (unknown.length) out.push(`Names not in the bank: ${[...new Set(unknown)].join(', ')}.`)
  return [...out, ...commonProblems(t)]
}

/** Checks the hook sentences (about the company). [] = fine. */
export function hookSentenceProblems(s: string, maxWords: number, maxSentences: number): string[] {
  const out: string[] = []
  const t = s.trim()
  if (!t) return ['Empty.']
  if (words(t) > maxWords) out.push(`Over ${maxWords} words.`)
  if (sentences(t) > maxSentences) out.push(`More than ${maxSentences} sentence(s).`)
  if (PRESUMES.test(t)) out.push('Assumes he already has the job.')
  if (EXPERIENCE_CLAIM.test(t) && !HONEST.test(t)) out.push('Hook claims experience; keep that for the link sentence.')
  if (COLD.test(t) && EXPERIENCE_CLAIM.test(t) && !HONEST.test(t)) out.push('Implies cold-calling experience.')
  return [...out, ...commonProblems(t)]
}

function commonProblems(t: string): string[] {
  const out: string[] = []
  if (/\d/.test(t) || hasMetric(t)) out.push('Has a number.')
  if (/[—?]/.test(t)) out.push('Em dash or question.')
  if (/\b(impressive|amazing|inspiring|incredible)\b/i.test(t)) out.push('Flattery word.')
  if (/inbox/i.test(t)) out.push('Mentions the inbox.')
  if (INTERNAL_NAMES.test(t)) out.push('Internal project name.')
  return out
}

/** A show named in the new sentences must be one the vetted research hook named, or be in the page title or URL. */
export function showProblems(text: string, c: Pick<HookCandidate, 'hook_sentence' | 'hook_short' | 'title' | 'url' | 'kind'>): string[] {
  if (c.kind === 'owner_link') return []
  const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const vetted = [...namedShows(c.hook_sentence), ...namedShows(c.hook_short)].map(squash)
  const page = squash(`${c.title} ${c.url}`)
  return namedShows(text)
    .filter((show) => !vetted.some((v) => v.includes(squash(show)) || squash(show).includes(v)) && !page.includes(squash(show)))
    .map((show) => `Names "${show}", which the vetted hook and page don't.`)
}

export interface WriteResult {
  perCandidate: (CandidateWording | null)[]
  company: CompanyWording | null
  problems: string[]
  cost: number
}

/** Write the wording for every candidate (and the no-hook and email-fit sentences) in one call. */
export async function writeWording(
  client: Anthropic,
  i: { company: string; roleTitle: string; posting: string; fitItems: string[] },
  cands: HookCandidate[]
): Promise<WriteResult> {
  const fit = i.fitItems.filter(isBankKey)
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt(i.company, i.roleTitle, i.posting, fit, cands) }]
  let cost = 0
  let best: WriteResult | null = null
  // Two attempts at most: the second is told what failed. Each piece keeps whichever attempt passed.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.messages.parse({
      model: WRITE_MODEL,
      max_tokens: 12000,
      system: SYSTEM,
      output_config: { effort: 'low', format: zodOutputFormat(WriteOutput) },
      messages,
    })
    cost += res.usage.input_tokens * PRICE.input + res.usage.output_tokens * PRICE.output
    const out = res.parsed_output
    if (!out) throw new Error(`write: no structured output (stop: ${res.stop_reason})`)
    const r = checkWording(out, i.company, i.roleTitle, cands)
    best = best
      ? { perCandidate: best.perCandidate.map((p, k) => p ?? r.perCandidate[k]), company: best.company ?? r.company, problems: r.problems, cost: 0 }
      : r
    if (best.company && best.perCandidate.every(Boolean)) break
    messages.push({ role: 'assistant', content: JSON.stringify(out) }, { role: 'user', content: `These pieces failed the checks; rewrite them (keep the rest the same):\n${r.problems.join('\n')}` })
  }
  // Problems that remain after both attempts.
  const left = best!.problems.filter((p) => (/^\[(\d+)\]/.test(p) ? !best!.perCandidate[Number(p.match(/^\[(\d+)\]/)![1])] : !best!.company))
  return { ...best!, problems: left, cost }
}

export type WriteOutputT = z.infer<typeof WriteOutput>

export function checkWording(out: z.infer<typeof WriteOutput>, company: string, role: string, cands: HookCandidate[], cost = 0): WriteResult {
  const problems: string[] = []
  const perCandidate = cands.map((c, idx) => {
    const w = out.candidates.find((x) => x.index === idx)
    if (!w) {
      problems.push(`[${idx}] no wording`)
      return null
    }
    const names = [company, role, c.speaker ?? '', c.title, c.idea]
    const p = [
      ...hookSentenceProblems(w.li_hook, 30, 1).map((x) => `LinkedIn hook: ${x}`),
      ...conradSentenceProblems(w.li_link, names, 35).map((x) => `link: ${x}`),
      ...hookSentenceProblems(w.email_hook, 45, 2).map((x) => `email hook: ${x}`),
      ...showProblems(`${w.li_hook} ${w.email_hook}`, c),
    ]
    if (p.length) {
      problems.push(`[${idx}] ${p.join(' ')}`)
      return null
    }
    return { li_hook: w.li_hook.trim(), li_link: w.li_link.trim(), li_item: w.li_item, email_hook: w.email_hook.trim() }
  })
  const cp = [
    ...conradSentenceProblems(out.li_nohook, [company, role], 35).map((x) => `no-hook line: ${x}`),
    ...conradSentenceProblems(out.email_fit, [company, role], 50).map((x) => `email fit: ${x}`),
  ]
  if (cp.length) problems.push(cp.join(' '))
  return {
    perCandidate,
    company: cp.length ? null : { li_nohook: out.li_nohook.trim(), li_nohook_item: out.li_nohook_item, email_fit: out.email_fit.trim() },
    problems,
    cost,
  }
}
