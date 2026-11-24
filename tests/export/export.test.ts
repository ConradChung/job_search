import { describe, expect, it } from 'vitest'
import { contactType, csvField, normalizeLinkedIn, oneLine, parseCsv, pickForExport, splitName, toCsv, type ExportCandidate } from '@/lib/export/csv'
import { EXPORT_COLUMNS, type ExportRow } from '@/lib/export/columns'

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  linkedin_url: 'https://www.linkedin.com/in/ann',
  first_name: 'Ann',
  last_name: 'Lee',
  company: 'Acme',
  title: 'Recruiter',
  contact_type: 'recruiter',
  track: 'GTM Eng',
  role: 'GTM Engineer',
  note: 'Hi Ann',
  after_accept_message: 'Thanks',
  email: '',
  email_subject: '',
  email_body: '',
  role_status: 'new',
  company_id: 'acme',
  person_id: '1',
  ...over,
})

describe('CSV quoting', () => {
  it('quotes commas, quotes and line breaks; doubles quotes', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a, b')).toBe('"a, b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
    expect(csvField(' edge')).toBe('" edge"')
  })
  it('notes stay one line; only the after-accept message keeps line breaks', () => {
    expect(oneLine('Hi Ann,\r\nI build\nthings. Open?')).toBe('Hi Ann, I build things. Open?')
    const csv = toCsv([row({ note: 'Hi Ann,\nI "build" things, really.', after_accept_message: 'Thanks\r\nagain' })])
    const lines = csv.trimEnd().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('"Hi Ann, I ""build"" things, really."')
    // The after-accept message keeps its line breaks (as \n), quoted so they survive.
    expect(lines[1]).toContain(',"Thanks\nagain",')
  })
  it('a multi-line after-accept message round-trips through the parser', () => {
    const msg = 'Thanks, Ann.\n\nQuick background:\n• One, "two"\n• Three'
    const csv = toCsv([row({ after_accept_message: msg })])
    expect(csv).toContain('"Thanks, Ann.\n\nQuick background:\n• One, ""two""\n• Three"')
    const parsed = parseCsv(csv)
    expect(parsed).toHaveLength(2)
    expect(parsed[1][EXPORT_COLUMNS.findIndex((c) => c.key === 'after_accept_message')]).toBe(msg)
  })
  it('header follows the column config, linkedin_url first; round-trips through the parser', () => {
    const csv = toCsv([row({ company: 'Ünïcode, Inc.', note: 'Comma, "quote"' })])
    const parsed = parseCsv(csv)
    expect(parsed[0]).toEqual(EXPORT_COLUMNS.map((c) => c.header))
    expect(parsed[0][0]).toBe('linkedin_url')
    expect(parsed[1][3]).toBe('Ünïcode, Inc.')
    expect(parsed[1][8]).toBe('Comma, "quote"')
  })
})

describe('LinkedIn URL normalising', () => {
  it('canonical https://www.linkedin.com/in/<slug>, no query or trailing slash', () => {
    expect(normalizeLinkedIn('https://www.linkedin.com/in/ann-lee-123/?utm_source=x')).toBe('https://www.linkedin.com/in/ann-lee-123')
    expect(normalizeLinkedIn('linkedin.com/in/Ann-Lee')).toBe('https://www.linkedin.com/in/ann-lee')
    expect(normalizeLinkedIn('http://uk.linkedin.com/in/ann#about')).toBe('https://www.linkedin.com/in/ann')
    expect(normalizeLinkedIn(' https://www.linkedin.com/in/jos%C3%A9 ')).toBe('https://www.linkedin.com/in/jos%C3%A9')
  })
  it('null for anything that is not a profile URL', () => {
    expect(normalizeLinkedIn('https://www.linkedin.com/company/acme')).toBeNull()
    expect(normalizeLinkedIn('')).toBeNull()
    expect(normalizeLinkedIn(null)).toBeNull()
  })
})

describe('names and contact types', () => {
  it('splits names without pronouns, nicknames or credentials', () => {
    expect(splitName('Hayley (Gordon) Lusso')).toEqual({ first: 'Hayley', last: 'Lusso' })
    expect(splitName('Grace King (She/Her)')).toEqual({ first: 'Grace', last: 'King' })
    expect(splitName('Ann Lee, MBA')).toEqual({ first: 'Ann', last: 'Lee' })
  })
  it('alum / recruiter / sales leader / founder', () => {
    expect(contactType('alumni', 'SWE')).toBe('alum')
    expect(contactType('blockchain_ucla', null)).toBe('alum')
    expect(contactType('recruiting', 'Recruiter')).toBe('recruiter')
    expect(contactType('gtm_leadership', 'VP Sales')).toBe('sales leader')
    expect(contactType('executive', 'Chief Revenue Officer (CRO)')).toBe('sales leader')
    expect(contactType('executive', 'Co-founder and CEO')).toBe('founder')
  })
})

describe('what goes in a file', () => {
  const c = (id: number, status: string, tier: number, order: number, url: string | null = `https://linkedin.com/in/p${id}`): ExportCandidate => ({
    id,
    status,
    tier,
    order,
    url,
    name: `P${id}`,
    company: 'Acme',
  })
  const cands = [c(1, 'approved', 2, 0), c(2, 'approved', 1, 1), c(3, 'exported', 1, 2), c(4, 'drafted', 1, 3), c(5, 'approved', 1, 4, null), c(6, 'approved', 1, 5), c(7, 'approved', 3, 6), c(8, 'sent', 1, 7)]
  const ids = (r: { chosen: ExportCandidate[] }) => r.chosen.map((x) => x.id)

  it('exported once: Exported people are left out unless asked', () => {
    expect(ids(pickForExport(cands, { tiers: [1], includeExported: false, limit: null }))).toEqual([2, 6])
    expect(ids(pickForExport(cands, { tiers: [1], includeExported: true, limit: null }))).toEqual([2, 3, 6])
  })
  it('Approved only: drafted and sent never go out', () => {
    const all = ids(pickForExport(cands, { tiers: [1, 2, 3], includeExported: true, limit: null }))
    expect(all).not.toContain(4)
    expect(all).not.toContain(8)
  })
  it('one tier by default; several only when selected, highest tier first, then page order', () => {
    expect(pickForExport(cands, { tiers: [1], includeExported: false, limit: null }).chosen.every((x) => x.tier === 1)).toBe(true)
    expect(ids(pickForExport(cands, { tiers: [2, 1], includeExported: false, limit: null }))).toEqual([2, 6, 1])
  })
  it('first N, after skipping (and listing) people without a profile URL', () => {
    const r = pickForExport(cands, { tiers: [1, 2, 3], includeExported: false, limit: 2 })
    expect(ids(r)).toEqual([2, 6])
    expect(r.noUrl.map((x) => x.id)).toEqual([5])
    expect(r.available).toBe(4)
  })
})
