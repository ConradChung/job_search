/**
 * Hard checks: rules Conrad has stated (most more than once), pinned outside
 * tests/ so a session can't loosen them by editing a test next to the code.
 * Run by .claude/hooks/require-checks.sh on every Stop with changes:
 *   npx tsx .claude/hooks/owner-rules.ts
 * Pure code only: no network, no database, no spend.
 *
 * Add a rule here when Conrad has had to say something twice.
 * Change a rule here only when Conrad asks for that change.
 */
import { draftProblems, MAX_SIMILARITY, recruiterClose, GRAD_LINE, INTERNAL_NAMES, type DraftContext } from '@/lib/drafts/prompt'
import { PROFILE } from '@/lib/profile'
import { ACTION_KINDS } from '@/lib/actions/pending'
import { WEEKLY } from '@/lib/weekly/run'

const failures: string[] = []
function check(rule: string, ok: boolean) {
  if (!ok) failures.push(rule)
}

const alum: DraftContext = {
  firstName: 'Sam',
  title: 'Account Executive',
  branch: 'alumni',
  company: 'Acme',
  roleTitle: 'GTM Engineer',
  mentionRole: true,
  proof: { key: 'systems', why: 'owner-rules' },
  allowTools: true,
  siblings: [],
  limit: PROFILE.noteLimit,
}
const recruiter: DraftContext = { ...alum, branch: 'recruiting', title: 'Recruiter', allowTools: false }

// Note length (2026-11-23): 250 hard, 230 soft.
check('Connection note hard limit is 250 characters (PROFILE.noteLimit)', PROFILE.noteLimit === 250)
check('Connection note soft limit is 230 characters (PROFILE.noteSoftLimit)', PROFILE.noteSoftLimit === 230)
check('A 251-character note is refused', draftProblems('x'.repeat(251), alum).some((p) => /limit is 250/.test(p)))

// Recruiter notes end word for word (2026-11-23).
check(
  'Recruiter notes end exactly "Interested in the {role} role at {company}. Open to connecting?"',
  recruiterClose({ roleTitle: 'GTM Engineer', company: 'Acme, Inc.' }) === 'Interested in the GTM Engineer role at Acme. Open to connecting?'
)
const goodRecruiter = "Hi Dana, I'm Conrad at UCLA, graduating March 2027. I build outbound lead pipelines for two startups I co-founded. Interested in the GTM Engineer role at Acme. Open to connecting?"
check('A correct recruiter note passes every check', draftProblems(goodRecruiter, recruiter).length === 0)
check(
  'A recruiter note with any other ending is refused',
  draftProblems("Hi Dana, I'm Conrad at UCLA, graduating March 2027. I build outbound lead pipelines. Is the GTM Engineer role at Acme open to a March grad?", recruiter).some((p) => /End with exactly/.test(p))
)

// Graduation line.
check('Graduation line is "graduating March 2027"', GRAD_LINE === 'graduating March 2027')
check('"class of March 2027" is refused', draftProblems('Hi Sam, class of March 2027.', alum).length > 0)

// Kalshi: "sourced and closed" (2026-11-23).
const kalshi: DraftContext = { ...alum, proof: { key: 'kalshi', why: 'owner-rules' } }
check('A Kalshi note without "sourced and closed" is refused', draftProblems('Hi Sam, fellow Bruin here. I landed our club partnership with Kalshi. Open to a chat?', kalshi).some((p) => /sourced and closed/.test(p)))

// Notes too close to a colleague's at the same company are refused.
check('Similarity limit is no looser than 0.35', MAX_SIMILARITY <= 0.35)
const a = 'Hi Gabe, fellow Bruin here. I build GTM systems end to end, including my own outbound command center. Would you be up for a quick chat?'
const b = 'Hi Bhargavi, fellow Bruin here. I build GTM systems end to end, including my own outbound command center. Would you be open to a chat?'
check('A note too close to a colleague note is refused', draftProblems(b, { ...alum, siblings: [a] }).some((p) => /too close/.test(p)))

// No numbers, no internal names, one ask.
check('Numbers (counts, money, rates) are refused', draftProblems('Hi Sam, I booked 40 meetings last month. Open to a chat?', alum).length > 0)
check('Internal names Lume and Kaspen are blocked', INTERNAL_NAMES.test('Lume') && INTERNAL_NAMES.test('Kaspen'))
check('More than one question is refused', draftProblems('Open to a quick chat? Or know who to ask?', alum).some((p) => /more than one question/.test(p)))

// Nothing sends: Claude can only file these three requests, which Conrad confirms.
check(
  'Pending actions are only find_people, draft_notes, export_csv (nothing sends)',
  JSON.stringify([...ACTION_KINDS].sort()) === JSON.stringify(['draft_notes', 'export_csv', 'find_people'])
)

// Weekly run: $5 cap, RevOps stays manual.
check('Weekly run cap is $5', WEEKLY.capUsd === 5)
check('Weekly run never searches or drafts RevOps on its own', !WEEKLY.autoTracks.includes('revops' as never))

if (failures.length) {
  console.error(`Owner rules broken (${failures.length}):`)
  for (const f of failures) console.error(`- ${f}`)
  process.exit(1)
}
console.log('Owner rules: all pass')
