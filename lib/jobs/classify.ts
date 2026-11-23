import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { CATEGORY_KEYS, type Category, type Confidence } from './categories'

export const CLASSIFY_MODEL = 'claude-opus-5-5'
const PRICE = { input: 4 / 1e6, output: 20 / 1e6 }
/** Descriptions over this are cut at the end (benefits / legal boilerplate) and the cut is recorded. */
export const MAX_DESCRIPTION_CHARS = 16000
/** Below this, the posting text is too thin to classify from; treated as title-only. */
const MIN_DESCRIPTION_CHARS = 400

export const ClassificationSchema = z.object({
  category: z.enum(CATEGORY_KEYS as [Category, ...Category[]]),
  department: z.string(),
  seniority: z.enum(['intern', 'entry', 'mid', 'senior', 'director_plus', 'unknown']),
  work_mode: z.enum(['remote', 'hybrid', 'onsite', 'unknown']),
  work_locations: z.array(z.string()),
  start_requirement: z.enum(['immediate', 'flexible', 'specific_date', 'unknown']),
  start_date: z.string().nullable(),
  crypto_or_fintech: z.boolean(),
  confident: z.boolean(),
  reason: z.string(),
})
export type Classification = z.infer<typeof ClassificationSchema>

export const CLASSIFY_SYSTEM = `You classify job postings for a candidate targeting GTM engineering roles. Judge by the actual work in the posting (department, responsibilities, requirements), not by keywords in the title.

Categories:
- gtm_eng: the work is about revenue systems: outbound, sales tooling, RevOps automation, CRM, enrichment, lead pipelines, GTM data and workflows for sales/marketing teams. Titles vary ("GTM Engineer", "Growth Engineer", "Sales Engineer - Systems", "GTM Systems"), but only the revenue-systems work counts.
- growth_eng_product: growth roles about the product or website: conversion rate optimisation, SEO, programmatic pages, onboarding, activation, web performance, A/B testing, product analytics, growth marketing engineering. This is NOT gtm_eng even when the title says "Growth Engineer".
- sales: quota-carrying or pipeline roles: AE, SDR / BDR, account management, sales engineering / solutions engineering focused on deals.
- revops: revenue / sales / marketing operations roles that run the systems but are not engineering-heavy.
- partnerships_bd: business development, partnerships, alliances, channel.
- marketing: non-engineering marketing (demand gen, content, brand, lifecycle, growth marketing managers).
- engineering: software / product / data engineering outside growth.
- other: anything else.

Seniority: intern; entry (new grad, junior, associate, 0-2 years); mid (2-5 years, "mid-level"); senior (senior, staff, lead, 5+ years); director_plus (head of, director, VP, C-level); unknown. "Founding" alone says nothing; use the stated experience.

Work mode and locations: as stated in the posting (city / region names). Start: "immediate" only if the posting asks for an immediate or ASAP start; "specific_date" with start_date (YYYY-MM-DD) if it names one; "flexible" if it says so; else "unknown".

crypto_or_fintech: true if the company is in crypto, blockchain, web3, payments, banking or other financial technology.

confident: false if the posting is ambiguous or too thin to be sure. reason: one short sentence citing the work that decided the category.`

export interface ClassifyInput {
  title: string | null
  company: string
  industries: string | null
  location: string | null
  sheetSeniority: string | null
  department: string | null
  description: string | null
}

export function classifyPrompt(j: ClassifyInput): { text: string; titleOnly: boolean; truncated: boolean } {
  const desc = (j.description ?? '').trim()
  const titleOnly = desc.length < MIN_DESCRIPTION_CHARS
  const truncated = desc.length > MAX_DESCRIPTION_CHARS
  const lines = [
    `Company: ${j.company}${j.industries ? ` (${j.industries})` : ''}`,
    `Title: ${j.title ?? 'unknown'}`,
    j.department ? `Department (from the job board): ${j.department}` : null,
    j.location ? `Listed location: ${j.location}` : null,
    j.sheetSeniority ? `Listed seniority: ${j.sheetSeniority}` : null,
    titleOnly
      ? 'Posting text: not available. Classify from the title and company only, and set confident to false.'
      : `Posting text${truncated ? ` (first ${MAX_DESCRIPTION_CHARS} characters)` : ''}:\n${desc.slice(0, MAX_DESCRIPTION_CHARS)}`,
  ]
  return { text: lines.filter(Boolean).join('\n'), titleOnly, truncated }
}

/** high: real posting + confident model; medium: real posting, ambiguous; low: title only. */
export function confidenceOf(titleOnly: boolean, confident: boolean): Confidence {
  if (titleOnly) return 'low'
  return confident ? 'high' : 'medium'
}

export interface ClassifyClient {
  beta: { messages: { parse: Anthropic['beta']['messages']['parse'] } }
}

export interface ClassifyResult {
  classification: Classification
  confidence: Confidence
  titleOnly: boolean
  truncated: boolean
  cost: number
  model: string
}

export async function classifyJob(client: ClassifyClient, j: ClassifyInput): Promise<ClassifyResult> {
  const { text, titleOnly, truncated } = classifyPrompt(j)
  const response = await client.beta.messages.parse({
    model: CLASSIFY_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(ClassificationSchema) },
    system: CLASSIFY_SYSTEM,
    messages: [{ role: 'user', content: text }],
  })
  if (response.stop_reason === 'refusal') throw new Error(`classification refused (${response.stop_details?.category ?? 'no category'})`)
  const parsed = response.parsed_output
  if (!parsed) throw new Error(`classification did not parse (stop: ${response.stop_reason})`)
  const u = response.usage
  return {
    classification: parsed,
    confidence: confidenceOf(titleOnly, parsed.confident),
    titleOnly,
    truncated,
    cost: u.input_tokens * PRICE.input + u.output_tokens * PRICE.output,
    model: response.model,
  }
}

/** Row update for the jobs table. */
export function classificationRow(r: ClassifyResult) {
  const c = r.classification
  return {
    category: c.category,
    category_confidence: r.confidence,
    department: c.department || null,
    seniority: c.seniority,
    work_mode: c.work_mode,
    work_locations: c.work_locations,
    start_requirement: c.start_requirement,
    start_date: c.start_date && /^\d{4}-\d{2}-\d{2}$/.test(c.start_date) ? c.start_date : null,
    crypto_or_fintech: c.crypto_or_fintech,
    classification: { reason: c.reason, model: r.model, title_only: r.titleOnly, truncated: r.truncated, cost: r.cost },
    classified_at: new Date().toISOString(),
  }
}
