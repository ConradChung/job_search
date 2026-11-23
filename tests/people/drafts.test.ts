import { describe, expect, it } from 'vitest'
import { cleanDraft, draftProblems, firstName, INTERNAL_NAMES, similarity, systemPrompt, userPrompt, type DraftContext } from '@/lib/drafts/prompt'
import { generateDraft, type DraftClient } from '@/lib/drafts/generate'
import { chooseProof } from '@/lib/drafts/proof'
import { PROFILE } from '@/lib/profile'

const ctx: DraftContext = {
  firstName: 'Steven',
  title: 'Senior Account Executive',
  branch: 'alumni',
  company: 'Crexi',
  roleTitle: 'GTM Automation Engineer',
  mentionRole: true,
  proof: 'systems',
  siblings: [],
  limit: PROFILE.noteLimit,
}

function fakeClient(replies: { text: string; stop?: string }[]) {
  const calls: { system: string; messages: unknown[] }[] = []
  const client = {
    beta: {
      messages: {
        create: async (params: { system: string; messages: unknown[] }) => {
          calls.push({ ...params, messages: [...params.messages] })
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

describe('proof point selection (one per note)', () => {
  it('club leads for crypto / fintech and partnerships roles', () => {
    expect(chooseProof('gtm_eng', true)).toBe('club')
    expect(chooseProof('partnerships_bd', false)).toBe('club')
  })
  it('systems for GTM Eng, RevOps and sales; club only when systems does not fit', () => {
    expect(chooseProof('gtm_eng', false)).toBe('systems')
    expect(chooseProof('revops', false)).toBe('systems')
    expect(chooseProof('marketing', false)).toBe('club')
  })
  it('poor fit when nothing matches (ElevenLabs product growth role)', () => {
    expect(chooseProof('growth_eng_product', false)).toBeNull()
    expect(chooseProof('engineering', false)).toBeNull()
  })
  it('the system prompt carries only the chosen proof point', () => {
    const sys = systemPrompt('systems', 250)
    for (const f of PROFILE.proof.systems.facts) expect(sys).toContain(f)
    for (const f of PROFILE.proof.club.facts) expect(sys).not.toContain(f)
    expect(systemPrompt('club', 250)).toContain('Blockchain @ UCLA')
    expect(sys).toContain('At most 250 characters')
  })
  it('no internal names anywhere in the profile', () => {
    const all = JSON.stringify(PROFILE)
    expect(INTERNAL_NAMES.test(all)).toBe(false)
  })
})

describe('angles', () => {
  it('alumni: question about their team; role named only in their function', () => {
    expect(userPrompt({ ...ctx, mentionRole: false })).toMatch(/Do not name the open role/)
    expect(userPrompt(ctx)).toMatch(/You may mention the GTM Automation Engineer role/)
  })
  it('Blockchain @ UCLA opens with the club, not "fellow Bruin"', () => {
    expect(userPrompt({ ...ctx, branch: 'blockchain_ucla' })).toMatch(/Open with that shared club \(not "fellow Bruin"\)/)
  })
  it('recruiters: name the role, ask if in scope', () => {
    expect(userPrompt({ ...ctx, branch: 'recruiting' })).toMatch(/whether Conrad is in scope/)
  })
  it('siblings are passed so the note differs', () => {
    expect(userPrompt({ ...ctx, siblings: ['Hi Ana, fellow Bruin here.'] })).toMatch(/must differ from each/)
  })
})

describe('code-checked rules', () => {
  it('flags length, internal names, double asks and sibling overlap', () => {
    expect(draftProblems('x'.repeat(260), ctx)[0]).toMatch(/limit is 250/)
    expect(draftProblems('I built Lume, my outbound tool.', ctx)[0]).toMatch(/internal project name/)
    expect(draftProblems('Open to a quick chat? Or know who to ask?', ctx)[0]).toMatch(/more than one question/)
    const a = 'Hi Gabe, fellow Bruin here. I build GTM systems end to end, including my own outbound command center. Would you be up for a quick chat?'
    const b = 'Hi Bhargavi, fellow Bruin here. I build GTM systems end to end, including my own outbound command center. Would you be open to a chat?'
    expect(similarity(a, b)).toBeGreaterThan(0.35)
    expect(draftProblems(b, { ...ctx, siblings: [a] })[0]).toMatch(/too close/)
    expect(draftProblems('Hi Sam, quick question about your team?', ctx)).toEqual([])
  })
  it('firstName and cleanDraft', () => {
    expect(firstName('Jennifer (Halabi) Cole')).toBe('Jennifer')
    expect(firstName('Howard N. Yu, MBA')).toBe('Howard')
    expect(cleanDraft('  "Hi Sam, quick note."  ')).toBe('Hi Sam, quick note.')
  })
})

describe('generateDraft', () => {
  it('returns a clean note with low effort and fallback on', async () => {
    const { client, calls } = fakeClient([{ text: 'Hi Steven, quick question about your team?' }])
    const r = await generateDraft(client, ctx)
    expect(r.text).toBe('Hi Steven, quick question about your team?')
    expect(r.problems).toEqual([])
    expect(calls).toHaveLength(1)
  })
  it('retries with the specific problem, up to three attempts', async () => {
    const { client, calls } = fakeClient([{ text: 'I built Lume. Chat? Or intro?' }, { text: 'x'.repeat(300) }, { text: 'Hi Steven, how does your team handle lead routing?' }])
    const r = await generateDraft(client, ctx)
    expect(calls).toHaveLength(3)
    expect(r.problems).toEqual([])
    expect(JSON.stringify(calls[1].messages)).toMatch(/internal project name/)
  })
  it('reports problems left after the retries', async () => {
    const { client } = fakeClient([{ text: 'y'.repeat(300) }])
    expect((await generateDraft(client, ctx)).problems[0]).toMatch(/limit/)
  })
  it('throws on refusal', async () => {
    const { client } = fakeClient([{ text: '', stop: 'refusal' }])
    await expect(generateDraft(client, ctx)).rejects.toThrow(/refused/)
  })
})
