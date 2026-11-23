import { describe, expect, it } from 'vitest'
import { sizeBand } from '@/lib/people/size'
import { linkedinKey, matchCompany, parseProfile, type ExaResult } from '@/lib/people/parse'
import { findPeople, domainOf, type CompanyInput } from '@/lib/people/find'
import { TITLES, maxSearches } from '@/lib/people/targets'

/** Synthetic profile in Exa's markdown shape. */
function profile(slug: string, name: string, headline: string, opts: { current?: string[]; edu?: string } = {}): ExaResult {
  const exp = (opts.current ?? []).join('\n\n')
  return {
    url: `https://linkedin.com/in/${slug}`,
    title: name,
    text: `# ${name}\n\n${headline}\n\nNew York, New York, United States (US)\n\n500 connections • 900 followers\n\n## About\n\nSomething.\n\n## Experience\n\n${exp}\n\n## Education\n\n${opts.edu ?? '### BA at [State College](https://www.linkedin.com/school/x)'}`,
  }
}

describe('sizeBand', () => {
  it('uses owner bands on the employee count', () => {
    expect(sizeBand(12)).toBe('small')
    expect(sizeBand(29)).toBe('small')
    expect(sizeBand(30)).toBe('medium')
    expect(sizeBand(100)).toBe('medium')
    expect(sizeBand(101)).toBe('large')
  })
  it('falls back to the size text, straddling ranges are medium', () => {
    expect(sizeBand(null, '2-10 employees')).toBe('small')
    expect(sizeBand(null, '501-1,000 employees')).toBe('large')
    expect(sizeBand(null, '10,001+ employees')).toBe('large')
    expect(sizeBand(null, '11-50 employees')).toBe('medium')
    expect(sizeBand(null, null)).toBe('medium')
  })
})

describe('parseProfile', () => {
  it('reads name, headline, location, inline and grouped current roles, UCLA', () => {
    const p = parseProfile(
      profile('jane-d%C3%B6e', 'Jane Döe', 'Head of Sales @ Acme AI | ex-Stripe', {
        current: [
          '### Head of Sales - [Acme AI](https://www.linkedin.com/company/acme) (Current)',
          '### [Other Co](https://www.linkedin.com/company/other)\n\n#### Advisor (Current)\n\n#### Analyst',
        ],
        edu: '### BA, Economics at [UCLA](https://www.linkedin.com/school/ucla)',
      })
    )!
    expect(p.full_name).toBe('Jane Döe')
    expect(p.headline).toBe('Head of Sales @ Acme AI | ex-Stripe')
    expect(p.location).toBe('New York, New York, United States (US)')
    expect(p.linkedin_key).toBe('jane-döe')
    expect(p.current).toEqual([
      { title: 'Head of Sales', company: 'Acme AI' },
      { title: 'Advisor', company: 'Other Co' },
    ])
    expect(p.is_ucla).toBe(true)
  })
  it('rejects non-profile URLs', () => {
    expect(parseProfile({ url: 'https://linkedin.com/company/acme', title: 'Acme' })).toBeNull()
    expect(linkedinKey('https://de.linkedin.com/in/Some-One?x=1')).toBe('some-one')
  })
})

describe('matchCompany', () => {
  const p = parseProfile(profile('a', 'A', 'GTM Hiring @ Engine | Talent', { current: ['### GTM Hiring - [Engine](https://x) (Current)'] }))!
  it('high confidence from a current role', () => {
    expect(matchCompany(p, 'Engine')).toEqual({ title: 'GTM Hiring', confidence: 'high' })
  })
  it('does not match a different company or a past role', () => {
    expect(matchCompany(p, 'Engine Room')).toBeNull()
    const past = parseProfile(profile('b', 'B', 'Founder at NewCo', { current: ['### Founder - [NewCo](https://x) (Current)', '### Recruiter - [Engine](https://x)'] }))!
    expect(matchCompany(past, 'Engine')).toBeNull()
  })
  it('headline must name the company exactly', () => {
    const h = parseProfile(profile('d', 'D', 'GTM Hiring @ Engine Room | Talent'))!
    expect(matchCompany(h, 'Engine')).toBeNull()
    expect(matchCompany(h, 'Engine Room')?.confidence).toBe('medium')
  })
  it('medium confidence from the headline only', () => {
    const h = parseProfile(profile('c', 'C', 'Head of Growth at Peec AI | Berlin'))!
    expect(matchCompany(h, 'Peec AI')).toEqual({ title: 'Head of Growth', confidence: 'medium' })
  })
})

describe('title patterns', () => {
  it('sorts recruiting vs GTM vs exec titles', () => {
    expect(TITLES.salesRecruiting.test('GTM Hiring')).toBe(true)
    expect(TITLES.salesRecruiting.test('Technical Recruiter')).toBe(false)
    expect(TITLES.recruitingLead.test('Head of Talent')).toBe(true)
    expect(TITLES.gtmLead.test('Head of Sales, EMEA')).toBe(true)
    expect(TITLES.gtmLead.test('Account Executive')).toBe(false)
    expect(TITLES.founderCeo.test('Founding GTME')).toBe(false)
    expect(TITLES.founderCeo.test('Co-founder & CEO')).toBe(true)
  })
})

describe('findPeople', () => {
  const company = (employees: number): CompanyInput => ({ company: 'Acme AI', company_key: 'acme ai', domain: 'acme.ai', employees, size_text: null, track: 'sales', roleSeniority: 'entry' })
  const role = (t: string) => [`### ${t} - [Acme AI](https://x) (Current)`]

  function fakeSearch(byQuery: Record<string, ExaResult[]>) {
    const queries: string[] = []
    const search = async (q: string) => {
      queries.push(q)
      const hit = Object.entries(byQuery).find(([k]) => q.startsWith(k))
      return { results: hit ? hit[1] : [], cost: 0.007 }
    }
    return { search, queries }
  }

  it('small: recruiting + GTM lead in parallel; exec skipped when a GTM head exists', async () => {
    const { search, queries } = fakeSearch({
      'Head of Talent': [profile('r1', 'Rae', 'Founding Recruiter @ Acme AI', { current: role('Founding Recruiter') })],
      'Head of Sales': [
        profile('g1', 'Gus', 'Head of Sales @ Acme AI', { current: role('Head of Sales') }),
        profile('f1', 'Fay', 'Co-founder & CEO @ Acme AI', { current: role('Co-founder & CEO') }),
        profile('x1', 'Xi', 'Head of Sales @ Other', { current: ['### Head of Sales - [Other](https://x) (Current)'] }),
      ],
    })
    const r = await findPeople(company(12), search)
    expect(r.band).toBe('small')
    expect(queries).toHaveLength(4) // blockchain + alumni + recruiting + gtm; executive skipped
    expect(queries.every((q) => q.endsWith('at Acme AI (acme.ai)'))).toBe(true)
    expect(r.people.map((p) => [p.full_name, p.branch])).toEqual([
      ['Rae', 'recruiting'],
      ['Gus', 'gtm_leadership'],
    ])
    expect(r.cost).toBeCloseTo(0.028)
  })

  it('small: no GTM head → executive step runs', async () => {
    const { search, queries } = fakeSearch({
      'Co-founder': [profile('f1', 'Fay', 'CEO @ Acme AI', { current: role('Co-founder & CEO') })],
    })
    const r = await findPeople(company(12), search)
    expect(queries).toHaveLength(5)
    expect(r.people.map((p) => [p.full_name, p.branch, p.level])).toEqual([['Fay', 'executive', 3]])
  })

  it('large: sales recruiter found → stops; UCLA alum goes to the alumni branch; cap 3 per branch', async () => {
    const recruiters = ['a', 'b', 'c', 'd'].map((s) => profile(`sr-${s}`, `SR ${s}`, 'x', { current: role('Sales Recruiter') }))
    const { search, queries } = fakeSearch({
      'UCLA': [profile('u1', 'Uma', 'Engineer @ Acme AI', { current: role('Software Engineer'), edu: '### BS at [UCLA](https://x)' })],
      'Recruiter or talent acquisition lead': recruiters,
    })
    const r = await findPeople(company(500), search)
    expect(r.band).toBe('large')
    expect(queries).toHaveLength(3)
    const recruiting = r.people.filter((p) => p.branch === 'recruiting')
    expect(recruiting.map((p) => p.rank)).toEqual([1, 2, 3])
    expect(r.people.find((p) => p.branch === 'alumni')?.full_name).toBe('Uma')
    expect(maxSearches('large')).toBe(5)
  })

  it('large: falls through recruiting levels when empty', async () => {
    const { queries, search } = fakeSearch({})
    const r = await findPeople(company(500), search)
    expect(queries).toHaveLength(5)
    expect(r.people).toEqual([])
  })

  it('domainOf strips scheme and www', () => {
    expect(domainOf('http://www.getweave.com')).toBe('getweave.com')
    expect(domainOf('trunktools.com/')).toBe('trunktools.com')
    expect(domainOf(null)).toBeNull()
  })
})
