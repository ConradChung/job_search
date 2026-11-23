import { describe, expect, it } from 'vitest'
import { cleanDraft, draftProblems, firstName, hasMetric, INTERNAL_NAMES, proofFacts, similarity, systemPrompt, userPrompt, type DraftContext } from '@/lib/drafts/prompt'
import { generateDraft, type DraftClient } from '@/lib/drafts/generate'
import { chooseProof, partnerOf, type ProofInput } from '@/lib/drafts/proof'
import { draftTargetIds } from '@/lib/drafts/targets'
import { followupProblems, recruiterClose, SCOPE_QUESTION } from '@/lib/drafts/prompt'
import { PROFILE } from '@/lib/profile'

const ctx: DraftContext = {
  firstName: 'Steven',
  title: 'Senior Account Executive',
  branch: 'alumni',
  company: 'Crexi',
  roleTitle: 'GTM Automation Engineer',
  mentionRole: true,
  proof: { key: 'systems', why: 'test' },
  allowTools: true,
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

describe('proof point selection (owner rules, latest)', () => {
  const alum = (over: Partial<ProofInput>) => pick({ branch: 'alumni', ...over })
  const rec = (over: Partial<ProofInput>) => pick({ branch: 'recruiting', ...over })
  it('partner companies outrank everything', () => {
    expect(rec({ company: 'Kalshi', category: 'growth_eng_product' })).toMatchObject({ key: 'partner_team', partner: 'Kalshi' })
    expect(alum({ company: 'Uniswap Labs' })).toMatchObject({ key: 'events', partner: 'Uniswap' })
    expect(partnerOf('Matter Labs')?.name).toBe('ZKsync')
    expect(partnerOf('Deloittex')).toBeNull()
  })
  it('recruiters: GTM Eng → systems always; crypto / fintech → Kalshi; SDR → prospecting; never Coinbase', () => {
    expect(rec({})?.key).toBe('systems')
    expect(rec({ siblingCount: 1 })?.key).toBe('systems')
    expect(rec({ cryptoOrFintech: true, context: 'stablecoin rails on-chain' })?.key).toBe('kalshi')
    expect(rec({ cryptoOrFintech: true, context: 'banking for SMBs' })?.key).toBe('kalshi')
    expect(rec({ category: 'sales', roleTitle: 'SDR' })?.key).toBe('sdr')
    for (const ctxv of ['web3', 'banking', '']) expect(rec({ cryptoOrFintech: !!ctxv, context: ctxv })?.key).not.toBe('coinbase')
  })
  it('alumni: crypto → Coinbase, fintech → Kalshi; otherwise the systems line the recruiter did not get', () => {
    expect(alum({ cryptoOrFintech: true, context: 'web3 wallet' })?.key).toBe('coinbase')
    expect(alum({ cryptoOrFintech: true, context: 'payments' })?.key).toBe('kalshi')
    expect(alum({})).toMatchObject({ key: 'systems', variant: 'pipelines' })
    expect(rec({})).toMatchObject({ key: 'systems', variant: 'platform' })
    expect(alum({ siblingTexts: ['…I build outbound lead pipelines for two startups…'] })).toMatchObject({ variant: 'platform' })
    expect(rec({ siblingTexts: ['…built and shipped a full-stack GTM platform solo…'] })).toMatchObject({ variant: 'pipelines' })
    expect(alum({ roleTitle: 'Founding GTM Engineer' })?.key).toBe('systems')
    expect(alum({ cryptoOrFintech: false, context: 'LLM tokens per second' })?.key).toBe('systems')
  })
  it('Blockchain @ UCLA alumni get the club lines', () => {
    expect(pick({ branch: 'blockchain_ucla' })?.key).toBe('kalshi')
    expect(pick({ branch: 'blockchain_ucla', cryptoOrFintech: true, context: 'defi' })?.key).toBe('coinbase')
  })
  it('poor fit when nothing matches (ElevenLabs product growth role)', () => {
    expect(alum({ company: 'ElevenLabs', category: 'growth_eng_product', roleTitle: 'Website Growth Engineer' })).toBeNull()
    expect(rec({ category: 'engineering' })).toBeNull()
    expect(alum({ category: 'marketing' })).toBeNull()
  })
  it('the SDR fact is in the owner\'s words and has no numbers', () => {
    expect(PROFILE.proof.sdr.facts[0]).toBe('I do my own prospecting, write the copy and handle replies for two startups I co-founded.')
    for (const f of Object.values(PROFILE.proof).flatMap((p) => p.facts)) expect(hasMetric(f)).toBe(false)
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
    expect(userPrompt({ ...ctx, branch: 'recruiting' })).toMatch(/Interested in the GTM Automation Engineer role at Crexi\. Open to connecting\?/)
  })
  it('siblings are passed so the note differs', () => {
    expect(userPrompt({ ...ctx, siblings: ['Hi Ana, fellow Bruin here.'] })).toMatch(/must differ from each/)
  })
})

describe('code-checked rules', () => {
  it('flags length, internal names, double asks and sibling overlap', () => {
    expect(draftProblems('x'.repeat(210), ctx)[0]).toMatch(/limit is 200/)
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

describe('note rules (owner, 2026-11-23 review)', () => {
  const rec = { ...ctx, branch: 'recruiting' as const, title: 'Talent Acquisition', allowTools: false, company: 'Crexi', roleTitle: 'GTM Automation Engineer' }
  it('graduation line is fixed', () => {
    expect(draftProblems('Hi Sam, at UCLA through March 2027.', ctx).join()).toMatch(/graduating March 2027/)
    expect(draftProblems('Hi Sam, class of March 2027.', ctx).join()).toMatch(/graduating March 2027/)
    expect(draftProblems('Hi Sam, fellow Bruin here, graduating March 2027. How is your team set up?', ctx)).toEqual([])
  })
  it('recruiter note shape: grad line, one proof, role line, "Open to connecting?"', () => {
    expect(recruiterClose(rec)).toBe('Interested in the GTM Automation Engineer role at Crexi. Open to connecting?')
    const good = "Hi Daniella, I'm Conrad at UCLA, graduating March 2027. I build outbound lead pipelines for two startups I co-founded. Interested in the GTM Automation Engineer role at Crexi. Open to connecting?"
    expect(good.length).toBeLessThanOrEqual(200)
    expect(draftProblems(good, rec)).toEqual([])
    expect(draftProblems("Hi Dana, I'm Conrad at UCLA, graduating March 2027. Would I be in scope for the GTM Automation Engineer role at Crexi?", rec).join()).toMatch(/End with exactly/)
    expect(draftProblems("Hi Dana, I'm Conrad at UCLA, graduating March 2027. I cold-emailed Coinbase's recruiters. Interested in the GTM Automation Engineer role at Crexi. Open to connecting?", rec).join()).toMatch(/Coinbase/)
  })
  it('after-accept message: recruiters end with the scope question', () => {
    expect(SCOPE_QUESTION).toBe('Is a March 2027 grad in scope for this role?')
    const ok = 'Thanks for connecting, Daniella. I also built and shipped a full-stack GTM platform solo. Is a March 2027 grad in scope for this role?'
    expect(followupProblems(ok, { branch: 'recruiting', allowTools: false })).toEqual([])
    expect(followupProblems('Thanks! I booked 40 meetings. Any openings?', { branch: 'recruiting', allowTools: false }).join()).toMatch(/numbers|scope/)
    expect(followupProblems("Thanks for connecting, Aryan. Since we last spoke, I've run outbound for two startups I co-founded. Open to a quick chat about your team?", { branch: 'alumni', allowTools: true }).join()).toMatch(/earlier contact/)
    expect(followupProblems('Thanks for connecting, Andrew. Beyond the Kalshi partnership, I built and shipped a full-stack GTM platform solo, and I build outbound lead pipelines. Is a March 2027 grad in scope for this role?', { branch: 'recruiting', allowTools: false }).join()).toMatch(/one more fact only/)
  })
  it('tool names only for technical recruiters and engineering alumni', () => {
    expect(draftProblems("Hi Dana, I'm Conrad at UCLA, graduating March 2027. I build pipelines in Clay. Interested in the GTM Automation Engineer role at Crexi. Open to connecting?", rec).join()).toMatch(/No tool names/)
    expect(systemPrompt({ key: 'systems', why: '' }, 250, false)).not.toMatch(/\b(Clay|Supabase|Exa|Apify)\b/)
    expect(systemPrompt({ key: 'systems', why: '' }, 250, true)).toMatch(/Clay/)
  })
  it('"Blockchain @ UCLA", never "my blockchain club"; no "I\'m at UCLA" after fellow Bruin', () => {
    expect(draftProblems('Through my blockchain club I cold-emailed recruiters.', ctx).join()).toMatch(/Blockchain @ UCLA/)
    expect(draftProblems("Hi Aryan, fellow Bruin here. I'm at UCLA, graduating March 2027.", ctx).join()).toMatch(/drop "I'm at UCLA"/)
  })
  it('only the top alum and top recruiter per company are drafted', () => {
    const t = draftTargetIds([
      { id: 1, company_key: 'a', branch: 'alumni', rank: 1 },
      { id: 2, company_key: 'a', branch: 'alumni', rank: 2 },
      { id: 3, company_key: 'a', branch: 'recruiting', rank: 2 },
      { id: 4, company_key: 'a', branch: 'recruiting', rank: 1 },
      { id: 5, company_key: 'a', branch: 'gtm_leadership', rank: 1 },
      { id: 6, company_key: 'b', branch: 'blockchain_ucla', rank: 1 },
      { id: 7, company_key: 'b', branch: 'alumni', rank: 1 },
    ])
    expect([...t].sort()).toEqual([1, 4, 6])
  })
})
