import { describe, expect, it } from 'vitest'
import { findPeople, type CompanyInput } from '@/lib/people/find'
import type { ExaResult } from '@/lib/people/parse'
import { functionScore, maxSearches, TITLES } from '@/lib/people/targets'

function profile(slug: string, name: string, title: string, opts: { edu?: string; extra?: string } = {}): ExaResult {
  return {
    url: `https://linkedin.com/in/${slug}`,
    title: name,
    text: `# ${name}\n\n${title} @ ElevenLabs\n\nNew York\n\n## Experience\n\n### ${title} - [ElevenLabs](https://x) (Current)\n\n${opts.extra ?? ''}\n\n## Education\n\n${opts.edu ?? '### BA at [State College](https://x)'}`,
  }
}

function fakeSearch(byQuery: Record<string, ExaResult[]>) {
  const queries: string[] = []
  const search = async (q: string) => {
    queries.push(q)
    const hit = Object.entries(byQuery).find(([k]) => q.startsWith(k))
    return { results: hit ? hit[1] : [], cost: 0.007 }
  }
  return { search, queries }
}

const eleven = (over: Partial<CompanyInput> = {}): CompanyInput => ({
  company: 'ElevenLabs',
  company_key: 'elevenlabs',
  domain: 'elevenlabs.io',
  employees: 1515,
  size_text: null,
  track: 'technical',
  roleSeniority: 'unknown',
  ...over,
})

describe('routing by department (ElevenLabs Website Growth Engineer)', () => {
  it('engineering role: technical recruiters first; leadership recruiter dropped; Blockchain @ UCLA over UCLA alumni', async () => {
    const { search, queries } = fakeSearch({
      'Blockchain at UCLA': [
        profile('both', 'Bo', 'Growth Engineer', { edu: '### BS at [UCLA](https://x)\n\nActivities: Blockchain at UCLA' }),
      ],
      'UCLA': [
        profile('alum-eng', 'Ana', 'Software Engineer', { edu: '### BS at [UCLA](https://x)' }),
        profile('alum-ops', 'Al', 'Office Manager', { edu: '### BA at [UCLA](https://x)' }),
      ],
      'Technical recruiter': [
        profile('tr', 'Tim', 'Technical Recruiter'),
        profile('flp', 'Kim', 'Fractional Leadership Talent Partner'),
      ],
    })
    const r = await findPeople(eleven(), search)
    expect(r.rule).toMatch(/^Engineering\/product role: technical recruiters/)
    expect(queries).toHaveLength(3) // blockchain + alumni + technical recruiters; fallbacks skipped
    const by = (b: string) => r.people.filter((p) => p.branch === b).map((p) => p.full_name)
    expect(by('blockchain_ucla')).toEqual(['Bo'])
    expect(by('alumni')).toEqual(['Ana', 'Al']) // engineer outranks office manager for an engineering role
    expect(by('recruiting')).toEqual(['Tim'])
    expect(r.people.some((p) => p.full_name === 'Kim')).toBe(false)
    expect(r.people.find((p) => p.full_name === 'Bo')?.profile_text).toContain('Blockchain at UCLA')
  })

  it('leadership recruiter kept for a director-level role', async () => {
    const { search } = fakeSearch({ 'Technical recruiter': [profile('flp', 'Kim', 'Fractional Leadership Talent Partner')] })
    const r = await findPeople(eleven({ roleSeniority: 'director_plus' }), search)
    expect(r.people.map((p) => p.full_name)).toContain('Kim')
  })

  it('engineering chain falls through to head of recruiting, then recruiters', async () => {
    const { search, queries } = fakeSearch({})
    await findPeople(eleven(), search)
    expect(queries).toHaveLength(maxSearches('large', 'technical'))
  })

  it('sales role at the same company uses the sales chain', async () => {
    const { search } = fakeSearch({})
    const r = await findPeople(eleven({ track: 'sales' }), search)
    expect(r.rule).toMatch(/^Sales\/GTM role, large company/)
  })
})

describe('title patterns and function closeness', () => {
  it('leadership / executive / fractional recruiters', () => {
    expect(TITLES.leadershipRecruiter.test('Fractional Leadership Talent Partner')).toBe(true)
    expect(TITLES.leadershipRecruiter.test('Executive Recruiter')).toBe(true)
    expect(TITLES.leadershipRecruiter.test('Technical Recruiter')).toBe(false)
  })
  it('technical recruiters', () => {
    expect(TITLES.technicalRecruiting.test('Technical Recruiter')).toBe(true)
    expect(TITLES.technicalRecruiting.test('Talent Partner, Engineering')).toBe(true)
    expect(TITLES.technicalRecruiting.test('Sales Recruiter')).toBe(false)
  })
  it('alumni closeness: GTM person outranks unrelated team for a GTM role', () => {
    expect(functionScore('GTM', 'sales')).toBeGreaterThan(functionScore('Forward Deployed Creative', 'sales'))
    expect(functionScore('Senior Account Executive', 'sales')).toBe(2)
  })
})
