import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { classifyJob, classifyPrompt, classificationRow, confidenceOf, type ClassifyClient, type ClassifyInput } from '@/lib/jobs/classify'
import { trackOf, type Category } from '@/lib/jobs/categories'
import { companyFit, fitFlags, fitTrack, blocks, isSdr } from '@/lib/jobs/fit'
import { finalCategory, requiresClosingExperience, splitSales } from '@/lib/jobs/categories'
import { planFor } from '@/lib/people/targets'
import { guessFromTitle } from '@/lib/jobs/titleGuess'
import { ruleFor } from '@/lib/people/targets'
import { sizeBand } from '@/lib/people/size'
import { chooseProof } from '@/lib/drafts/proof'

const fixture = (name: string): ClassifyInput => JSON.parse(readFileSync(`tests/fixtures/postings/${name}.json`, 'utf8'))

/**
 * Regression cases (owner, 2026-11-22). Expected classification is what a
 * human reading the posting would say; employees from the sheet.
 */
const CASES: {
  name: string
  category: Category
  seniority: string
  employees: number
  expectTrack: string
  expectRule: RegExp
  drafts: boolean
}[] = [
  {
    name: 'elevenlabs-website-growth-engineer',
    category: 'growth_eng_product',
    seniority: 'unknown',
    employees: 1515,
    expectTrack: 'technical',
    expectRule: /^Engineering\/product role: technical recruiters/,
    drafts: false,
  },
  {
    name: 'formic-gtm-engineer',
    category: 'gtm_eng',
    seniority: 'mid',
    employees: 250,
    expectTrack: 'sales',
    expectRule: /^Sales\/GTM role, large company: sales recruiting lead/,
    drafts: true,
  },
  {
    name: 'justpark-gtm-engineer',
    category: 'gtm_eng',
    seniority: 'mid',
    employees: 234,
    expectTrack: 'sales',
    expectRule: /^Sales\/GTM role, large company/,
    drafts: true,
  },
  {
    name: 'formance-founding-ae',
    category: 'sales',
    seniority: 'mid',
    employees: 60,
    expectTrack: 'sales',
    expectRule: /^Sales\/GTM role, medium company/,
    drafts: false,
  },
]

const job = (c: (typeof CASES)[number]) => ({
  id: 1,
  fit_tier: 1,
  liveness: 'live',
  category: c.category,
  category_confidence: 'high',
  seniority: c.seniority,
  work_mode: 'unknown',
  work_locations: [],
  start_requirement: 'unknown',
  start_date: null,
})

describe('regression cases: category → routing chain → fit flags → drafting', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const track = trackOf(c.category)
      expect(track).toBe(c.expectTrack)
      expect(ruleFor(track, sizeBand(c.employees))).toMatch(c.expectRule)
      const fit = companyFit([job(c)])
      expect(fit.canDraft).toBe(c.drafts)
      if (c.drafts) expect(chooseProof({ company: 'Formic', category: c.category, cryptoOrFintech: false, context: '', roleTitle: 'GTM Engineer', branch: 'recruiting', siblingCount: 0 })?.key).toBe('systems')
    })
  }

  it('Formance Founding AE stays blocked as AE', () => {
    expect(fitFlags({ ...job(CASES[3]), title: 'Founding Account Executive — Technical Sales' }).find((f) => f.code === 'category')?.level).toBe('block')
  })

  it('ElevenLabs: blocked as not GTM Eng, no proof point matches, override still finds no proof', () => {
    const flags = fitFlags(job(CASES[0]))
    expect(flags.find((f) => f.code === 'category')).toMatchObject({ level: 'block', message: 'Category is Growth Eng (product), not GTM Eng or SDR' })
    expect(chooseProof({ company: 'ElevenLabs', category: 'growth_eng_product', cryptoOrFintech: false, context: '', roleTitle: 'Website Growth Engineer', branch: 'alumni', siblingCount: 0 })).toBeNull()
    expect(companyFit([job(CASES[0])], true).canDraft).toBe(true) // override lifts the fit gate…
    // …but drafting still stops at the proof step (lib/drafts/run.ts) as a poor fit.
  })

  it('mid-level GTM Eng warns but drafts', () => {
    const flags = fitFlags(job(CASES[1]))
    expect(flags.find((f) => f.code === 'seniority')?.level).toBe('warn')
    expect(blocks(flags)).toBe(false)
  })
})

describe('fit flags', () => {
  const base = job(CASES[1])
  it('senior and director block', () => {
    expect(blocks(fitFlags({ ...base, seniority: 'senior' }))).toBe(true)
    expect(blocks(fitFlags({ ...base, seniority: 'director_plus' }))).toBe(true)
  })
  it('immediate start or a start date before March 2027 blocks', () => {
    expect(blocks(fitFlags({ ...base, start_requirement: 'immediate' }))).toBe(true)
    expect(blocks(fitFlags({ ...base, start_requirement: 'specific_date', start_date: '2026-12-01' }))).toBe(true)
    expect(blocks(fitFlags({ ...base, start_requirement: 'specific_date', start_date: '2027-06-01' }))).toBe(false)
  })
  it('location (NYC): role in NYC, HQ in NYC, or remote US passes; another city warns; country-only is unknown', () => {
    const loc = (over: object) => fitFlags({ ...base, ...over }).find((f) => f.code === 'location')
    expect(loc({ work_mode: 'onsite', work_locations: ['New York, NY'] })).toBeUndefined()
    expect(loc({ work_mode: 'hybrid', work_locations: ['Brooklyn, NY'] })).toBeUndefined()
    expect(loc({ work_mode: 'onsite', work_locations: ['San Francisco, CA'], company_city: 'New York' })).toBeUndefined()
    expect(loc({ work_mode: 'remote', work_locations: ['United States'] })).toBeUndefined()
    expect(loc({ work_mode: 'onsite', work_locations: ['San Francisco, CA', 'Oakland, CA'] })).toMatchObject({ level: 'warn' })
    expect(loc({ work_mode: 'remote', work_locations: ['Europe', 'London'] })).toMatchObject({ level: 'block' })
    expect(loc({ work_mode: 'unknown', work_locations: ['Tel Aviv'] })).toMatchObject({ level: 'block', message: 'Based outside the US: Tel Aviv' })
    expect(loc({ work_mode: 'unknown', work_locations: ['United States'] })).toMatchObject({ level: 'info', message: 'Location unknown' })
    expect(blocks(fitFlags({ ...base, work_mode: 'onsite', work_locations: ['Austin, TX'] }))).toBe(false)
  })
  it('SDR passes, AE stays blocked', () => {
    const sales = { ...base, seniority: 'entry' }
    expect(isSdr({ category: 'sdr', title: 'Sales Development Representative' })).toBe(true)
    expect(blocks(fitFlags({ ...sales, category: 'sdr', title: 'Founding SDR' }))).toBe(false)
    expect(blocks(fitFlags({ ...sales, category: 'sdr', title: 'BDR, Mid-Market' }))).toBe(false)
    expect(fitFlags({ ...sales, category: 'ae', title: 'Founding Account Executive' }).find((f) => f.code === 'category')).toMatchObject({
      level: 'block',
      message: 'Category is Sales – AE, not GTM Eng or SDR',
    })
  })
  it('NYC roles sort first among passing roles', () => {
    const sf = { ...base, id: 2, work_mode: 'onsite', work_locations: ['San Francisco, CA'] }
    const ny = { ...base, id: 3, fit_tier: 3, work_mode: 'onsite', work_locations: ['New York, NY'] }
    const fit = companyFit([sf, ny])
    expect(fit.primary?.id).toBe(3)
    expect(fit.home).toBe(true)
  })
  it('closed postings and unclassified jobs block', () => {
    expect(blocks(fitFlags({ ...base, liveness: 'dead' }))).toBe(true)
    expect(blocks(fitFlags({ ...base, category: null }))).toBe(true)
  })
  it('company passes when any role passes; primary is the passing one', () => {
    const bad = { ...job(CASES[0]), id: 2 }
    const good = { ...job(CASES[1]), id: 3, fit_tier: 2 }
    const fit = companyFit([bad, good])
    expect(fit.passes).toBe(true)
    expect(fit.primary?.id).toBe(3)
  })
})

describe('classifier plumbing', () => {
  it('title-only input is low confidence and tells the model', () => {
    const p = classifyPrompt({ ...fixture('formic-gtm-engineer'), description: null })
    expect(p.titleOnly).toBe(true)
    expect(p.text).toMatch(/not available/)
    expect(confidenceOf(true, true)).toBe('low')
    expect(confidenceOf(false, true)).toBe('high')
    expect(confidenceOf(false, false)).toBe('medium')
  })
  it('department from the job board is passed through', () => {
    expect(classifyPrompt({ ...fixture('formic-gtm-engineer'), department: 'Revenue' }).text).toContain('Department (from the job board): Revenue')
  })
  it('parses the structured result and builds the row', async () => {
    const client = {
      beta: {
        messages: {
          parse: async () => ({
            model: 'claude-opus-5-5',
            stop_reason: 'end_turn',
            stop_details: null,
            usage: { input_tokens: 2000, output_tokens: 200 },
            parsed_output: {
              category: 'growth_eng_product',
              department: 'Engineering & Product',
              seniority: 'unknown',
              work_mode: 'remote',
              work_locations: ['New York'],
              start_requirement: 'unknown',
              start_date: 'soon',
              crypto_or_fintech: false,
              confident: true,
              reason: 'CRO and SEO work.',
            },
          }),
        },
      },
    } as unknown as ClassifyClient
    const r = await classifyJob(client, fixture('elevenlabs-website-growth-engineer'))
    expect(r.confidence).toBe('high')
    const row = classificationRow(r)
    expect(row.category).toBe('growth_eng_product')
    expect(row.start_date).toBeNull() // not a date → dropped
    expect(r.cost).toBeCloseTo(2000 * 4e-6 + 200 * 20e-6)
  })
  it('title guess never calls a bare Growth Engineer GTM Eng', () => {
    expect(guessFromTitle('Growth Engineer').category).toBe('growth_eng_product')
    expect(guessFromTitle('Founding GTM Engineer').category).toBe('gtm_eng')
    expect(guessFromTitle('Senior Account Executive')).toEqual({ category: 'sales', seniority: 'senior' })
  })
})

// Real model on the four regression postings: RUN_LIVE=1 npx vitest run tests/jobs/classify.test.ts (about $0.07).
describe.runIf(process.env.RUN_LIVE === '1')('live classifier on regression postings', () => {
  const client = new Anthropic()
  for (const c of CASES) {
    it(`${c.name} → ${c.category} (${c.expectTrack} chain)`, async () => {
      const r = await classifyJob(client, fixture(c.name))
      expect(r.classification.category).toBe(c.category)
      expect(trackOf(r.classification.category)).toBe(c.expectTrack)
      expect(r.confidence).not.toBe('low')
    }, 120_000)
  }
})

describe('Sales split (owner, 2026-11-23)', () => {
  it('SDR / BDR titles are their own category', () => {
    for (const t of ['Sales Development Representative', 'Business Development Representative (BDR)', 'Founding SDR', 'SDR', 'Manager, SDR', 'Founding BDR, Life Sciences Partnerships', 'Market Development Rep'])
      expect(splitSales(t)).toBe('sdr')
  })
  it('AE and other closing roles are AE', () => {
    for (const t of ['Account Executive', 'Founding Account Executive', 'Senior AE, Mid-Market', 'Sales Executive, NA', 'Enterprise Sales Representative'])
      expect(splitSales(t)).toBe('ae')
  })
  it('post-sale roles are account management or customer success', () => {
    expect(splitSales('Strategic Account Manager')).toBe('account_management')
    expect(splitSales('Renewals Manager')).toBe('account_management')
    expect(splitSales('Customer Success Manager')).toBe('customer_success')
    expect(splitSales('Implementation Specialist')).toBe('customer_success')
  })
  it('anything else stays Sales – other; non-sales answers pass through', () => {
    expect(splitSales('Pre Sales Solutions Engineer')).toBe('sales')
    expect(splitSales('Sales Enablement Manager')).toBe('sales')
    expect(finalCategory('sales', 'Business Development Representative')).toBe('sdr')
    expect(finalCategory('gtm_eng', 'Account Executive')).toBe('gtm_eng')
  })
  it('the classifier row splits a sales answer by title', async () => {
    const client = {
      beta: { messages: { parse: async () => ({ model: 'm', stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: { category: 'sales', department: 'Sales', seniority: 'entry', work_mode: 'onsite', work_locations: ['New York, NY'], start_requirement: 'unknown', start_date: null, crypto_or_fintech: false, confident: true, reason: 'SDR.' } }) } },
    } as unknown as ClassifyClient
    const r = await classifyJob(client, fixture('formic-gtm-engineer'))
    expect(classificationRow(r, { title: 'Sales Development Representative', description: 'Book meetings. 1+ year of cold calling.' })).toMatchObject({ category: 'sdr', closing_required: false })
    expect(classificationRow(r, { title: 'SDR', description: 'You have 2+ years of closing experience in SaaS.' })).toMatchObject({ category: 'sdr', closing_required: true })
    expect(classificationRow(r, { title: 'Account Executive' })).toMatchObject({ category: 'ae', closing_required: null })
  })
})

describe('tracks (owner, 2026-11-23)', () => {
  const base = { title: 'x', category_confidence: 'high', seniority: 'entry', work_mode: 'onsite', work_locations: ['New York, NY'], start_requirement: 'unknown', start_date: null }
  const level = (over: object) => {
    const f = fitFlags({ ...base, category: 'gtm_eng', ...over }).find((x) => x.code === 'category')
    return f ? f.level : 'pass'
  }
  it('GTM Eng and SDR pass, RevOps warns, everything else blocks', () => {
    expect(level({ category: 'gtm_eng' })).toBe('pass')
    expect(level({ category: 'sdr', title: 'SDR' })).toBe('pass')
    expect(level({ category: 'revops' })).toBe('warn')
    for (const c of ['growth_eng_product', 'marketing', 'ae', 'account_management', 'customer_success', 'sales', 'partnerships_bd', 'engineering', 'other']) expect(level({ category: c })).toBe('block')
  })
  it('each passing category is its own track; the rest are blocked', () => {
    expect(fitTrack('gtm_eng')).toBe('gtm_eng')
    expect(fitTrack('sdr')).toBe('sdr')
    expect(fitTrack('revops')).toBe('revops')
    expect(fitTrack('ae')).toBe('blocked')
  })
  it('a "GTM Engineer" classified RevOps with low confidence warns, never blocks', () => {
    const f = fitFlags({ ...base, category: 'revops', category_confidence: 'low', title: 'GTM Engineer' })
    expect(f.find((x) => x.code === 'category')).toMatchObject({ level: 'warn', message: 'Titled GTM Engineer, classified RevOps (low confidence)' })
    expect(blocks(f)).toBe(false)
  })
  it('SDR seniority: entry passes; manager title or 2+ years closing blocks; mid warns', () => {
    const sdr = { ...base, category: 'sdr', title: 'Sales Development Representative' }
    expect(blocks(fitFlags(sdr))).toBe(false)
    expect(fitFlags({ ...sdr, title: 'Manager, SDR' }).find((x) => x.code === 'seniority')).toMatchObject({ level: 'block', message: 'SDR manager role' })
    expect(fitFlags({ ...sdr, closing_required: true }).find((x) => x.code === 'seniority')).toMatchObject({ level: 'block', message: 'Asks for 2+ years of closing experience' })
    expect(fitFlags({ ...sdr, seniority: 'mid' }).find((x) => x.code === 'seniority')?.level).toBe('warn')
  })
  it('closing experience: only 2+ years of closing / quota counts', () => {
    expect(requiresClosingExperience('2+ years of closing experience')).toBe(true)
    expect(requiresClosingExperience('3-5 years in a quota-carrying role')).toBe(true)
    expect(requiresClosingExperience('1+ years of SaaS sales experience')).toBe(false)
    expect(requiresClosingExperience('2+ years of prospecting experience')).toBe(false)
    expect(requiresClosingExperience(null)).toBe(false)
  })
  it('company rows prefer GTM Eng over SDR over RevOps; SDR drafting is paused', () => {
    const role = (id: number, category: string, title = 'x') => ({ ...base, id, fit_tier: 1, category, title })
    expect(companyFit([role(1, 'revops'), role(2, 'sdr', 'SDR'), role(3, 'gtm_eng')]).primary?.id).toBe(3)
    const sdrOnly = companyFit([role(1, 'revops'), role(2, 'sdr', 'SDR')])
    expect(sdrOnly).toMatchObject({ track: 'sdr', passes: true, draftPaused: true, canDraft: false })
    expect(companyFit([role(1, 'revops')])).toMatchObject({ track: 'revops', passes: true, canDraft: true })
    expect(companyFit([role(1, 'ae')])).toMatchObject({ track: 'blocked', passes: false })
  })
  it('SDR routing: under 30 people, sales leader or founder first; otherwise the sales chain', () => {
    const small = planFor('sales', 'small', true)
    expect(small.filter((s) => !s.when).map((s) => s.branch)).toEqual(['gtm_leadership', 'executive'])
    expect(small.find((s) => s.branch === 'recruiting')?.when?.({})).toBe(true)
    expect(small.find((s) => s.branch === 'recruiting')?.when?.({ gtm_lead: 1 })).toBe(false)
    expect(planFor('sales', 'large', true)).toEqual(planFor('sales', 'large'))
    expect(ruleFor('sales', 'small', true)).toMatch(/sales leader \+ founder/)
  })
  it('SDR proof points: prospecting, then Kalshi, then Coinbase (alumni only)', () => {
    const p = (branch: string, siblingTexts: string[] = []) => chooseProof({ company: 'Acme', category: 'sdr', cryptoOrFintech: false, context: '', roleTitle: 'SDR', branch, siblingCount: siblingTexts.length, siblingTexts })?.key
    expect(p('recruiting')).toBe('sdr')
    expect(p('alumni')).toBe('sdr')
    expect(p('alumni', ['I do my own prospecting…'])).toBe('kalshi')
    expect(p('alumni', ['I do my own prospecting…', 'Kalshi partnership'])).toBe('coinbase')
    expect(p('recruiting', ['I do my own prospecting…', 'Kalshi partnership'])).toBe('kalshi')
  })
})
