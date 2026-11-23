import Anthropic from '@anthropic-ai/sdk'
import { cleanDraft, draftProblems, followupProblems, leaderFollowup, recruiterFollowup, followupSystemPrompt, followupUserPrompt, systemPrompt, userPrompt, type DraftContext } from './prompt'

export const DRAFT_MODEL = 'claude-opus-5-5'
const PRICE = { input: 4 / 1e6, output: 20 / 1e6, cacheRead: 0.2 / 1e6, cacheWrite: 5 / 1e6 }
const MAX_ATTEMPTS = 3

export interface DraftResult {
  text: string
  model: string
  cost: number
  /** Rule problems still present after the retries (empty = clean). */
  problems: string[]
}

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

function costOf(u: Usage): number {
  return (
    u.input_tokens * PRICE.input +
    u.output_tokens * PRICE.output +
    (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
    (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite
  )
}

/** The slice of the SDK this module calls; tests pass a fake. */
export interface DraftClient {
  beta: { messages: { create: Anthropic['beta']['messages']['create'] } }
}

/**
 * One connection note. Opus 5.5 at low effort with the server-side refusal
 * fallback on. Rules the prompt can't guarantee (length, internal names, one
 * question, sibling overlap) are checked in code; on a violation the model is
 * told what's wrong and asked again, up to MAX_ATTEMPTS.
 */
export async function generateDraft(client: DraftClient, ctx: DraftContext): Promise<DraftResult> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: userPrompt(ctx) }]
  let cost = 0
  let model = DRAFT_MODEL
  let text = ''
  let problems: string[] = []

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await client.beta.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: systemPrompt(ctx.proof, ctx.limit, ctx.allowTools, undefined, ctx.branch),
      messages,
    })
    cost += costOf(response.usage as Usage)
    model = response.model
    if (response.stop_reason === 'refusal') {
      throw new Error(`draft refused (${response.stop_details?.category ?? 'no category'})`)
    }
    text = cleanDraft(
      response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
    )
    if (!text) throw new Error('empty draft')
    problems = draftProblems(text, ctx)
    if (!problems.length) break
    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: `Rewrite it. ${problems.join(' ')}` })
  }

  return { text, model, cost, problems }
}

/** The after-accept message for a note, with the same check-and-retry loop. */
export async function generateFollowup(client: DraftClient, ctx: DraftContext, note: string): Promise<DraftResult> {
  // Founders and sales leaders at SDR companies: fixed two-sentence message, no model call.
  if (ctx.sdrLeader) {
    const text = leaderFollowup(ctx)
    return { text, model: 'template', cost: 0, problems: followupProblems(text, ctx) }
  }
  // Recruiters: fixed template too (owner, 2026-11-24).
  if (ctx.branch === 'recruiting') {
    const text = recruiterFollowup(ctx, note, /^([\w -]+ )?[SB]DR$/.test(ctx.roleTitle ?? ''))
    return { text, model: 'template', cost: 0, problems: followupProblems(text, ctx) }
  }
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: followupUserPrompt(ctx, note) }]
  let cost = 0
  let model = DRAFT_MODEL
  let text = ''
  let problems: string[] = []
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await client.beta.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: followupSystemPrompt(ctx.proof, ctx.allowTools),
      messages,
    })
    cost += costOf(response.usage as Usage)
    model = response.model
    if (response.stop_reason === 'refusal') throw new Error(`follow-up refused (${response.stop_details?.category ?? 'no category'})`)
    text = cleanDraft(response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join(''))
    if (!text) throw new Error('empty follow-up')
    problems = followupProblems(text, ctx)
    if (!problems.length) break
    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: `Rewrite it. ${problems.join(' ')}` })
  }
  return { text, model, cost, problems }
}
