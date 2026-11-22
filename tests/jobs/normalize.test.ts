import { describe, expect, it } from 'vitest'
import { parseCsv } from '@/lib/jobs/csv'
import { boardOf, linkKey, canonicalLink, parseJobsFinal, factsOf } from '@/lib/jobs/normalize'
import { planSync } from '@/lib/jobs/sync'
import { statusFromSheet } from '@/lib/jobs/statuses'

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas and newlines, CRLF', () => {
    const rows = parseCsv('a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n')
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'he said "hi"', 'line1\nline2'],
    ])
  })
  it('keeps trailing empty fields', () => {
    expect(parseCsv('a,,\n')).toEqual([['a', '', '']])
  })
})

describe('linkKey', () => {
  it('collapses LinkedIn view links with tracking params', () => {
    expect(linkKey('https://www.linkedin.com/jobs/view/gtm-engineer-at-stuut-4466026124?position=4&trackingId=x')).toBe(
      'linkedin.com/jobs/view/4466026124'
    )
  })
  it('reads currentJobId from LinkedIn search-results links', () => {
    expect(linkKey('https://www.linkedin.com/jobs/search-results/?currentJobId=4392103875&eBP=abc')).toBe(
      'linkedin.com/jobs/view/4392103875'
    )
    expect(canonicalLink('https://www.linkedin.com/jobs/search-results/?currentJobId=4392103875')).toBe(
      'https://www.linkedin.com/jobs/view/4392103875'
    )
  })
  it('lowercases ATS links and drops query and trailing slash', () => {
    expect(linkKey('https://jobs.ashbyhq.com/Peec/046e16bc/?utm=1')).toBe('jobs.ashbyhq.com/peec/046e16bc')
  })
})

describe('boardOf', () => {
  it('detects ATS boards', () => {
    expect(boardOf('https://jobs.ashbyhq.com/x/1')).toBe('ashby')
    expect(boardOf('https://job-boards.greenhouse.io/tines/jobs/1')).toBe('greenhouse')
    expect(boardOf('https://jobs.lever.co/jobgether/1')).toBe('lever')
    expect(boardOf('https://www.linkedin.com/jobs/view/1')).toBe('linkedin')
    expect(boardOf('https://www.tryprofound.com/careers/1')).toBe('other')
    expect(boardOf('not a url')).toBe('other')
  })
})

describe('statusFromSheet', () => {
  it('maps sheet text to pipeline values', () => {
    expect(statusFromSheet('')).toBe('new')
    expect(statusFromSheet('Not a Right Fit')).toBe('not_fit')
    expect(statusFromSheet('Applied 11/2')).toBe('applied')
    expect(statusFromSheet('whatever')).toBe('new')
  })
})

const HEADER = 'companyName,title,link,status,email sent,fit_tier,fundingStage,totalFunding,salaryText,salaryMin,salaryMax,location,postedAt'

describe('parseJobsFinal', () => {
  const csv = [
    HEADER,
    'Weave,Growth Engineer,https://jobs.ashbyhq.com/workweave/0b8,Not a Right Fit,N/A,1,Series A,171752285,"$100,000 - $140,000",100000,140000,"San Francisco, CA",2026-09-17',
    'Weave,Growth Engineer,https://jobs.ashbyhq.com/workweave/0b8/,,,1,,,,,,,',
    ',,,,,,,,,,,,',
    'Referrals,,,Status,,,,,,,,,',
    'Tines,GTM Systems Specialist,https://job-boards.greenhouse.io/tines/jobs/6202989004,,,1,,,,,,,',
    ',,https://job-boards.greenhouse.io/d3/jobs/5438003008,,,,,,,,,,',
    'NoLink Co,Role,,,,2,,,,,,,',
  ].join('\n')
  const { rows, skipped } = parseJobsFinal(parseCsv(csv))

  it('maps typed fields and seeds status', () => {
    const w = rows[0]
    expect(w).toMatchObject({
      company: 'Weave',
      company_key: 'weave',
      title: 'Growth Engineer',
      fit_tier: 1,
      status: 'not_fit',
      email_sent: 'N/A',
      total_funding: 171752285,
      salary_min: 100000,
      salary_max: 140000,
      location: 'San Francisco, CA',
      posted_at: '2026-09-17',
      board: 'ashby',
      section: 'main',
      sheet_row: 2,
    })
    expect(w.raw.salaryText).toBe('$100,000 - $140,000')
  })

  it('dedupes on company + link key, tags the referrals section, fills company from the ATS link', () => {
    expect(rows.map((r) => [r.company, r.section])).toEqual([
      ['Weave', 'main'],
      ['Tines', 'referrals'],
      ['d3', 'referrals'],
    ])
    expect(rows[2].fit_tier).toBeNull()
    expect(skipped.map((s) => s.reason)).toEqual(['duplicate', 'section header', 'no link'])
  })

  it('factsOf drops tracking fields', () => {
    const f = factsOf(rows[0]) as unknown as Record<string, unknown>
    expect(f.status).toBeUndefined()
    expect(f.email_sent).toBeUndefined()
    expect(f.company).toBe('Weave')
  })

  it('rejects a CSV that is not Jobs Final', () => {
    expect(() => parseJobsFinal(parseCsv('a,b\n1,2'))).toThrow(/Jobs Final/)
  })
})

describe('planSync', () => {
  it('splits new vs existing rows', () => {
    const { rows } = parseJobsFinal(parseCsv(`${HEADER}\nA,t,https://a.com/1,,,1\nB,t,https://b.com/1,,,1`))
    const { toInsert, toUpdate } = planSync(rows, new Set(['a|a.com/1']))
    expect(toInsert.map((r) => r.company)).toEqual(['B'])
    expect(toUpdate.map((r) => r.company)).toEqual(['A'])
  })
})

import { accessKeyMatches } from '@/lib/auth/accessKey'

describe('accessKeyMatches', () => {
  const key = 'a'.repeat(40)
  it('matches only the exact key', () => {
    expect(accessKeyMatches(key, key)).toBe(true)
    expect(accessKeyMatches(key + 'x', key)).toBe(false)
    expect(accessKeyMatches(key.slice(1), key)).toBe(false)
    expect(accessKeyMatches('', key)).toBe(false)
  })
  it('fails closed when the key is unset or too short', () => {
    expect(accessKeyMatches('short', 'short')).toBe(false)
    expect(accessKeyMatches('x', undefined)).toBe(false)
  })
})
