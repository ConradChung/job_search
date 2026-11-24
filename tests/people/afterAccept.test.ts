import { describe, expect, it } from 'vitest'
import { afterAcceptMessage, afterAcceptProblems, afterAcceptTrack, cleanCompany, cleanRoleTitle, isOutboundRole, roleFromNote, AFTER_ACCEPT_MAX, RECRUITER_AFTER_ACCEPT_MAX, RECRUITER_BULLETS } from '@/lib/drafts/afterAccept'
import { companyFit } from '@/lib/jobs/fit'
import { pickForExport, type ExportCandidate } from '@/lib/export/csv'

const recNote = "Hi Renee, I'm Conrad at UCLA, graduating March 2027. I built a full-stack GTM platform solo. Interested in the Software Engineer - GTM Engineering role at Engine. Open to connecting?"
const alumNote = 'Erika! Fellow Bruin here, graduating March 2027. Would love to learn more about Engine and what the team does. Open to a quick coffee chat?'

describe('persona → template (owner, 2026-11-23)', () => {
  it('alumni get the Bruin track; recruiters, leaders and founders their own', () => {
    expect(afterAcceptTrack('alumni')).toBe('bruin')
    expect(afterAcceptTrack('blockchain_ucla')).toBe('bruin')
    expect(afterAcceptTrack('recruiting', 'Senior Recruiter')).toBe('recruiter')
    expect(afterAcceptTrack('gtm_leadership', 'VP Sales')).toBe('leader')
    expect(afterAcceptTrack('executive', 'Chief Revenue Officer (CRO)')).toBe('leader')
    expect(afterAcceptTrack('executive', 'Co-founder and CEO')).toBe('founder')
  })
  it("recruiter (Tier 1/3): the note's role wording, GTM bullets, quick-call close", () => {
    const r = afterAcceptMessage({ firstName: 'Renee', branch: 'recruiting', title: 'Recruiter', company: 'Engine', roleTitle: 'GTM Engineer', fitTrack: 'gtm_eng', note: recNote })
    expect(r.text).toBe(
      "Thanks for connecting, Renee. I've applied for the Software Engineer - GTM Engineering role at Engine.\n\nQuick background:\n" +
        "• GTM Engineering Head at ZenPort AI, where I'm the only GTM hire\n" +
        '• Built the outbound engine end to end: signals, enrichment, scoring, routing, sequencing\n' +
        '• Stack: Clay, Apify, Exa, Supabase, Instantly, Claude Code\n\n' +
        "If it looks like a fit, I'd love to set up a quick call."
    )
    expect(r.text).not.toMatch(/write-up|hiring manager/)
  })
  it('recruiter (Tier 2): SDR bullets; the events bullet replaces Kalshi when the note already says Kalshi', () => {
    const plain = "Hi Jo, I'm Conrad at UCLA, graduating March 2027. I run outbound for a startup. Interested in the SDR role at Vanta. Open to connecting?"
    const kalshi = "Hi Jo, I'm Conrad at UCLA, graduating March 2027. I sourced and closed a Kalshi partnership. Interested in the SDR role at Vanta. Open to connecting?"
    const a = afterAcceptMessage({ firstName: 'Jo', branch: 'recruiting', company: 'Vanta', roleTitle: 'SDR', fitTrack: 'sdr', note: plain }).text
    expect(a).toContain(`• ${RECRUITER_BULLETS.sdr[0]}\n• ${RECRUITER_BULLETS.sdr[1]}\n• ${RECRUITER_BULLETS.sdr[2]}`)
    const b = afterAcceptMessage({ firstName: 'Jo', branch: 'recruiting', company: 'Vanta', roleTitle: 'SDR', fitTrack: 'sdr', note: kalshi }).text
    expect(b).toContain(`• ${RECRUITER_BULLETS.sdrFallback}\n• ${RECRUITER_BULLETS.sdr[1]}`)
    expect(b).not.toMatch(/kalshi/i)
    for (const [t, n] of [[a, plain], [b, kalshi]]) {
      expect(t.length).toBeLessThanOrEqual(RECRUITER_AFTER_ACCEPT_MAX)
      expect(afterAcceptProblems(t, n, 'Vanta')).toEqual([])
    }
  })
  it('leaders and founders: the write-up message; Bruin: the 15-minute ask with the UCLA line', () => {
    const note = "Hi Mark, I'm Conrad at UCLA, graduating March 2027. I do the prospecting for two startups I co-founded. Interested in the SDR role at Hauler Hero. Open to connecting?"
    for (const [branch, title] of [['gtm_leadership', 'VP Sales'], ['executive', 'CEO']]) {
      const t = afterAcceptMessage({ firstName: 'Mark', branch, title, company: 'Hauler Hero Inc.', roleTitle: 'SDR', note }).text
      expect(t).toMatch(/^Thanks for connecting, Mark\.\nI've (been thinking about how I'd approach outbound to|been sketching how I'd run outbound to) Hauler Hero's ICP (in|from) the SDR seat\. Happy to send a short write-up, or walk you through it in 15 minutes, whichever is easier\.$/)
    }
    const b = afterAcceptMessage({ firstName: 'Erika', branch: 'alumni', company: 'Engine', roleTitle: null, note: alumNote }).text
    expect(b).toMatch(/^Thanks, Erika! (Would 15 minutes next week work\?|Could we find 15 minutes next week\?) I'd love to hear how you ended up at Engine after UCLA\.$/)
  })
  it('only says "outbound" for outbound roles (leaders and founders); recruiters get bullets either way', () => {
    const rec = afterAcceptMessage({ firstName: 'Sean', branch: 'recruiting', company: 'demandDrive', roleTitle: 'RevOps Engineer', fitTrack: 'revops' }).text
    expect(rec).toContain("I've applied for the RevOps Engineer role at demandDrive.\n\nQuick background:\n• GTM Engineering Head")
    const lead = afterAcceptMessage({ firstName: 'Ann', branch: 'gtm_leadership', title: 'VP Sales', company: 'Acme', roleTitle: 'GTM Systems Engineer' }).text
    expect(lead).toBe("Thanks for connecting, Ann.\nI've been thinking about how I'd approach the GTM Systems Engineer seat at Acme. Happy to send a short write-up, or walk you through it in 15 minutes, whichever is easier.")
    for (const r of ['GTM Engineer', 'AI GTM Engineer', 'Founding GTM Engineer', 'SDR', 'BDR', 'Early Stage SDR', 'GTM Automation Engineer']) expect(isOutboundRole(r)).toBe(true)
    for (const r of ['GTM Systems Engineer', 'GTM Analytics Engineer', 'GTM Operations Engineer', 'RevOps Engineer', 'GTM Systems Manager', 'Growth Engineer', 'Software Engineer']) expect(isOutboundRole(r)).toBe(false)
  })
  it('missing role or company: the 15-minute ask without the UCLA line', () => {
    const r = afterAcceptMessage({ firstName: 'Kim', branch: 'recruiting', company: null, roleTitle: null })
    expect(r.track).toBe('fallback')
    expect(r.text).toBe("Thanks, Kim! Would 15 minutes next week work? I'd love to hear how you got to where you are.")
  })
})

describe('role and company read naturally', () => {
  it('cleans role titles', () => {
    expect(cleanRoleTitle('Software Engineer - GTM Engineering')).toBe('GTM Engineer')
    expect(cleanRoleTitle('Growth Marketer / GTM Engineer')).toBe('GTM Engineer')
    expect(cleanRoleTitle('AI GTM Engineer (VIE, EU citizen)')).toBe('AI GTM Engineer')
    expect(cleanRoleTitle('GTM Engineer: Customer Experience & Lifecycle')).toBe('GTM Engineer')
    expect(cleanRoleTitle('Software Engineer, Growth Data Platform')).toBe('Software Engineer')
    expect(cleanRoleTitle('Go-to-Market Engineer - Remote')).toBe('GTM Engineer')
    expect(cleanRoleTitle('')).toBeNull()
  })
  it('the note\'s own "Interested in the X role at Y" line wins', () => {
    expect(roleFromNote(recNote)).toEqual({ role: 'Software Engineer - GTM Engineering', company: 'Engine' })
    expect(roleFromNote(alumNote)).toBeNull()
    expect(cleanCompany('Checkr, Inc.')).toBe('Checkr')
    expect(cleanCompany('Hauler Hero Inc.')).toBe('Hauler Hero')
  })
})

describe('after-accept code checks', () => {
  it('every template output passes', () => {
    const outs = [
      afterAcceptMessage({ firstName: 'Renee', branch: 'recruiting', company: 'Engine', roleTitle: null, note: recNote }).text,
      afterAcceptMessage({ firstName: 'Erika', branch: 'alumni', company: 'Engine', roleTitle: null, note: alumNote }).text,
      afterAcceptMessage({ firstName: 'Justin', branch: 'recruiting', company: '11x', roleTitle: 'Growth Engineer' }).text,
    ]
    for (const t of outs) {
      expect(t.length).toBeLessThan(RECRUITER_AFTER_ACCEPT_MAX)
      expect(afterAcceptProblems(t, recNote, '11x')).toEqual([])
    }
    expect(outs[1].length).toBeLessThan(AFTER_ACCEPT_MAX)
  })
  it('recruiter messages: only approved bullets, no write-up offer, no numbers outside the bullets', () => {
    const t = afterAcceptMessage({ firstName: 'Renee', branch: 'recruiting', company: 'Engine', roleTitle: null, fitTrack: 'gtm_eng', note: recNote }).text
    expect(afterAcceptProblems(t.replace('Stack: Clay', 'Booked 40 meetings with Clay'), recNote, 'Engine').join()).toMatch(/approved list/)
    expect(afterAcceptProblems(t.replace('quick call.', 'quick call. Happy to send a write-up for the hiring manager.'), recNote, 'Engine').join()).toMatch(/write-up/)
    expect(afterAcceptProblems(t.replace('Quick background', 'Booked 40 meetings. Quick background'), recNote, 'Engine').join()).toMatch(/numbers/)
    expect(afterAcceptProblems(`${t}\n${'x'.repeat(450)}`, recNote, 'Engine').join()).toMatch(/under 450/)
  })
  it('rejects the old failure modes', () => {
    expect(afterAcceptProblems('Thanks for connecting, Ann. Is a March 2027 grad in scope for the GTM Engineer role?').join()).toMatch(/graduation date.*in scope|in scope/)
    expect(afterAcceptProblems('Thanks, Ann. Beyond the outbound work, I built a platform. Open to a chat?', 'Hi Ann').join()).toMatch(/Refers back|did not say/)
    expect(afterAcceptProblems('Thanks, Ann. On top of the Kalshi partnership I mentioned, I build things.', 'Hi Ann').join()).toMatch(/kalshi/i)
    expect(afterAcceptProblems('Thanks, Ann. I can do a free audit of your outbound. Want it?').join()).toMatch(/vendor pitch/)
    expect(afterAcceptProblems('Thanks, Ann. One. Two. Three.').join()).toMatch(/two sentences/)
    expect(afterAcceptProblems(`Thanks, Ann. ${'x'.repeat(300)}`).join()).toMatch(/under 300/)
  })
})

describe('export hold-back and company holds', () => {
  const c = (id: number, applyFirst = false): ExportCandidate => ({ id, status: 'approved', tier: 1, order: id, url: `https://linkedin.com/in/p${id}`, name: `P${id}`, company: 'Acme', applyFirst })
  it('recruiters whose role is not Applied are held out of the file and listed', () => {
    const r = pickForExport([c(1), c(2, true), c(3), c(4, true)], { tiers: [1], includeExported: false, limit: 15 })
    expect(r.chosen.map((x) => x.id)).toEqual([1, 3])
    expect(r.applyFirst.map((x) => x.id)).toEqual([2, 4])
    expect(r.available).toBe(2)
  })
  it('a company hold blocks drafting and export, and beats an override', () => {
    const role = { id: 1, fit_tier: 1, title: 'SDR', category: 'sdr', category_confidence: 'high', seniority: 'entry', work_mode: 'onsite', work_locations: ['New York, NY'], start_requirement: 'unknown', start_date: null }
    const free = companyFit([role])
    expect(free.passes).toBe(true)
    const held = companyFit([role], true, undefined, 'excluded industry: healthcare')
    expect(held).toMatchObject({ passes: false, canDraft: false, override: false, hold: 'excluded industry: healthcare' })
    expect(held.flags[0]).toMatchObject({ code: 'hold', level: 'block', message: 'Held: excluded industry: healthcare' })
  })
})
