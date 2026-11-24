/**
 * Experience bank (owner, 2026-11-23). The fit line picks three of these and
 * nothing outside them. `email` is the owner's wording; `linkedin` is a shorter
 * form of the same item for the LinkedIn message.
 */
export const EXPERIENCE_BANK = {
  outbound: {
    email: 'building outbound systems end to end (signals, enrichment, scoring, routing, sequencing)',
    linkedin: 'building outbound systems end to end',
    hint: 'outbound, pipeline generation, signals, lead scoring, routing, sequencing, GTM systems, automation',
  },
  enrichment: {
    email: 'data enrichment pipelines in Clay, Apify and Exa',
    linkedin: 'data enrichment in Clay, Apify and Exa',
    hint: 'Clay, enrichment, data quality, scraping, lead lists, intent data, ICP data',
  },
  agentic: {
    email: 'agentic workflows with Claude Code and MCP',
    linkedin: 'agentic workflows with Claude Code and MCP',
    hint: 'AI agents, LLMs, AI tooling, automation with AI, workflow automation, prompt engineering',
  },
  code: {
    email: 'Python, SQL and TypeScript',
    linkedin: 'Python, SQL and TypeScript',
    hint: 'coding, scripting, APIs, integrations, SQL, Python, JavaScript/TypeScript, technical skills',
  },
  partnerships: {
    email: 'sourcing and closing partnerships (Kalshi, for Blockchain @ UCLA)',
    linkedin: 'sourcing and closing partnerships like Kalshi',
    hint: 'partnerships, closing, negotiation, business development, deal making',
  },
  outreach: {
    email: 'cold outreach that converts (Coinbase recruiting initiatives)',
    linkedin: 'cold outreach that converts',
    hint: 'prospecting, cold calling, cold email, booking meetings, SDR/BDR work, outreach',
  },
  analytics: {
    email: 'financial modelling and revenue analytics (Noble Mobile)',
    linkedin: 'revenue analytics and financial modelling',
    hint: 'revenue operations, forecasting, reporting, dashboards, analytics, financial modelling, RevOps',
  },
} as const

export type BankKey = keyof typeof EXPERIENCE_BANK
export const BANK_KEYS = Object.keys(EXPERIENCE_BANK) as BankKey[]

export function isBankKey(k: unknown): k is BankKey {
  return typeof k === 'string' && k in EXPERIENCE_BANK
}

/** "a, b and c"; with an Oxford comma when an item itself holds a comma or "and", so the list still parses. */
export function joinItems(items: string[]): string {
  if (items.length < 2) return items.join('')
  const head = items.slice(0, -1)
  const tricky = items.some((i) => /,| and /.test(i))
  return `${head.join(', ')}${tricky ? ',' : ''} and ${items[items.length - 1]}`
}

export function fitPhrase(keys: string[], channel: 'email' | 'linkedin'): string | null {
  const ok = keys.filter(isBankKey)
  if (ok.length !== 3 || new Set(ok).size !== 3) return null
  return joinItems(ok.map((k) => EXPERIENCE_BANK[k][channel]))
}

/**
 * Facts that bound what any message may claim (owner, 2026-11-23). Not selectable
 * as a fit item; the writer must respect them.
 */
export const BANK_FACTS = ['Most of my outbound to date has been email and LinkedIn; I have not done cold calling.'] as const

/** Names a message may use about Conrad's own experience: the bank's, nothing else. */
export const BANK_NAMES = ['Kalshi', 'Blockchain', 'UCLA', 'Coinbase', 'Noble', 'Mobile', 'Clay', 'Apify', 'Exa', 'Claude', 'Code', 'MCP', 'Python', 'SQL', 'TypeScript', 'LinkedIn', 'GTM', 'AI']

/** Every allowed fact, for the writer's prompt. */
export function bankFactsText(): string {
  return [...BANK_KEYS.map((k) => `- ${k}: ${EXPERIENCE_BANK[k].email}`), ...BANK_FACTS.map((f) => `- fact: ${f}`)].join('\n')
}
