import { describe, expect, it } from 'vitest'
import { buildCompanies, type CompanyJob } from '@/lib/people/companies'
import { applyFilters, CLEARED, countFor, countTiers, culprits, fitAfterTierChange, rowTrack, type Filters } from '@/lib/pipeline/filters'
import type { PersonRow } from '@/lib/people/types'

let id = 0
const job = (key: string, category: string, o: Partial<CompanyJob> & { employees?: number } = {}) =>
  ({
    id: ++id,
    company_key: key,
    company: key,
    title: category === 'sdr' ? 'SDR' : 'GTM Engineer',
    link: `https://x/${id}`,
    fit_tier: 1,
    status: 'new',
    posted_at: '2026-11-01',
    category,
    category_confidence: 'high',
    seniority: 'entry',
    work_mode: 'onsite',
    work_locations: ['New York, NY'],
    start_requirement: 'unknown',
    start_date: null,
    section: 'main',
    company_employees: o.employees ?? 50,
    liveness: 'live',
    ...o,
  }) as unknown as CompanyJob

const person = (key: string): PersonRow => ({ id: ++id, company_key: key, full_name: 'P', branch: 'recruiting', outreach_status: 'none' }) as unknown as PersonRow

// A mixed set: tiers 1-3 and blocked, three sizes, several statuses, both sections, some with people.
const jobs = [
  job('g-small-new', 'gtm_eng', { employees: 10 }),
  job('g-med-applied', 'gtm_eng', { employees: 60, status: 'applied' }),
  job('g-large-new', 'gtm_eng', { employees: 500, section: 'referrals' }),
  job('g-large-two', 'gtm_eng', { employees: 900 }),
  job('g-large-two', 'gtm_eng', { employees: 900, status: 'interviewing' }),
  job('g-closed', 'gtm_eng', { liveness: 'dead' }),
  job('s-small', 'sdr', { employees: 12 }),
  job('r-med', 'revops', { employees: 70, status: 'rejected' }),
  job('ae-large', 'ae', { employees: 300 }),
]
const companies = buildCompanies(jobs, [person('g-small-new'), person('s-small')], [])
const base: Filters = { ...CLEARED, tiers: new Set(['gtm_eng']), fit: 'passes' }

describe('chip counts follow every other filter (owner, 2026-11-23)', () => {
  const tier1 = applyFilters(companies, base).length

  it('with Tier 1 selected, size chip counts sum to the Tier 1 count', () => {
    expect(tier1).toBe(4)
    const sizes = (['small', 'medium', 'large'] as const).map((b) => countFor(companies, base, 'band', b))
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(tier1)
    expect(countFor(companies, base, 'band', 'all')).toBe(tier1)
  })

  it('with Tier 1 selected, status chip counts sum to the same number', () => {
    const statuses = ['new', 'reached_out', 'applied', 'interviewing', 'offer', 'rejected', 'not_fit'].map((s) => countFor(companies, base, 'status', s))
    expect(statuses.reduce((a, b) => a + b, 0)).toBe(tier1)
    // A company counts once, under its furthest-along role.
    expect(countFor(companies, base, 'status', 'interviewing')).toBe(1)
  })

  it('a group ignores its own selection but respects the others', () => {
    const small = { ...base, band: 'small' as const }
    expect(applyFilters(companies, small).length).toBe(1)
    // Tier chips under "small": what each tier would show with small still applied.
    expect(countFor(companies, small, 'tiers', new Set(['sdr']))).toBe(1)
    expect(countFor(companies, small, 'tiers', new Set(['revops']))).toBe(0)
    // The size group's own chips still count across sizes (its selection is replaced).
    expect(countFor(companies, small, 'band', 'large')).toBe(2)
  })

  it('the table count equals the selected chips', () => {
    const f = { ...base, band: 'large' as const, section: 'main' as const }
    expect(applyFilters(companies, f).length).toBe(countFor(companies, f, 'band', 'large'))
    expect(applyFilters(companies, f).length).toBe(countFor(companies, f, 'section', 'main'))
  })
})

describe('no impossible combinations', () => {
  it('choosing Blocked switches Passes to All', () => {
    expect(fitAfterTierChange(companies, base, new Set(['blocked']))).toBe('all')
    // So the Blocked chip counts the rows it will really show, not 0.
    expect(countFor(companies, base, 'tiers', new Set(['blocked']))).toBe(0)
    expect(countTiers(companies, base, new Set(['blocked']))).toBe(2)
    expect(applyFilters(companies, { ...base, tiers: new Set(['blocked']), fit: 'all' }).every((c) => rowTrack(c) === 'blocked')).toBe(true)
  })
  it('a tier choice that would be empty switches the fit filter to All; otherwise it stays', () => {
    expect(fitAfterTierChange(companies, { ...base, fit: 'flagged' }, new Set(['sdr']))).toBe('all')
    expect(fitAfterTierChange(companies, base, new Set(['sdr']))).toBe('passes')
  })
  it('an empty table names the filter to clear and how many rows clearing it brings back', () => {
    const f: Filters = { ...base, band: 'small', status: 'applied' }
    expect(applyFilters(companies, f)).toHaveLength(0)
    const found = culprits(companies, f)
    expect(found.map((x) => x.group)).toContain('status')
    expect(found.find((x) => x.group === 'status')?.rows).toBe(1)
  })
})
