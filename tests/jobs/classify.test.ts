import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { classifyJob, classifyPrompt, classificationRow, confidenceOf, type ClassifyClient, type ClassifyInput } from '@/lib/jobs/classify'
import { trackOf, type Category } from '@/lib/jobs/categories'
import { companyFit, fitFlags, blocks } from '@/lib/jobs/fit'
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
      if (c.drafts) expect(chooseProof(c.category, false)).toBe('systems')
    })
  }

  it('ElevenLabs: blocked as not GTM Eng, no proof point matches, override still finds no proof', () => {
    const flags = fitFlags(job(CASES[0]))
    expect(flags.find((f) => f.code === 'category')).toMatchObject({ level: 'block', message: 'Category is Growth Eng (product), not GTM Eng' })
    expect(chooseProof('growth_eng_product', false)).toBeNull()
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
  it('location: info when no locations are configured, block when configured and unmet', () => {
    expect(fitFlags(base).find((f) => f.code === 'location')?.level).toBe('info')
    const c = { categories: ['gtm_eng'], seniorityBlock: ['senior'], seniorityWarn: [], locations: ['Los Angeles'], remoteOk: true, earliestStart: '2027-03-01' }
    expect(blocks(fitFlags({ ...base, work_mode: 'onsite', work_locations: ['New York, NY'] }, c))).toBe(true)
    expect(blocks(fitFlags({ ...base, work_mode: 'onsite', work_locations: ['Los Angeles, CA'] }, c))).toBe(false)
    expect(blocks(fitFlags({ ...base, work_mode: 'remote', work_locations: ['United States'] }, c))).toBe(false)
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
