import { describe, expect, it } from 'vitest'
import { cleanDraft, firstName, SYSTEM_PROMPT, userPrompt, type DraftContext } from '@/lib/drafts/prompt'
import { generateDraft, type DraftClient } from '@/lib/drafts/generate'
import { PROFILE } from '@/lib/drafts/profile'

const ctx: DraftContext = {
  firstName: 'Steven',
  title: 'Senior Account Executive',
  branch: 'alumni',
  isUcla: true,
  company: 'Crexi',
  sizeBand: 'large',
  roleTitle: 'GTM Automation Engineer',
}

function fakeClient(replies: { text: string; stop?: string }[]) {
  const calls: unknown[] = []
  const client = {
    beta: {
      messages: {
        create: async (params: unknown) => {
          calls.push(params)
          const r = replies[Math.min(calls.length - 1, replies.length - 1)]
          return {
            model: 'claude-opus-5-5',
            stop_reason: r.stop ?? 'end_turn',
            stop_details: r.stop === 'refusal' ? { category: 'test' } : null,
            content: [{ type: 'text', text: r.text }],
            usage: { input_tokens: 500, output_tokens: 100 },
          }
        },
      },
    },
  } as unknown as DraftClient
  return { client, calls }
}

describe('draft prompt', () => {
  it('system prompt carries every profile fact and the no-invention rule', () => {
    for (const f of PROFILE.facts) expect(SYSTEM_PROMPT).toContain(f)
    expect(SYSTEM_PROMPT).toMatch(/Never invent anything/)
    expect(SYSTEM_PROMPT).toMatch(/Never say whether Conrad is a student, a graduate/)
  })
  it('user prompt names the person, role, company and branch angle', () => {
    const u = userPrompt(ctx)
    expect(u).toContain('Steven, Senior Account Executive at Crexi')
    expect(u).toContain('GTM Automation Engineer at Crexi')
    expect(u).toMatch(/UCLA/)
  })
  it('mentions UCLA for a non-alumni branch only when they went there', () => {
    expect(userPrompt({ ...ctx, branch: 'recruiting', isUcla: false })).not.toMatch(/UCLA/)
    expect(userPrompt({ ...ctx, branch: 'recruiting', isUcla: true })).toMatch(/also went to UCLA/)
  })
  it('firstName and cleanDraft', () => {
    expect(firstName('Jennifer (Halabi) Cole')).toBe('Jennifer')
    expect(firstName('Howard N. Yu, MBA')).toBe('Howard')
    expect(cleanDraft('  "Hi Sam, quick note."  ')).toBe('Hi Sam, quick note.')
  })
})

describe('generateDraft', () => {
  it('returns the note with cost, low effort, fallback on', async () => {
    const { client, calls } = fakeClient([{ text: 'Hi Steven, fellow Bruin here.' }])
    const r = await generateDraft(client, ctx)
    expect(r.text).toBe('Hi Steven, fellow Bruin here.')
    expect(r.tooLong).toBe(false)
    expect(r.cost).toBeCloseTo(500 * 4e-6 + 100 * 20e-6)
    const p = calls[0] as { model: string; fallbacks: string; output_config: { effort: string } }
    expect(p.model).toBe('claude-opus-5-5')
    expect(p.fallbacks).toBe('default')
    expect(p.output_config.effort).toBe('low')
  })
  it('asks once for a shorter version when over 300 characters', async () => {
    const { client, calls } = fakeClient([{ text: 'x'.repeat(320) }, { text: 'Short now.' }])
    const r = await generateDraft(client, ctx)
    expect(calls).toHaveLength(2)
    expect(r.text).toBe('Short now.')
  })
  it('flags a note still too long after the retry', async () => {
    const { client } = fakeClient([{ text: 'y'.repeat(320) }])
    expect((await generateDraft(client, ctx)).tooLong).toBe(true)
  })
  it('throws on refusal', async () => {
    const { client } = fakeClient([{ text: '', stop: 'refusal' }])
    await expect(generateDraft(client, ctx)).rejects.toThrow(/refused/)
  })
})
