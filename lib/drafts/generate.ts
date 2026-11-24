import Anthropic from '@anthropic-ai/sdk'
import { cleanDraft, draftProblems, systemPrompt, userPrompt, type DraftContext } from './prompt'
import { afterAcceptMessage, afterAcceptProblems } from './afterAccept'

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

/**
 * The after-accept message (owner, 2026-11-23): fixed templates by persona
 * (lib/drafts/afterAccept.ts), no model call. `client` is kept for the call sites.
 */
export async function generateFollowup(client: DraftClient, ctx: DraftContext, note: string): Promise<DraftResult> {
  void client
  const r = afterAcceptMessage({ firstName: ctx.firstName, branch: ctx.branch, title: ctx.title, company: ctx.company, roleTitle: ctx.roleTitle, note })
  return { text: r.text, model: 'template', cost: 0, problems: afterAcceptProblems(r.text, note, ctx.company) }
}
