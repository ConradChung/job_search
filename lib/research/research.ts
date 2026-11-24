import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { hasMetric, INTERNAL_NAMES } from '@/lib/drafts/prompt'
import { BANK_KEYS, EXPERIENCE_BANK, isBankKey, type BankKey } from './bank'

/**
 * Role-relevant hook research (owner, 2026-11-23, v2).
 *
 * 1. Find who runs go-to-market (CRO, VP Sales, Head of Growth, RevOps, a GTM-minded
 *    founder): people already in the tracker plus one Exa people search.
 * 2. Search their podcasts, interviews, talks and posts from the last 12 months
 *    (YouTube and podcast sites included), then company launches and customer
 *    stories; engineering content only as a last resort. Exa returns the page
 *    text plus query-targeted excerpts of the show notes or transcript.
 * 3. One Claude call reads that content and proposes up to three candidates, each
 *    a specific idea (named practice, decision, ratio, how they run pilots or
 *    structure the team) with a verbatim quote, a one-clause tie to the role, a
 *    hook sentence and a short hook, plus the three experience-bank items.
 * 4. Code checks every candidate: the quote must be in the source, the idea must
 *    not be readable from the title alone, no headline growth numbers, no numbers
 *    in the hook, first person, word limits. Failures are dropped, never patched.
 */

export const RESEARCH_MODEL = 'claude-opus-5-5'
const PRICE = { input: 4 / 1e6, output: 20 / 1e6 }
export const EST_RESEARCH_COST = 0.12

export type CandidateKind = 'gtm_leader' | 'launch' | 'customer_story' | 'engineering' | 'owner_link'
const KIND_RANK: Record<CandidateKind, number> = { owner_link: -1, gtm_leader: 0, launch: 1, customer_story: 1, engineering: 2 }

export interface SourceItem {
  url: string
  title: string
  publishedDate: string | null
  text: string
  highlights: string[]
  /** Which search found it (for the prompt only). */
  via: string
}

export interface HookCandidate {
  url: string
  title: string
  date: string | null
  kind: CandidateKind
  speaker: string | null
  speaker_title: string | null
  idea: string
  evidence: string
  role_clause: string
  hook_sentence: string
  hook_short: string
  /** Written sentences (lib/research/write.ts); a candidate without them can't be used. */
  li_hook?: string
  li_link?: string
  li_item?: string
  email_hook?: string
}

export interface ResearchInput {
  company: string
  website: string | null
  industries: string | null
  roleTitle: string
  posting: string
  /** GTM people already in the tracker (name, title). */
  knownLeaders?: { name: string; title: string | null }[]
}

export interface ResearchResult {
  hook_candidates: HookCandidate[]
  fit_items: BankKey[]
  why_no_hook: string | null
  /** Every source the searches returned (for the record). */
  candidates: { url: string; title: string; date: string | null; via: string }[]
  rejected: string[]
  leaders: { name: string; title: string | null }[]
  model: string
  cost_usd: number
  fitError?: string
}

/** Job boards, people/company databases, review sites: never a hook source. YouTube, podcasts, Substack, Medium and LinkedIn posts are allowed. */
const NOT_A_SOURCE =
  /(^|\.)(glassdoor|indeed|ziprecruiter|lever|greenhouse|ashbyhq|workable|wellfound|builtin|crunchbase|pitchbook|zoominfo|rocketreach|apollo|tracxn|cbinsights|craft|owler|g2|capterra|getapp|trustradius|quora|wikipedia|f6s|dealroom|signalhire|leadiq|theorg|comparably|levels|teamblind|simplify|otta|welcometothejungle|jobs|jobright|remoterocketship|glassdoor)\.(com|co|io|fyi|org|ai|net)$/i

export function domainOf(url: string | null | undefined): string | null {
  try {
    return new URL(/^https?:/.test(url ?? '') ? url! : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

const GENERIC = /\b(your mission|the mission|your vision|your values|your culture|what you're building|what your team is building|the work you('re| are) doing|your growth|your success|your journey|impressive|inspiring|amazing work|great work)\b/i
/** Headline growth numbers everyone quotes: never the idea. */
const HEADLINE = /\b(arr|revenue|valuation|valued|raised|raise|funding|series [a-f]|unicorn|grew|growth rate|hypergrowth|\d+x|\$\s?\d)/i
const GTM_TITLE = /\b(cro|chief revenue|chief commercial|chief growth|vp,? (of )?(sales|revenue|growth|go[- ]to[- ]market|gtm|marketing)|head of (sales|growth|revenue|gtm|go[- ]to[- ]market|revops|revenue operations)|revenue operations|revops|svp.*(sales|revenue)|gtm lead|founder|co-?founder|ceo|president)\b/i

type ExaItem = { url: string; title?: string; publishedDate?: string; text?: string; highlights?: string[] }
type ExaResponse = { results?: ExaItem[]; costDollars?: { total?: number } }

async function exa(path: '/search' | '/contents', body: Record<string, unknown>, apiKey = process.env.EXA_API_KEY): Promise<ExaResponse> {
  if (!apiKey) throw new Error('EXA_API_KEY is not set')
  const res = await fetch(`https://api.exa.ai${path}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Exa ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return (await res.json()) as ExaResponse
}

const toItem = (r: ExaItem, via: string): SourceItem => ({
  url: r.url,
  title: (r.title ?? '').replace(/\s+/g, ' ').trim(),
  publishedDate: r.publishedDate ?? null,
  text: (r.text ?? '').replace(/\s+/g, ' ').slice(0, 1800),
  highlights: (r.highlights ?? []).map((h) => h.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3),
  via,
})

/** What the excerpts should be about, by role: the work that role does. */
export function highlightQuery(roleTitle: string): string {
  const r = roleTitle.toLowerCase()
  const focus = /\b(sdr|bdr|sales development|business development)\b/.test(r)
    ? 'outbound prospecting, the SDR team, how meetings are booked, territories, sales process'
    : /\b(revops|revenue operations|operations|systems|analytics)\b/.test(r)
      ? 'GTM systems, CRM, data, lead routing and scoring, forecasting, sales process, tooling'
      : 'GTM engineering, outbound systems, data enrichment, automation, lead routing, AI in sales'
  return `How they run go-to-market: ${focus}, how the sales team is structured, how pilots run, specific practices and decisions`
}

/** Content search: last 12 months, page text plus role-targeted excerpts. */
async function contentSearch(query: string, since: string, highlights: string, numResults: number, via: string, extra: Record<string, unknown> = {}) {
  const d = await exa('/search', {
    query,
    type: 'auto',
    numResults,
    startPublishedDate: since,
    contents: { text: { maxCharacters: 1800 }, highlights: { query: highlights, numSentences: 3, highlightsPerUrl: 3 } },
    ...extra,
  })
  return { items: (d.results ?? []).map((r) => toItem(r, via)), cost: Number(d.costDollars?.total ?? 0) }
}

/** Who runs GTM: tracker people first, then an Exa people search (names from "Name - Title at Company" result titles). */
export async function findLeaders(company: string, known: { name: string; title: string | null }[] = []): Promise<{ leaders: { name: string; title: string | null }[]; cost: number }> {
  const d = await exa('/search', { query: `${company} Chief Revenue Officer, VP Sales, Head of Growth or RevOps lead`, category: 'people', numResults: 8, contents: { text: { maxCharacters: 400 } } })
  const first = company.toLowerCase().split(/\s/)[0]
  const found = (d.results ?? [])
    .map((r) => {
      // Result title is the name; the profile text opens with the headline / current role.
      const head = (r.text ?? '').replace(/\s+/g, ' ').slice(0, 300)
      const role = head.match(GTM_TITLE)
      return { name: (r.title ?? '').split(/\s+[-|–]\s+/)[0].trim(), title: role ? head.slice(Math.max(0, (role.index ?? 0) - 40), (role.index ?? 0) + 80).trim() : null, head }
    })
    .filter((p) => p.name && p.title && p.head.toLowerCase().includes(first))
    .map(({ name, title }) => ({ name, title: title!.replace(/^#+\s*/, '').split(name).join('').replace(/\s+/g, ' ').trim() }))
  const all = [...known.filter((k) => GTM_TITLE.test(k.title ?? '')), ...found]
  const seen = new Set<string>()
  const leaders = all.filter((l) => {
    const k = l.name.toLowerCase()
    if (seen.has(k) || l.name.split(/\s+/).length < 2) return false
    seen.add(k)
    return true
  })
  // Most senior GTM first: CRO / chief, then SVP / VP, then heads and RevOps, founders last.
  const rank = (t: string | null) => (/\b(cro|chief (revenue|commercial|growth))\b/i.test(t ?? '') ? 0 : /\b(s?vp|vice president)\b/i.test(t ?? '') ? 1 : /founder|ceo|president/i.test(t ?? '') ? 3 : 2)
  leaders.sort((a, b) => rank(a.title) - rank(b.title))
  return { leaders: leaders.slice(0, 3), cost: Number(d.costDollars?.total ?? 0) }
}

/** Items that can be a hook at all: dated within 12 months (owner links excepted), not a job board or database, not a careers page, with real content. */
export function usableSources(items: SourceItem[], now = new Date(), opts: { allowUndated?: boolean } = {}): SourceItem[] {
  const cutoff = new Date(now.getTime() - 365 * 864e5)
  const seen = new Set<string>()
  return items.filter((i) => {
    const d = i.publishedDate ? new Date(i.publishedDate) : null
    const host = domainOf(i.url)
    if (!opts.allowUndated && (!d || isNaN(+d) || d < cutoff || d > new Date(now.getTime() + 864e5))) return false
    if (!host || NOT_A_SOURCE.test(host)) return false
    let path = ''
    try {
      path = new URL(i.url).pathname
    } catch {
      return false
    }
    if (/\/(careers?|jobs?|join-us|open-roles|privacy|terms|legal)(\/|$)/i.test(path)) return false
    if (host.endsWith('linkedin.com') && !/^\/(posts|pulse)\//.test(path)) return false
    if (i.text.length + i.highlights.join(' ').length < 400) return false
    const key = i.url.replace(/[?#].*$/, '').replace(/\/$/, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const Candidate = z.object({
  source_index: z.number().int().describe('Index of the source item.'),
  kind: z.enum(['gtm_leader', 'launch', 'customer_story', 'engineering']).describe('gtm_leader: a GTM leader or GTM-minded founder speaking or writing.'),
  speaker: z.string().nullable().describe('Who says it (full name), or null for a company post with no named author.'),
  speaker_title: z.string().nullable(),
  idea: z.string().describe('The one specific idea, in a short clause, as the source states it.'),
  evidence: z.string().describe('A verbatim quote (copied exactly, 40-300 characters) from that item\'s text or excerpts that states the idea.'),
  role_clause: z.string().describe('One clause: why this idea matters for the work the applied-for role does.'),
  hook_sentence: z.string().describe('At most 45 words, at most two sentences, first person: the idea, then the role tie.'),
  hook_short: z.string().describe('At most 15 words, opens a sentence that continues ", and I think my experience in ...". No final period.'),
})
const ResearchOutput = z.object({
  candidates: z.array(Candidate).describe('Up to three, best first. Empty when nothing qualifies.'),
  none_reason: z.string().nullable().describe('When there are no candidates: one short reason.'),
  fit_items: z.array(z.enum(BANK_KEYS as [BankKey, ...BankKey[]])).describe('Exactly three bank keys, best match to the posting first.'),
})
type Output = z.infer<typeof ResearchOutput>

const EXAMPLE = `Worked example of the quality wanted:
Company: Legora. Role: GTM Systems.
Source: GTMnow Podcast with CRO Patrick Forquer.
Idea: Legora staffs post-sale two to one against pre-sale.
role_clause: building the systems behind a motion that customer-heavy is exactly the work I want to do
hook_sentence: "I really enjoyed Patrick Forquer's GTMnow episode, especially that Legora staffs post-sale two to one against pre-sale. Building the systems behind a motion that customer-heavy is exactly the work I want to do."
hook_short: "Loved Patrick Forquer's GTMnow episode on the two-to-one post-sale model"`

const SYSTEM = `You research a company for Conrad, a UCLA student who applied for a GTM role there, so his thank-you note to the recruiter shows he actually read or listened to something relevant.

Find up to three candidates, best first, in this order of preference:
1. A go-to-market leader (CRO, VP Sales, Head of Growth, RevOps lead, or a founder talking about GTM) in a podcast, interview, talk or post.
2. Otherwise a product launch or a customer story.
3. Engineering content only if nothing else exists.

Each candidate is ONE specific idea taken from the content itself (the text or excerpts), not the title: a named practice, a decision, a ratio, how they run pilots, how they structure or staff the team, how they qualify or route deals. If someone could write the idea without opening the link, it does not qualify. Skip headline growth numbers (ARR, revenue, valuation, funding, growth rates); everyone quotes those. The idea must be about THIS company.

evidence: copy a sentence or phrase from that item's text or excerpts exactly, character for character, that states the idea.
role_clause: one clause on why the idea matters for the work the applied-for role does (read the posting).
hook_sentence: first person, at most 45 words, at most two sentences: what Conrad enjoyed and the specific idea, then the role tie. Name the speaker, and the show only as this item's own title or header names it (pages often list other episodes; never borrow their names). Write numbers as words only for ratios like "two to one"; otherwise no numbers or amounts. No flattery words (impressive, amazing, inspiring), no em dashes, no questions.
hook_short: at most 15 words, may start "Loved" or "I enjoyed", names the speaker or source and the idea, no final period.

If nothing qualifies, return no candidates and say why. Never invent or generalise; never write about "your mission", values or culture.

fit_items: the three items from the experience bank that best match the WORDING of the job posting. Only bank keys; never stretch.

Experience bank (key: item; what it matches):
${BANK_KEYS.map((k) => `- ${k}: ${EXPERIENCE_BANK[k].email}; matches ${EXPERIENCE_BANK[k].hint}`).join('\n')}

${EXAMPLE}`

function userPrompt(i: ResearchInput, leaders: { name: string; title: string | null }[], items: SourceItem[]): string {
  return [
    `Company: ${i.company}${i.website ? ` (${i.website})` : ''}${i.industries ? `. Industry: ${i.industries}` : ''}`,
    `GTM leaders found: ${leaders.length ? leaders.map((l) => `${l.name}${l.title ? ` (${l.title})` : ''}`).join('; ') : 'none found'}`,
    `Role applied for: ${i.roleTitle}`,
    `Job posting (excerpt):\n${i.posting.slice(0, 4000) || '(no posting text)'}`,
    `Source items:\n${
      items.length
        ? items
            .map((s, k) => `[${k}] ${s.title}\n${s.url}\nPublished ${s.publishedDate?.slice(0, 10) ?? 'unknown'} · found by: ${s.via}\nExcerpts:\n${s.highlights.map((h) => `- ${h}`).join('\n') || '(none)'}\nText: ${s.text}`)
            .join('\n\n')
        : '(none found)'
    }`,
  ].join('\n\n')
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length
const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
const STOP = new Set('this that with from they their there have been what when where which about into over more most also just very much than then them only some such like your ours were will would could should does doing being make makes made team company'.split(' '))

/** Code checks on a hook; [] = fine. */
export function hookProblems(sentence: string | null, short: string | null, company: string): string[] {
  const out: string[] = []
  if (!sentence || !short) return ['Hook text missing.']
  if (words(sentence) > 45) out.push('Hook sentence is over 45 words.')
  if ((sentence.match(/[.!](\s|$)/g) ?? []).length > 2) out.push('Hook is more than two sentences.')
  if (words(short) > 15) out.push('Short hook is over 15 words.')
  if (!/\b(I|I'm|I've|I'd|my|me)\b/.test(sentence)) out.push('Hook sentence is not first person.')
  if (!/\b(I|I'm|I've|I'd|my|me)\b/.test(short) && !/^(really )?(loved|enjoyed|liked|appreciated)\b/i.test(short.trim())) out.push('Short hook is not first person.')
  for (const [name, s] of [['Hook sentence', sentence], ['Short hook', short]] as const) {
    const t = s.split(company).join(' ')
    if (GENERIC.test(s)) out.push(`${name} is generic.`)
    if (/\d/.test(t) || hasMetric(t)) out.push(`${name} has a number.`)
    if (HEADLINE.test(t)) out.push(`${name} leans on a headline growth number.`)
    if (/[—?]/.test(s)) out.push(`${name} has an em dash or a question.`)
    if (INTERNAL_NAMES.test(s)) out.push(`${name} names an internal project.`)
  }
  if (/[.!]$/.test(short.trim())) out.push('Short hook must not end with a period.')
  return out
}

/** The idea must come from the content: quote found in the source, and not just the title restated. */
export function groundingProblems(c: { idea: string; evidence: string }, item: SourceItem, names: string[] = []): string[] {
  const out: string[] = []
  const body = norm([item.text, ...item.highlights].join(' '))
  const ev = norm(c.evidence)
  if (ev.length < 30) out.push('Quote is too short to show the idea.')
  else if (!body.includes(ev)) out.push('Quote is not in the source.')
  if (norm(item.title).includes(ev)) out.push('Quote is only the title.')
  const skip = new Set(names.flatMap((n) => norm(n).split(' ')))
  const ideaWords = norm(c.idea).split(' ').filter((w) => w.length > 3 && !STOP.has(w) && !skip.has(w))
  const title = norm(item.title)
  if (ideaWords.length && ideaWords.filter((w) => title.includes(w)).length / ideaWords.length > 0.6) out.push('The idea can be read from the title alone.')
  if (HEADLINE.test(c.idea)) out.push('The idea is a headline growth number.')
  return out
}

/** Show or outlet names the hook attributes the idea to ("Stevie Case's Operators Said episode" → "Operators Said"). */
export function namedShows(text: string): string[] {
  const out: string[] = []
  const kw = ['episode', 'podcast', 'interview', 'talk', 'keynote', 'webinar', 'newsletter', 'show', 'session', 'panel', 'roundtable', 'fireside', 'summit', 'conference']
    .map((w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`)
    .join('|')
  const re = new RegExp(`((?:[A-Z][\\w.&'’-]*\\s+){0,4}[A-Z][\\w.&-]*)\\s+(${kw})\\b`, 'g')
  for (const m of text.matchAll(re)) {
    // A capitalised show word is part of the name ("GTM Roundtable", "Crew Podcast").
    const full = /^[A-Z]/.test(m[2]) ? `${m[1]} ${m[2]}` : m[1]
    // Drop the person part of a possessive ("Patrick Forquer's GTMnow" → "GTMnow"); a bare possessive is a person, not a show.
    const parts = full.split(/['’]s\s+/)
    const show = parts.length > 1 ? parts[parts.length - 1] : /['’]s$/.test(full) ? '' : full
    const clean = show.replace(/^(the|a|an|his|her|their|your)\s+/i, '').trim()
    if (clean && !/^(I|I've|I'm|Loved|Enjoyed|Really|The)$/i.test(clean)) out.push(clean)
  }
  return out
}

/** Attribution: a show named in the hook must be this page's own (title, header or URL); the speaker must appear in the source. */
export function attributionProblems(c: { speaker: string | null; hook_sentence: string; hook_short: string; kind?: string }, item: Pick<SourceItem, 'url' | 'title' | 'text' | 'highlights'>): string[] {
  const out: string[] = []
  const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '')
  // YouTube puts the channel and description further down; other pages name their show in the header.
  const headerLen = /youtube\.com|youtu\.be/.test(item.url) ? 3000 : 500
  const header = squash(`${item.title} ${item.text.slice(0, headerLen)} ${item.url}`)
  // The owner's own link: they vouch for the show name.
  for (const show of c.kind === 'owner_link' ? [] : new Set([...namedShows(c.hook_sentence), ...namedShows(c.hook_short)])) {
    if (!header.includes(squash(show))) out.push(`"${show}" is not this page's show or outlet.`)
  }
  if (c.speaker) {
    const last = c.speaker.trim().split(/\s+/).pop() ?? ''
    if (last.length > 2 && !squash(`${item.title} ${item.text} ${item.highlights.join(' ')}`).includes(squash(last))) out.push(`Speaker ${c.speaker} is not in the source.`)
  }
  return out
}

export function fitProblems(keys: unknown): string[] {
  if (!Array.isArray(keys) || keys.length !== 3) return ['Fit line needs exactly three bank items.']
  if (!keys.every(isBankKey)) return ['Fit line has an item outside the bank.']
  if (new Set(keys).size !== 3) return ['Fit line repeats an item.']
  return []
}

/** Model output → checked candidates (top three by kind, then the model's order). */
export function toCandidates(out: Pick<Output, 'candidates'>, items: SourceItem[], company: string, ownerLink = false): { kept: HookCandidate[]; rejected: string[] } {
  const kept: HookCandidate[] = []
  const rejected: string[] = []
  const used = new Set<string>()
  for (const c of out.candidates ?? []) {
    const item = items[c.source_index]
    if (!item) {
      rejected.push(`#${c.source_index}: no such source`)
      continue
    }
    const short = c.hook_short.trim().replace(/[.!]+$/, '')
    const problems = [
      ...groundingProblems(c, item, [company, c.speaker ?? '']),
      ...attributionProblems({ ...c, hook_short: short, kind: ownerLink ? 'owner_link' : c.kind }, item),
      ...hookProblems(c.hook_sentence.trim(), short, company),
      ...(c.role_clause?.trim() ? [] : ['No role tie.']),
      ...(used.has(item.url) ? ['Same source twice.'] : []),
    ]
    if (problems.length) {
      rejected.push(`${item.url}: ${problems.join(' ')}`)
      continue
    }
    used.add(item.url)
    kept.push({
      url: item.url,
      title: item.title.slice(0, 300),
      date: item.publishedDate?.slice(0, 10) ?? null,
      kind: ownerLink ? 'owner_link' : c.kind,
      speaker: c.speaker?.trim() || null,
      speaker_title: c.speaker_title?.trim() || null,
      idea: c.idea.trim(),
      evidence: c.evidence.trim(),
      role_clause: c.role_clause.trim(),
      hook_sentence: c.hook_sentence.trim(),
      hook_short: short,
    })
  }
  kept.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])
  return { kept: kept.slice(0, 3), rejected }
}

async function ask(client: Anthropic, prompt: string) {
  const res = await client.messages.parse({
    model: RESEARCH_MODEL,
    max_tokens: 12000,
    system: SYSTEM,
    output_config: { effort: 'low', format: zodOutputFormat(ResearchOutput) },
    messages: [{ role: 'user', content: prompt }],
  })
  const cost = res.usage.input_tokens * PRICE.input + res.usage.output_tokens * PRICE.output
  if (!res.parsed_output) throw new Error(`research: no structured output (stop: ${res.stop_reason})`)
  return { out: res.parsed_output, cost }
}

/** Research one company (about $0.10): leaders, three or four content searches, one Claude call. */
export async function researchCompany(client: Anthropic, i: ResearchInput, now = new Date()): Promise<ResearchResult> {
  const since = new Date(now.getTime() - 365 * 864e5).toISOString()
  const hl = highlightQuery(i.roleTitle)
  let cost = 0
  const { leaders, cost: lc } = await findLeaders(i.company, i.knownLeaders)
  cost += lc
  const searches: Promise<{ items: SourceItem[]; cost: number }>[] = [
    contentSearch(`${i.company} go-to-market leader podcast or interview: CRO, VP Sales, Head of Growth or founder on how they sell`, since, hl, 6, 'GTM podcasts and interviews'),
    ...leaders.slice(0, 2).map((l) => contentSearch(`${l.name} ${i.company} podcast, interview, talk or post`, since, hl, 4, `${l.name}`)),
  ]
  const domain = domainOf(i.website)
  if (domain && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain) && !NOT_A_SOURCE.test(domain)) {
    searches.push(contentSearch(`${i.company} product launch, customer story or how we sell`, since, hl, 4, 'company site', { includeDomains: [domain] }))
  }
  const results = await Promise.all(searches)
  const items: SourceItem[] = []
  for (const r of results) {
    cost += r.cost
    items.push(...r.items)
  }
  const usable = usableSources(items, now).slice(0, 14)
  const { out, cost: cc } = await ask(client, userPrompt(i, leaders, usable))
  cost += cc
  const { kept, rejected } = toCandidates(out, usable, i.company)
  const fitErr = fitProblems(out.fit_items)
  return {
    hook_candidates: kept,
    fit_items: (fitErr.length ? [] : out.fit_items) as BankKey[],
    why_no_hook: kept.length ? null : (out.none_reason?.slice(0, 300) || (rejected.length ? `Every candidate failed the checks: ${rejected[0]}` : 'Nothing specific found in the last 12 months.')),
    candidates: usable.map((s) => ({ url: s.url, title: s.title, date: s.publishedDate?.slice(0, 10) ?? null, via: s.via })),
    rejected,
    leaders,
    model: RESEARCH_MODEL,
    cost_usd: cost,
    ...(fitErr.length ? { fitError: fitErr[0] } : {}),
  }
}

/** The owner's own link ("use this link"): read it and write a candidate from it (about $0.04). Undated links are fine. */
export async function researchUrl(client: Anthropic, i: ResearchInput, url: string): Promise<{ candidate: HookCandidate | null; problems: string[]; cost: number }> {
  const d = await exa('/contents', { urls: [url], text: { maxCharacters: 4000 }, highlights: { query: highlightQuery(i.roleTitle), numSentences: 3, highlightsPerUrl: 4 } })
  let cost = Number(d.costDollars?.total ?? 0)
  const item = (d.results ?? []).map((r) => toItem(r, 'your link'))[0]
  if (!item || item.text.length + item.highlights.join(' ').length < 200) return { candidate: null, problems: ['Could not read that page.'], cost }
  item.text = item.text.slice(0, 1800)
  const { out, cost: cc } = await ask(client, userPrompt(i, [], [item]))
  cost += cc
  const { kept, rejected } = toCandidates(out, [item], i.company, true)
  return { candidate: kept[0] ?? null, problems: kept.length ? [] : rejected.length ? rejected : [out.none_reason ?? 'No specific idea found on that page.'], cost }
}
