import { describe, expect, it } from 'vitest'
import { afterAcceptEmail, afterAcceptEmailProblems, afterAcceptMessage, afterAcceptProblems, afterAcceptTrack } from '@/lib/drafts/afterAccept'
import { fitPhrase, joinItems } from '@/lib/research/bank'
import { checkWording, conradSentenceProblems, hookSentenceProblems } from '@/lib/research/write'
import { attributionProblems, domainOf, fitProblems, groundingProblems, namedShows, highlightQuery, hookProblems, toCandidates, usableSources, type SourceItem } from '@/lib/research/research'
import { hookGated } from '@/lib/research/gate'
import { pickForExport, toCsv, parseCsv, type ExportCandidate } from '@/lib/export/csv'
import { EXPORT_COLUMNS, type ExportRow } from '@/lib/export/columns'

const note = "Hi Renee, I'm Conrad at UCLA, graduating March 2027. I built a full-stack GTM platform solo. Interested in the GTM Engineer role at Engine. Open to connecting?"
const research = {
  liHook: "I enjoyed Stevie Case's point that cold calling is Vanta's main pipeline source, with SDRs paired one to one with AEs.",
  liLink: "Most of my outbound so far has been email and LinkedIn, so I haven't done cold calling yet and it's the skill I most want to learn.",
  emailHook: "I really enjoyed Stevie Case's Operators Said episode, especially that cold calling is Vanta's main pipeline source. Learning to open conversations by phone is exactly what I want from an SDR role.",
  liNohook: 'Building outbound systems end to end, from signals to sequencing, is the work I most want to keep doing.',
  emailFit: 'I think the role is a good fit because I have built outbound systems end to end, written cold outreach that turned into Coinbase recruiting initiatives, and closed a partnership with Kalshi for Blockchain @ UCLA.',
}
const base = { firstName: 'Renee', branch: 'recruiting', title: 'Recruiter', company: 'Engine', roleTitle: 'GTM Engineer', fitTrack: 'gtm_eng', note }

describe('researched recruiter messages (owner, 2026-11-23, writing rules v3)', () => {
  it('LinkedIn: three short paragraphs, hook sentence then link sentence, no inbox line', () => {
    const t = afterAcceptMessage({ ...base, research, hasEmail: true }).text
    expect(t).toBe(`Thanks for connecting, Renee! I applied for the GTM Engineer role.\n\n${research.liHook} ${research.liLink}\n\nThanks for considering me!`)
    expect(t).not.toMatch(/inbox/)
    expect(afterAcceptProblems(t, note, 'Engine')).toEqual([])
  })
  it('LinkedIn: no hook uses the one-sentence fit line', () => {
    const t = afterAcceptMessage({ ...base, research: { ...research, liHook: null, liLink: null, emailHook: null } }).text
    expect(t).toBe(`Thanks for connecting, Renee! I applied for the GTM Engineer role.\n\n${research.liNohook}\n\nThanks for considering me!`)
    expect(afterAcceptProblems(t, note, 'Engine')).toEqual([])
  })
  it('LinkedIn checks: never "and my experience", never presume the job, three paragraphs', () => {
    const t = afterAcceptMessage({ ...base, research }).text
    expect(afterAcceptProblems(t.replace(research.liLink, ', and I think my experience in outbound lines up well.'), note, 'Engine').join()).toMatch(/"and"/)
    expect(afterAcceptProblems(t.replace(research.liLink, 'I would love to book meetings for my AE.'), note, 'Engine').join()).toMatch(/already has the job/)
    expect(afterAcceptProblems(t.replace('\n\nThanks for considering me!', ' Thanks for considering me!'), note, 'Engine').join()).toMatch(/Three short paragraphs/)
  })
  it('email: hook paragraph, written fit sentence, no hook drops that paragraph', () => {
    const e = afterAcceptEmail({ ...base, research })!
    expect(e.subject).toBe('Thank you! - GTM Engineer')
    expect(e.body).toBe(
      "Hi Renee,\n\nI hope you're having a great week! I recently applied to the GTM Engineer role at Engine and wanted to reach out directly to say how excited I am about it.\n\n" +
        `${research.emailHook}\n\n${research.emailFit}\n\nThank you in advance for your consideration!\n\nBest,\nConrad`
    )
    expect(afterAcceptEmailProblems(e, 'Engine')).toEqual([])
    const n = afterAcceptEmail({ ...base, research: { ...research, liHook: null, liLink: null, emailHook: null } })!
    expect(n.body).not.toContain('Stevie')
    expect(afterAcceptEmailProblems(n, 'Engine')).toEqual([])
    expect(afterAcceptEmailProblems({ ...e, body: e.body.replace(research.emailFit, 'I think the role is a strong fit for my experience in a, b and c.') }, 'Engine').join()).toMatch(/list of labels/)
    expect(afterAcceptEmailProblems({ ...e, body: e.body.replace('Thank you in advance', 'Happy to help my AE. Thank you in advance') }, 'Engine').join()).toMatch(/already has the job/)
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

describe('writing checks (rules v3)', () => {
  const names = ['Vanta', 'SDR', 'Stevie Case']
  it('link sentences: honest about cold calling, no tools or names outside the bank, one sentence, no presuming the job', () => {
    expect(conradSentenceProblems(research.liLink, names, 30)).toEqual([])
    expect(conradSentenceProblems('I have run cold calling blocks for two startups.', names, 30).join()).toMatch(/cold-calling|number/)
    expect(conradSentenceProblems('I built our Salesforce routing at ZenPort.', names, 30).join()).toMatch(/tool not in the bank|Names not in the bank/)
    expect(conradSentenceProblems('I wrote cold outreach that turned into Coinbase recruiting initiatives.', names, 30)).toEqual([])
    expect(conradSentenceProblems('And I like outbound. It is fun.', names, 30).join()).toMatch(/And|More than one/)
    expect(conradSentenceProblems('I want to book meetings for my AE.', names, 30).join()).toMatch(/already has the job/)
    expect(conradSentenceProblems('Most of my outbound has been email and LinkedIn, and I want to learn the phone.', names, 30)).toEqual([])
  })
  it('hook sentences: about the company only, one sentence on LinkedIn', () => {
    expect(hookSentenceProblems(research.liHook, 25, 1)).toEqual([])
    expect(hookSentenceProblems("I enjoyed Stevie's point on cold calling, and I've done a lot of it myself.", 25, 1).join()).toMatch(/claims experience/)
    expect(hookSentenceProblems('I liked it. Also this.', 25, 1).join()).toMatch(/sentence/)
  })
  it('a candidate whose wording fails keeps none (never patched)', () => {
    const cand = { url: 'u', title: 'Inside Vanta', date: null, kind: 'gtm_leader' as const, speaker: 'Stevie Case', speaker_title: 'CRO', idea: 'cold calling is the main source', evidence: 'x', role_clause: 'y', hook_sentence: "I enjoyed Stevie Case's Operators Said episode.", hook_short: 'w' }
    const out = {
      candidates: [
        { index: 0, li_hook: research.liHook, li_link: research.liLink, li_item: 'outreach' as const, email_hook: research.emailHook },
        { index: 1, li_hook: research.liHook, li_link: 'I have years of cold calling at Gong.', li_item: 'outreach' as const, email_hook: research.emailHook },
      ],
      li_nohook: research.liNohook,
      li_nohook_item: 'outbound' as const,
      email_fit: research.emailFit,
    }
    const r = checkWording(out, 'Vanta', 'Early Stage SDR', [cand, { ...cand, url: 'v' }])
    expect(r.perCandidate[0]).toMatchObject({ li_item: 'outreach' })
    expect(r.perCandidate[1]).toBeNull()
    expect(r.company?.email_fit).toBe(research.emailFit)
    expect(r.problems.join()).toMatch(/\[1\]/)
  })
})

describe('research checks (v2: role-relevant ideas)'
, () => {
  const now = new Date('2026-11-23T00:00:00Z')
  const body = 'Patrick Forquer on how Legora sells. We staff post-sale two to one against pre-sale, because expansion is where the account is won. Legal engineers run every pilot instead of solutions consultants.'
  const item = (over: Partial<SourceItem> = {}): SourceItem => ({ url: 'https://gtmnow.com/gtm-208-legora', title: 'How Legora scaled its direct sales motion', publishedDate: '2026-10-06', text: body, highlights: [], via: 'test', ...over })
  const pad = 'x'.repeat(400)
  it('dated within 12 months; podcasts, YouTube and LinkedIn posts allowed; job boards, databases, careers pages and thin pages not', () => {
    const kept = usableSources(
      [
        item({ text: body + pad }),
        item({ url: 'https://www.youtube.com/watch?v=pGvBQcaiYjk', text: pad }),
        item({ url: 'https://www.linkedin.com/posts/patrick_x', text: pad }),
        item({ url: 'https://www.linkedin.com/in/patrick', text: pad }),
        item({ url: 'https://gtmnow.com/old', publishedDate: '2025-10-01', text: pad }),
        item({ url: 'https://gtmnow.com/nodate', publishedDate: null, text: pad }),
        item({ url: 'https://www.crunchbase.com/organization/legora', text: pad }),
        item({ url: 'https://legora.com/careers/gtm', text: pad }),
        item({ url: 'https://legora.com/blog/thin', text: 'short' }),
      ],
      now
    )
    expect(kept.map((k) => k.url)).toEqual(['https://gtmnow.com/gtm-208-legora', 'https://www.youtube.com/watch?v=pGvBQcaiYjk', 'https://www.linkedin.com/posts/patrick_x'])
    expect(domainOf('https://www.engine.com/x')).toBe('engine.com')
  })
  it("the owner's worked example passes the hook checks", () => {
    expect(
      hookProblems(
        "I really enjoyed Patrick Forquer's GTMnow episode, especially that Legora staffs post-sale two to one against pre-sale. Building the systems behind a motion that customer-heavy is exactly the work I want to do.",
        "Loved Patrick Forquer's GTMnow episode on the two-to-one post-sale model",
        'Legora'
      )
    ).toEqual([])
  })
  it('hooks: no numbers or headline growth, nothing generic, first person, word and sentence limits', () => {
    expect(hookProblems('Your mission to change law really resonates with me.', 'I love your mission', 'Legora').join()).toMatch(/generic/)
    expect(hookProblems('I enjoyed hearing how you went from $3.5M to $200M ARR.', 'Loved the ARR story', 'Legora').join()).toMatch(/number|headline/)
    expect(hookProblems('I enjoyed hearing about the Series B and how you raised it.', 'Loved the raise', 'Legora').join()).toMatch(/headline/)
    expect(hookProblems(`I ${'really '.repeat(45)}liked it.`, 'I liked it', 'Legora').join()).toMatch(/45 words/)
    expect(hookProblems('I liked it. It was good. I want this. Yes.', 'I liked it', 'Legora').join()).toMatch(/two sentences/)
    expect(hookProblems('The pilot model looked strong.', 'The pilot model', 'Legora').join()).toMatch(/not first person/)
  })
  it('the idea must come from the content: quote in the source, not the title restated, not a headline number', () => {
    const ok = { idea: 'Legora staffs post-sale two to one against pre-sale', evidence: 'We staff post-sale two to one against pre-sale' }
    expect(groundingProblems(ok, item(), ['Legora', 'Patrick Forquer'])).toEqual([])
    expect(groundingProblems({ ...ok, evidence: 'We staff post-sale three to one against pre-sale' }, item()).join()).toMatch(/not in the source/)
    expect(groundingProblems({ idea: 'Legora scaled its direct sales motion', evidence: 'Patrick Forquer on how Legora sells. We staff' }, item(), ['Legora']).join()).toMatch(/title alone/)
    expect(groundingProblems({ idea: 'Legora reached $200M ARR', evidence: ok.evidence }, item()).join()).toMatch(/headline/)
  })
  it('candidates: checked, failures dropped (never patched), GTM leaders ranked first, at most three', () => {
    const items = [item({ url: 'https://legora.com/blog/launch' }), item()]
    const good = (source_index: number, kind: 'gtm_leader' | 'launch') => ({
      source_index,
      kind,
      speaker: kind === 'gtm_leader' ? 'Patrick Forquer' : null,
      speaker_title: kind === 'gtm_leader' ? 'CRO' : null,
      idea: 'Legal engineers run every pilot instead of solutions consultants',
      evidence: 'Legal engineers run every pilot instead of solutions consultants',
      role_clause: 'pilots that need tight systems',
      hook_sentence: "I enjoyed Patrick Forquer's episode, especially that legal engineers run every pilot. Building the systems that support pilots like that is the work I want to do.",
      hook_short: "Loved Patrick Forquer's take on legal engineers running every pilot.",
    })
    const { kept, rejected } = toCandidates(
      { candidates: [good(0, 'launch'), good(1, 'gtm_leader'), { ...good(1, 'gtm_leader'), evidence: 'made up quote that is not in the page at all' }, good(7, 'launch')] },
      items,
      'Legora'
    )
    expect(kept.map((k) => [k.kind, k.url])).toEqual([
      ['gtm_leader', 'https://gtmnow.com/gtm-208-legora'],
      ['launch', 'https://legora.com/blog/launch'],
    ])
    expect(kept[0].hook_short).toBe("Loved Patrick Forquer's take on legal engineers running every pilot")
    expect(rejected.join()).toMatch(/no such source/)
    expect(rejected.join()).toMatch(/not in the source|Same source/)
    expect(highlightQuery('SDR')).toMatch(/prospecting/)
    expect(highlightQuery('GTM Systems Engineer')).toMatch(/routing/)
  })
})

describe('attribution (pages often list other episodes)', () => {
  const page = { url: 'https://www.operatorssaid.com/episodes/418', title: "How I Built Legora's GTM Motion", text: `How I Built Legora's GTM Motion The Crew Podcast · 22 Jan 2026 with Patrick Forquer. ${'more notes '.repeat(60)} Also on this page: Vibescaling episode with someone else.`, highlights: [] }
  it('reads the show out of the hook', () => {
    expect(namedShows("I really enjoyed Patrick Forquer's GTMnow episode, especially")).toEqual(['GTMnow'])
    expect(namedShows("I enjoyed Stevie Case's Operators Said episode")).toEqual(['Operators Said'])
    expect(namedShows("Loved Charley DeBow's point on ticketing")).toEqual([])
  })
  it("a show named in the hook must be this page's own; the speaker must be in the source; the owner's link is trusted on show names", () => {
    expect(attributionProblems({ speaker: 'Patrick Forquer', hook_sentence: "Loved Patrick Forquer's Vibescaling episode", hook_short: 'x' }, page).join()).toMatch(/Vibescaling/)
    expect(attributionProblems({ speaker: 'Patrick Forquer', hook_sentence: "Loved Patrick Forquer's Crew Podcast episode", hook_short: "Loved Patrick Forquer's Operators Said episode" }, page)).toEqual([])
    expect(attributionProblems({ speaker: 'Louis Uguen', hook_sentence: "I enjoyed Louis Uguen's post", hook_short: 'x' }, page).join()).toMatch(/not in the source/)
    expect(attributionProblems({ speaker: 'Patrick Forquer', hook_sentence: "Loved Patrick Forquer's GTMnow episode", hook_short: 'x', kind: 'owner_link' }, page)).toEqual([])
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
