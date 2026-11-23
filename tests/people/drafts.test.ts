import { describe, expect, it } from 'vitest'
import { cleanDraft, draftProblems, firstName, hasMetric, INTERNAL_NAMES, proofFacts, similarity, systemPrompt, userPrompt, type DraftContext } from '@/lib/drafts/prompt'
import { generateDraft, type DraftClient } from '@/lib/drafts/generate'
import { chooseProof, partnerOf, type ProofInput } from '@/lib/drafts/proof'
import { PROFILE } from '@/lib/profile'

const ctx: DraftContext = {
  firstName: 'Steven',
  title: 'Senior Account Executive',
  branch: 'alumni',
  company: 'Crexi',
  roleTitle: 'GTM Automation Engineer',
  mentionRole: true,
  proof: { key: 'systems', why: 'test' },
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

const base: ProofInput = {
  company: 'Acme',
  category: 'gtm_eng',
  cryptoOrFintech: false,
  context: 'Software Development',
  roleTitle: 'GTM Engineer',
  branch: 'recruiting',
  siblingCount: 0,
}
const pick = (over: Partial<ProofInput>) => chooseProof({ ...base, ...over })

describe('proof point selection (owner rules 2026-11-23)', () => {
  it('partner companies outrank everything', () => {
    expect(pick({ company: 'Kalshi', category: 'growth_eng_product' })).toMatchObject({ key: 'partner_team', partner: 'Kalshi' })
    expect(pick({ company: 'Coinbase' })).toMatchObject({ key: 'partner_team', partner: 'Coinbase' })
    expect(pick({ company: 'Uniswap Labs' })).toMatchObject({ key: 'events', partner: 'Uniswap' })
    expect(pick({ company: 'Matter Labs' })).toMatchObject({ key: 'events', partner: 'ZKsync' })
    expect(partnerOf('Kalshi Inc.')?.name).toBe('Kalshi')
    expect(partnerOf('Coinbase Wallet Builders')?.name).toBe('Coinbase')
    expect(partnerOf('Deloittex')).toBeNull()
  })
  it('crypto → Coinbase; fintech and prediction markets → Kalshi', () => {
    expect(pick({ cryptoOrFintech: true, context: 'Building stablecoin payments on-chain' })?.key).toBe('coinbase')
    expect(pick({ cryptoOrFintech: true, context: 'Embedded banking for credit unions' })?.key).toBe('kalshi')
    expect(pick({ context: 'The leading prediction market exchange' })?.key).toBe('kalshi')
  })
  it('AI "tokens" in a posting do not make a company crypto', () => {
    expect(pick({ cryptoOrFintech: false, context: 'LLM tokens per second' })?.key).toBe('systems')
  })
  it('partnerships / BD and founding GTM roles → Kalshi', () => {
    expect(pick({ category: 'partnerships_bd', roleTitle: 'Partnerships Lead' })?.key).toBe('kalshi')
    expect(pick({ roleTitle: 'Founding GTM Engineer' })?.key).toBe('kalshi')
    expect(pick({ category: 'sales', roleTitle: 'Founding Account Executive' })?.key).toBe('kalshi')
  })
  it('GTM Eng elsewhere: systems first, Coinbase only to vary a second note', () => {
    expect(pick({})?.key).toBe('systems')
    expect(pick({ siblingCount: 1 })?.key).toBe('coinbase')
    expect(pick({ siblingCount: 2 })?.key).toBe('systems')
  })
  it('Blockchain @ UCLA alumni: club opener, systems when it fits', () => {
    expect(pick({ branch: 'blockchain_ucla', roleTitle: 'Founding GTM Engineer' })?.key).toBe('systems')
  })
  it('poor fit when nothing matches (ElevenLabs product growth role)', () => {
    expect(pick({ company: 'ElevenLabs', category: 'growth_eng_product', roleTitle: 'Website Growth Engineer' })).toBeNull()
    expect(pick({ category: 'engineering' })).toBeNull()
    expect(pick({ category: 'marketing' })).toBeNull()
  })
})

describe('SDR proof points (owner, 2026-11-23)', () => {
  const sdr = (over: Partial<ProofInput>) => pick({ category: 'sales', roleTitle: 'Sales Development Representative', ...over })
  it('own prospecting by default; Kalshi then Coinbase to vary later notes', () => {
    expect(sdr({})?.key).toBe('sdr')
    expect(sdr({ siblingCount: 1 })?.key).toBe('kalshi')
    expect(sdr({ siblingCount: 2 })?.key).toBe('sdr')
    expect(sdr({ siblingCount: 3 })?.key).toBe('coinbase')
  })
  it('crypto → Coinbase, fintech → Kalshi; partners still outrank', () => {
    expect(sdr({ cryptoOrFintech: true, context: 'web3 wallet' })?.key).toBe('coinbase')
    expect(sdr({ cryptoOrFintech: true, context: 'payments for SMBs' })?.key).toBe('kalshi')
    expect(sdr({ company: 'Coinbase' })?.key).toBe('partner_team')
  })
  it('the SDR fact is in the owner\'s words and has no numbers', () => {
    expect(PROFILE.proof.sdr.facts[0]).toBe('I do my own prospecting, write the copy and handle replies for two startups I co-founded.')
    for (const f of Object.values(PROFILE.proof).flatMap((p) => p.facts)) expect(hasMetric(f)).toBe(false)
  })
})

describe('no numbers of any kind', () => {
  it('rejects counts, money, rates and pipeline anywhere', () => {
    for (const bad of ['booked 40 meetings', 'set fifty demos', '$2M in pipeline', 'a 35% reply rate', 'reply rates doubled', '3x pipeline', 'pipeline of $500k', 'hundreds of leads', '12 events']) {
      expect(hasMetric(bad)).toBe(true)
    }
    for (const ok of ['two startups I co-founded', 'graduating March 2027', 'outbound lead pipelines', 'ran events with a16z and Uniswap']) {
      expect(hasMetric(ok)).toBe(false)
    }
    expect(draftProblems('Hi Sam, I booked 40 meetings last quarter.', ctx).join()).toMatch(/number/)
  })
})

describe('fact blocks (one per note, owner wording)', () => {
  it('systems prompt has no club facts; club prompts have exactly one club fact and the club rules', () => {
    const sys = systemPrompt({ key: 'systems', why: '' }, 250)
    for (const f of PROFILE.proof.systems.facts) expect(sys).toContain(f)
    expect(sys).not.toMatch(/Kalshi|Coinbase|Uniswap/)
    const k = systemPrompt({ key: 'kalshi', why: '' }, 250)
    expect(k).toContain('Sourced and closed a campus partnership with Kalshi, negotiating scope and terms directly with their head of growth in New York.')
    expect(k).not.toMatch(/Coinbase|Built and shipped/)
    expect(k).toMatch(/Never call partners clients or customers/)
    expect(k).toMatch(/There are no counts on record/)
    expect(sys).toContain('At most 250 characters')
  })
  it('writing to Kalshi / Coinbase: "worked with your team on a campus partnership" and stop', () => {
    const f = proofFacts({ key: 'partner_team', partner: 'Coinbase', why: '' })
    expect(f.short).toBe('worked with your team on a campus partnership')
    expect(systemPrompt({ key: 'partner_team', partner: 'Coinbase', why: '' }, 250)).toMatch(/stop there/)
  })
  it('event partner names only that partner', () => {
    expect(proofFacts({ key: 'events', partner: 'Deloitte', why: '' }).facts[0]).toBe('Hosted events with Deloitte at Blockchain @ UCLA.')
  })
  it('the club title is not offered as a fact', () => {
    expect(systemPrompt({ key: 'kalshi', why: '' }, 250)).not.toMatch(/Head of Growth and Partnerships/)
  })
  it('no internal names anywhere in the profile', () => {
    expect(INTERNAL_NAMES.test(JSON.stringify(PROFILE))).toBe(false)
  })
})

describe('club claims checked in code', () => {
  const kalshi = { ...ctx, proof: { key: 'kalshi' as const, why: '' } }
  it('counts, dollars, clients, revenue, valuations, title, working at a partner', () => {
    expect(draftProblems('I ran 12 events with Kalshi.', kalshi).join()).toMatch(/count/)
    expect(draftProblems('Closed a $5k Kalshi deal.', kalshi).join()).toMatch(/dollar amount/)
    expect(draftProblems('Kalshi was a club client.', kalshi).join()).toMatch(/not clients/)
    expect(draftProblems('The Kalshi deal brought revenue.', kalshi).join()).toMatch(/revenue/)
    expect(draftProblems("I'm Head of Growth at Blockchain @ UCLA and closed Kalshi.", kalshi).join()).toMatch(/not Conrad's title/)
    expect(draftProblems('I worked at Kalshi on growth.', kalshi).join()).toMatch(/worked at a partner/)
    expect(draftProblems('Closed our Kalshi partnership with their head of growth.', kalshi)).toEqual([])
  })
  it('a second proof point is caught', () => {
    expect(draftProblems("Closed our Kalshi partnership and cold-emailed Coinbase's recruiters.", kalshi).join()).toMatch(/second proof point/)
    expect(draftProblems('I built a GTM platform solo; also closed Kalshi.', ctx).join()).toMatch(/second proof point/)
    expect(draftProblems("Hi Sam, I sourced and closed Blockchain @ UCLA's partnership with Kalshi. Am I in scope?", kalshi)).toEqual([])
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
