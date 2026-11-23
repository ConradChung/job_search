import Anthropic from '@anthropic-ai/sdk'
import { cleanDraft, MAX_CHARS, SYSTEM_PROMPT, TARGET_CHARS, userPrompt, type DraftContext } from './prompt'

export const DRAFT_MODEL = 'claude-opus-5-5'
const PRICE = { input: 4 / 1e6, output: 20 / 1e6, cacheRead: 0.2 / 1e6, cacheWrite: 5 / 1e6 }

export interface DraftResult {
  text: string
  model: string
  cost: number
  tooLong: boolean
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
 * One connection note. Opus 5.5 at low effort (a short, simple task), with
 * the server-side refusal fallback on. If the note runs over the LinkedIn
 * limit, ask once for a shorter version in the same conversation.
 */
export async function generateDraft(client: DraftClient, ctx: DraftContext): Promise<DraftResult> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: userPrompt(ctx) }]
  let cost = 0
  let model = DRAFT_MODEL
  let text = ''

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.beta.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
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
    if (text.length <= MAX_CHARS) break
    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: `That is ${text.length} characters. Rewrite it under ${TARGET_CHARS} characters, same facts.` })
  }

  return { text, model, cost, tooLong: text.length > MAX_CHARS }
}
