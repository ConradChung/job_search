import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { hasMetric, INTERNAL_NAMES } from '@/lib/drafts/prompt'
import { BANK_KEYS, EXPERIENCE_BANK, isBankKey, type BankKey } from './bank'

/**
 * Company research for the after-accept messages (owner, 2026-11-23).
 * Two Exa searches (company-owned pages, then press), both limited to the last
 * 12 months, then one Claude call that picks a single specific item (or none)
 * and the three experience-bank items that best match the posting. Everything
 * the model returns is checked in code; a failed check leaves the hook empty.
 */

export const RESEARCH_MODEL = 'claude-opus-5-5'
const PRICE = { input: 4 / 1e6, output: 20 / 1e6 }
export const EST_RESEARCH_COST = 0.05

export interface SourceItem {
  url: string
  title: string
  publishedDate: string | null
  text: string
  kind: 'company' | 'press'
}

export interface ResearchInput {
  company: string
  website: string | null
  industries: string | null
  roleTitle: string
  posting: string
}

export interface ResearchRecord {
  hook_source_url: string | null
  hook_title: string | null
  hook_date: string | null
  hook_summary: string | null
  hook_sentence: string | null
  hook_short: string | null
  fit_items: BankKey[]
  why_no_hook: string | null
  candidates: { url: string; title: string; date: string | null; kind: string }[]
  model: string
  cost_usd: number
}

/** Job boards, aggregators, social and data sites: never a hook source. */
const NOT_A_SOURCE =
  /(^|\.)(linkedin|glassdoor|indeed|ziprecruiter|lever|greenhouse|ashbyhq|workable|wellfound|builtin|crunchbase|pitchbook|zoominfo|rocketreach|apollo|tracxn|cbinsights|craft|owler|g2|capterra|getapp|trustradius|reddit|quora|facebook|instagram|twitter|x|tiktok|wikipedia|medium|substack|youtube|github|producthunt|ycombinator|f6s|dealroom|signalhire|leadiq|theorg|comparably|levels|teamblind|simplify|otta|welcometothejungle|jobs|jobright|remoterocketship)\.(com|co|io|fyi|org|ai|net)$/i

export function domainOf(url: string | null | undefined): string | null {
  try {
    return new URL(/^https?:/.test(url ?? '') ? url! : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

const GENERIC = /\b(your mission|the mission|your vision|your values|your culture|what you're building|what your team is building|the work you('re| are) doing|your growth|your success|your journey|impressive|inspiring|amazing work|great work)\b/i

/** Exa search, last 12 months, with page text. */
export async function exaRecent(
  query: string,
  opts: { includeDomains?: string[]; category?: 'news'; since: string; apiKey?: string }
): Promise<{ items: Omit<SourceItem, 'kind'>[]; cost: number }> {
  const apiKey = opts.apiKey ?? process.env.EXA_API_KEY
  if (!apiKey) throw new Error('EXA_API_KEY is not set')
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      query,
      type: 'auto',
      numResults: 6,
      startPublishedDate: opts.since,
      ...(opts.includeDomains ? { includeDomains: opts.includeDomains } : {}),
      ...(opts.category ? { category: opts.category } : {}),
      contents: { text: { maxCharacters: 1500 } },
    }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Exa ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const data = (await res.json()) as { results?: { url: string; title?: string; publishedDate?: string; text?: string }[]; costDollars?: { total?: number } }
  return {
    items: (data.results ?? []).map((r) => ({ url: r.url, title: r.title ?? '', publishedDate: r.publishedDate ?? null, text: (r.text ?? '').replace(/\s+/g, ' ').slice(0, 1500) })),
    cost: Number(data.costDollars?.total ?? 0),
  }
}

/** Items that can be a hook at all: dated within 12 months, not a job board or aggregator, not a careers page. */
export function usableSources(items: SourceItem[], now = new Date()): SourceItem[] {
  const cutoff = new Date(now.getTime() - 365 * 864e5)
  const seen = new Set<string>()
  return items.filter((i) => {
    const d = i.publishedDate ? new Date(i.publishedDate) : null
    const host = domainOf(i.url)
    if (!d || isNaN(+d) || d < cutoff || d > new Date(now.getTime() + 864e5)) return false
    if (!host || NOT_A_SOURCE.test(host)) return false
    if (/\/(careers?|jobs?|join-us|open-roles|privacy|terms|legal)(\/|$)/i.test(new URL(i.url).pathname)) return false
    if (seen.has(i.url)) return false
    seen.add(i.url)
    return true
  })
}

/** Structured output (Opus 5.5 does not take a forced tool choice). Counts and lengths are checked in code. */
const ResearchOutput = z.object({
  hook_index: z.number().int().nullable().describe('Index of the chosen source item, or null when none is specific, recent and about this company.'),
  why_no_hook: z.string().nullable().describe('When hook_index is null: one short reason.'),
  hook_summary: z.string().nullable().describe('One line: what the item is.'),
  hook_sentence: z.string().nullable().describe('First person, at most 35 words, about the specific item.'),
  hook_short: z.string().nullable().describe('Same hook in at most 15 words, first person, no final period.'),
  fit_items: z.array(z.enum(BANK_KEYS as [BankKey, ...BankKey[]])).describe('Exactly three bank keys, best match first.'),
})

const SYSTEM = `You help Conrad, a UCLA student applying for GTM roles, write a short thank-you note to a recruiter after applying.

Pick ONE source item to mention, or none:
- It must be a real, specific item about THIS company (not a company with a similar name): a product launch, an engineering or GTM blog post, a podcast episode, funding news or a customer case study.
- Company-owned pages or reputable press only. Not job posts, listicles, directories, SEO pages or generic "about us" pages.
- If nothing is specific and clearly about this company, return hook_index null. Never invent or generalise; never write about "your mission", values or culture.

hook_sentence: first person, at most 35 words, one sentence, says what Conrad found interesting about that specific item and why, plainly. No numbers or amounts, no flattery words (impressive, amazing, inspiring), no em dashes, no question.
hook_short: the same idea in at most 15 words, first person, written to open a sentence that continues ", and I think my experience in ... lines up well." No final period. Example: "I enjoyed reading about your new routing agent launch".

fit_items: the three items from the experience bank that best match the WORDING of the job posting. Only bank keys. Pick by what the posting asks for; never stretch.

Experience bank (key: item; what it matches):
${BANK_KEYS.map((k) => `- ${k}: ${EXPERIENCE_BANK[k].email}; matches ${EXPERIENCE_BANK[k].hint}`).join('\n')}`

function userPrompt(i: ResearchInput, items: SourceItem[]): string {
  return [
    `Company: ${i.company}${i.website ? ` (${i.website})` : ''}${i.industries ? `. Industry: ${i.industries}` : ''}`,
    `Role applied for: ${i.roleTitle}`,
    `Job posting (excerpt):\n${i.posting.slice(0, 5000) || '(no posting text)'}`,
    `Source items from the last 12 months:\n${
      items.length
        ? items.map((s, k) => `[${k}] (${s.kind}) ${s.title}\n${s.url}\nPublished ${s.publishedDate?.slice(0, 10)}\n${s.text}`).join('\n\n')
        : '(none found)'
    }`,
  ].join('\n\n')
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/** Code checks on a hook; [] = fine. */
export function hookProblems(sentence: string | null, short: string | null, company: string): string[] {
  const out: string[] = []
  if (!sentence || !short) return ['Hook text missing.']
  if (words(sentence) > 35) out.push('Hook sentence is over 35 words.')
  if (words(short) > 15) out.push('Short hook is over 15 words.')
  for (const [name, s] of [['Hook sentence', sentence], ['Short hook', short]] as const) {
    if (!/\b(I|I'm|I've|I'd|my|me)\b/.test(s)) out.push(`${name} is not first person.`)
    if (GENERIC.test(s)) out.push(`${name} is generic.`)
    if (/\d/.test(s.split(company).join(' ')) || hasMetric(s.split(company).join(' '))) out.push(`${name} has a number.`)
    if (/[—?]/.test(s)) out.push(`${name} has an em dash or a question.`)
    if (INTERNAL_NAMES.test(s)) out.push(`${name} names an internal project.`)
  }
  if (/[.!]$/.test(short.trim())) out.push('Short hook must not end with a period.')
  return out
}

export function fitProblems(keys: unknown): string[] {
  if (!Array.isArray(keys) || keys.length !== 3) return ['Fit line needs exactly three bank items.']
  if (!keys.every(isBankKey)) return ['Fit line has an item outside the bank.']
  if (new Set(keys).size !== 3) return ['Fit line repeats an item.']
  return []
}

type ToolOut = { hook_index: number | null; why_no_hook: string | null; hook_summary: string | null; hook_sentence: string | null; hook_short: string | null; fit_items: string[] }

/** Turn the model's answer into a record; any failed check empties the hook (never the fit line unless it's invalid). */
export function toRecord(out: ToolOut, items: SourceItem[], company: string, cost: number): ResearchRecord & { fitError?: string } {
  const candidates = items.map((s) => ({ url: s.url, title: s.title, date: s.publishedDate?.slice(0, 10) ?? null, kind: s.kind }))
  const fitErr = fitProblems(out.fit_items)
  const base = { fit_items: (fitErr.length ? [] : out.fit_items) as BankKey[], candidates, model: RESEARCH_MODEL, cost_usd: cost, ...(fitErr.length ? { fitError: fitErr[0] } : {}) }
  const empty = { hook_source_url: null, hook_title: null, hook_date: null, hook_summary: null, hook_sentence: null, hook_short: null }
  const k = out.hook_index
  if (k === null || k === undefined || !Number.isInteger(k) || !items[k]) return { ...empty, ...base, why_no_hook: out.why_no_hook?.slice(0, 300) || 'Nothing specific found in the last 12 months.' }
  const problems = hookProblems(out.hook_sentence?.trim() ?? null, out.hook_short?.trim().replace(/[.!]+$/, '') ?? null, company)
  if (problems.length) return { ...empty, ...base, why_no_hook: `Hook dropped: ${problems.join(' ')}` }
  const s = items[k]
  return {
    ...base,
    hook_source_url: s.url,
    hook_title: s.title.slice(0, 300),
    hook_date: s.publishedDate!.slice(0, 10),
    hook_summary: out.hook_summary?.trim().slice(0, 300) || null,
    hook_sentence: out.hook_sentence!.trim(),
    hook_short: out.hook_short!.trim().replace(/[.!]+$/, ''),
    why_no_hook: null,
  }
}

/** Research one company: two Exa searches and one Claude call. Returns the record and its cost. */
export async function researchCompany(client: Anthropic, i: ResearchInput, now = new Date()): Promise<ResearchRecord & { fitError?: string }> {
  const since = new Date(now.getTime() - 365 * 864e5).toISOString()
  const domain = domainOf(i.website)
  let cost = 0
  const items: SourceItem[] = []
  // Only a plain hostname can scope the company-owned search (some sheet rows hold junk in the website column).
  if (domain && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain) && !NOT_A_SOURCE.test(domain)) {
    const own = await exaRecent(`${i.company} product launch, engineering blog, customer story or announcement`, { includeDomains: [domain], since })
    cost += own.cost
    items.push(...own.items.map((x) => ({ ...x, kind: 'company' as const })))
  }
  const press = await exaRecent(`${i.company}${domain ? ` (${domain})` : ''} news: launch, funding, podcast or customer`, { category: 'news', since })
  cost += press.cost
  items.push(...press.items.map((x) => ({ ...x, kind: 'press' as const })))
  const usable = usableSources(items, now)

  const res = await client.messages.parse({
    model: RESEARCH_MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: 'low', format: zodOutputFormat(ResearchOutput) },
    messages: [{ role: 'user', content: userPrompt(i, usable) }],
  })
  cost += res.usage.input_tokens * PRICE.input + res.usage.output_tokens * PRICE.output
  if (!res.parsed_output) throw new Error(`research: no structured output (stop: ${res.stop_reason})`)
  return toRecord(res.parsed_output as ToolOut, usable, i.company, cost)
}
