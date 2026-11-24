import { describe, expect, it } from 'vitest'
import { afterAcceptEmail, afterAcceptEmailProblems, afterAcceptMessage, afterAcceptProblems, afterAcceptTrack } from '@/lib/drafts/afterAccept'
import { fitPhrase, joinItems } from '@/lib/research/bank'
import { domainOf, fitProblems, hookProblems, toRecord, usableSources, type SourceItem } from '@/lib/research/research'
import { hookGated } from '@/lib/research/gate'
import { pickForExport, toCsv, parseCsv, type ExportCandidate } from '@/lib/export/csv'
import { EXPORT_COLUMNS, type ExportRow } from '@/lib/export/columns'

const note = "Hi Renee, I'm Conrad at UCLA, graduating March 2027. I built a full-stack GTM platform solo. Interested in the GTM Engineer role at Engine. Open to connecting?"
const research = { hookSentence: "I enjoyed your post on how Engine rebuilt its booking agent, especially the choice to keep a human in the loop for edge cases.", hookShort: 'I enjoyed your post on rebuilding the booking agent', fitItems: ['outbound', 'enrichment', 'agentic'] }
const base = { firstName: 'Renee', branch: 'recruiting', title: 'Recruiter', company: 'Engine', roleTitle: 'GTM Engineer', fitTrack: 'gtm_eng', note }

describe('researched recruiter messages (owner, 2026-11-23)', () => {
  it('LinkedIn: hook, inbox line when there is an email, fit line from the bank', () => {
    const t = afterAcceptMessage({ ...base, research, hasEmail: true }).text
    expect(t).toBe(
      "Thanks for connecting, Renee! I applied to the GTM Engineer role and sent a short note to your inbox too. I enjoyed your post on rebuilding the booking agent, and I think my experience in building outbound systems end to end, data enrichment in Clay, Apify and Exa, and agentic workflows with Claude Code and MCP lines up well. Thank you for considering me!"
    )
    expect(afterAcceptProblems(t, note, 'Engine')).toEqual([])
  })
  it('LinkedIn: no hook drops the hook; no email drops the inbox line', () => {
    const t = afterAcceptMessage({ ...base, research: { ...research, hookShort: null, hookSentence: null }, hasEmail: false }).text
    expect(t).toBe("Thanks for connecting, Renee! I applied to the GTM Engineer role. I think my experience in building outbound systems end to end, data enrichment in Clay, Apify and Exa, and agentic workflows with Claude Code and MCP lines up well. Thank you for considering me!")
    expect(afterAcceptProblems(t, note, 'Engine')).toEqual([])
  })
  it('email: subject, template paragraphs and line breaks; no hook drops that paragraph', () => {
    const e = afterAcceptEmail({ ...base, research })!
    expect(e.subject).toBe('Thank you! - GTM Engineer')
    expect(e.body).toBe(
      "Hi Renee,\n\nI hope you're having a great week! I recently applied to the GTM Engineer role at Engine and wanted to reach out directly to say how excited I am about it.\n\n" +
        `${research.hookSentence}\n\n` +
        'I think the role is a strong fit for my experience in building outbound systems end to end (signals, enrichment, scoring, routing, sequencing), data enrichment pipelines in Clay, Apify and Exa, and agentic workflows with Claude Code and MCP.\n\n' +
        'Thank you in advance for your consideration!\n\nBest,\nConrad'
    )
    expect(afterAcceptEmailProblems(e, 'Engine')).toEqual([])
    const n = afterAcceptEmail({ ...base, research: { ...research, hookSentence: null, hookShort: null } })!
    expect(n.body).not.toContain('booking agent')
    expect(afterAcceptEmailProblems(n, 'Engine')).toEqual([])
    expect(afterAcceptEmailProblems({ ...e, body: e.body.replace('Thank you in advance', 'We booked 40 meetings. Thank you in advance') }, 'Engine').join()).toMatch(/numbers/)
  })
  it('job posters get the recruiter messages; leaders, founders and alumni do not', () => {
    expect(afterAcceptTrack('poster')).toBe('recruiter')
    expect(afterAcceptEmail({ ...base, branch: 'gtm_leadership', title: 'VP Sales', research })).toBeNull()
    expect(afterAcceptEmail({ ...base, branch: 'alumni', research })).toBeNull()
    expect(afterAcceptMessage({ ...base, branch: 'gtm_leadership', title: 'VP Sales', research }).text).toMatch(/^Thanks for connecting, Renee\.\n/)
  })
  it('without research, recruiters keep the bulleted message', () => {
    expect(afterAcceptMessage({ ...base, research: null }).text).toContain('Quick background:')
  })
  it('the fit line takes exactly three distinct bank items', () => {
    expect(fitPhrase(['outbound', 'code', 'outreach'], 'linkedin')).toBe('building outbound systems end to end, Python, SQL and TypeScript, and cold outreach that converts')
    expect(fitPhrase(['outbound', 'code'], 'email')).toBeNull()
    expect(fitPhrase(['outbound', 'outbound', 'code'], 'email')).toBeNull()
    expect(fitProblems(['outbound', 'cooking', 'code']).join()).toMatch(/outside the bank/)
    expect(joinItems(['a', 'b', 'c'])).toBe('a, b and c')
  })
})

describe('research checks', () => {
  const now = new Date('2026-11-23T00:00:00Z')
  const item = (over: Partial<SourceItem>): SourceItem => ({ url: 'https://engine.com/blog/agent', title: 'Rebuilding our agent', publishedDate: '2026-09-01', text: 'x', kind: 'company', ...over })
  it('only dated items from the last 12 months, never job boards, aggregators or careers pages', () => {
    const kept = usableSources(
      [
        item({}),
        item({ url: 'https://engine.com/blog/old', publishedDate: '2025-10-01' }),
        item({ url: 'https://engine.com/blog/nodate', publishedDate: null }),
        item({ url: 'https://www.linkedin.com/posts/x' }),
        item({ url: 'https://www.crunchbase.com/organization/engine' }),
        item({ url: 'https://engine.com/careers/gtm' }),
        item({ url: 'https://techcrunch.com/2026/10/01/engine-raises', kind: 'press' }),
      ],
      now
    )
    expect(kept.map((k) => k.url)).toEqual(['https://engine.com/blog/agent', 'https://techcrunch.com/2026/10/01/engine-raises'])
    expect(domainOf('https://www.engine.com/x')).toBe('engine.com')
  })
  it('hook sentences: first person, word limits, no numbers, nothing generic', () => {
    expect(hookProblems(research.hookSentence, research.hookShort, 'Engine')).toEqual([])
    expect(hookProblems('Your mission to change travel really resonates with me.', 'I love your mission', 'Engine').join()).toMatch(/generic/)
    expect(hookProblems('I saw you raised a $40M Series B and grew to 300 people.', 'I saw the $40M raise', 'Engine').join()).toMatch(/number/)
    expect(hookProblems(`I ${'really '.repeat(40)}liked it.`, 'I liked it', 'Engine').join()).toMatch(/35 words/)
    expect(hookProblems('The launch looked strong.', 'The launch looked strong', 'Engine').join()).toMatch(/first person/)
  })
  it('the record keeps only a source the search returned; a failed check empties the hook, never invents one', () => {
    const items = [item({})]
    const ok = toRecord({ hook_index: 0, why_no_hook: null, hook_summary: 'Post on the booking agent', hook_sentence: research.hookSentence, hook_short: research.hookShort + '.', fit_items: research.fitItems }, items, 'Engine', 0.04)
    expect(ok).toMatchObject({ hook_source_url: 'https://engine.com/blog/agent', hook_date: '2026-09-01', hook_short: research.hookShort, fit_items: research.fitItems })
    const bad = toRecord({ hook_index: 5, why_no_hook: null, hook_summary: null, hook_sentence: 'I liked it.', hook_short: 'I liked it', fit_items: research.fitItems }, items, 'Engine', 0.04)
    expect(bad.hook_sentence).toBeNull()
    const generic = toRecord({ hook_index: 0, why_no_hook: null, hook_summary: null, hook_sentence: 'I love your mission.', hook_short: 'I love your mission', fit_items: research.fitItems }, items, 'Engine', 0.04)
    expect(generic.hook_sentence).toBeNull()
    expect(generic.why_no_hook).toMatch(/generic/)
    expect(generic.fit_items).toEqual(research.fitItems)
  })
})

describe('review gate and export', () => {
  it('recruiters and posters at a company with an unread hook are gated; others are not', () => {
    const unread = new Set(['engine'])
    expect(hookGated({ branch: 'recruiting', company_key: 'engine' }, unread)).toBe(true)
    expect(hookGated({ branch: 'poster', company_key: 'engine' }, unread)).toBe(true)
    expect(hookGated({ branch: 'gtm_leadership', company_key: 'engine' }, unread)).toBe(false)
    expect(hookGated({ branch: 'recruiting', company_key: 'acme' }, unread)).toBe(false)
  })
  it('unread-hook rows are held out of the file and listed', () => {
    const c = (id: number, over: Partial<ExportCandidate> = {}): ExportCandidate => ({ id, status: 'approved', tier: 1, order: id, url: `https://linkedin.com/in/p${id}`, name: `P${id}`, company: 'Acme', ...over })
    const r = pickForExport([c(1), c(2, { hookUnread: true }), c(3, { applyFirst: true, hookUnread: true })], { tiers: [1], includeExported: false, limit: null })
    expect(r.chosen.map((x) => x.id)).toEqual([1])
    expect(r.hookUnread.map((x) => x.id)).toEqual([2])
    expect(r.applyFirst.map((x) => x.id)).toEqual([3])
  })
  it('the email body keeps its line breaks in the CSV', () => {
    const row = Object.fromEntries(EXPORT_COLUMNS.map((c) => [c.key, ''])) as ExportRow
    const body = 'Hi Ann,\n\nThanks.\n\nBest,\nConrad'
    const parsed = parseCsv(toCsv([{ ...row, linkedin_url: 'https://www.linkedin.com/in/ann', email: 'ann@acme.com', email_subject: 'Thank you! - GTM Engineer', email_body: body }]))
    expect(parsed[1][EXPORT_COLUMNS.findIndex((c) => c.key === 'email_body')]).toBe(body)
    expect(parsed[0]).toContain('email_subject')
  })
})
