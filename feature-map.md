# Feature map

What the job hunt app does, where each part lives, how to check it and what
good looks like. The verify-app reviewer (`.claude/agents/verify-app.md`) reads
this to decide which checks a change needs. Built from the code on 2026-11-24;
anything marked **(guess)** was not confirmed by a test or a run.

Repo-wide checks (all pass on `main` as of 2026-11-24):

| Command | What it covers | Time |
|---|---|---|
| `npm run lint` | ESLint (next/core-web-vitals, next/typescript) | ~4s |
| `npm run typecheck` | `tsc --noEmit` over every `.ts` / `.tsx` | ~7s |
| `npm test` | Vitest, `tests/**/*.test.ts`: 234 pass, 4 skipped (the live classifier tests need `ANTHROPIC_API_KEY` and spend money; leave them skipped) | ~3s |
| `npx tsx .claude/hooks/owner-rules.ts` | Conrad's stated rules, pinned (see the last section) | ~1s |
| `npm run build` | Next.js build; works without env vars | ~26s |

Nothing here may be checked against the live app: no `npm run sync / people /
drafts / weekly ...` (they read `.env.local`, call paid APIs and write the
`job-hunt` Supabase project).

---

## 1. Sheet sync

- **Where:** `lib/jobs/csv.ts`, `lib/jobs/normalize.ts`, `lib/jobs/sync.ts`; `scripts/sync.ts`; `app/api/jobs/sync/route.ts` ("Sync from sheet" button).
- **Test:** `npx vitest run tests/jobs/normalize.test.ts`
- **Good:** the "Jobs Final" sheet is only ever read (public CSV export). New rows are inserted; existing rows (same company key + normalized link) only get sheet facts refreshed, never status, notes or liveness. Rows dedupe on company + link key; LinkedIn tracking params collapse; a CSV that isn't Jobs Final is rejected.

## 2. Posting check (liveness, description, department)

- **Where:** `lib/jobs/enrich.ts`, `lib/jobs/fetch.ts`; `scripts/enrich-jobs.ts`.
- **Test:** none offline **(guess: covered only by running it live, which the reviewer must not do)**. Typecheck is the only automated check.
- **Good:** free (public job boards and LinkedIn's public job page), marks each job live / dead / unchecked, fills a missing description and department.

## 3. Classification, fit flags and tiers

- **Where:** `lib/jobs/classify.ts`, `classifyOne.ts`, `categories.ts`, `titleGuess.ts`, `fit.ts`; constraints in `lib/profile.ts`; `scripts/classify-jobs.ts`, `apply-selection.ts`, `split-sales.ts`.
- **Test:** `npx vitest run tests/jobs/classify.test.ts` (fixtures in `tests/fixtures/postings/`).
- **Good:** tracks are GTM Eng (tier 1), SDR/BDR (tier 2), RevOps (tier 3, warns); everything else blocks. Senior/director, a start before March 2027, AEs, closed postings and staffing agencies block. NYC roles sort first. A low-confidence "GTM Engineer" classified RevOps warns, never blocks. Regression postings (Formance AE, ElevenLabs growth eng) keep their outcomes.

## 4. People finder

- **Where:** `lib/people/*` (`find.ts`, `targets.ts`, `parse.ts`, `size.ts`, `companies.ts`, `exa.ts`); `scripts/find-people.ts`; `app/api/people/find/route.ts`.
- **Test:** `npx vitest run tests/people/people.test.ts tests/people/routing.test.ts`
- **Good:** Blockchain @ UCLA first, then UCLA alumni, then the track's chain (sales/GTM by size band, or the engineering chain). One person in one branch, at most 3 per branch (`CAP_PER_BRANCH`). Only people at the company now. Leadership recruiters dropped unless the role is director-level. Exa calls cost money: only behind a confirmed request or the capped weekly run.

## 5. Who gets drafted

- **Where:** `lib/drafts/targets.ts`, `lib/drafts/proof.ts`.
- **Test:** `npx vitest run tests/people/drafts.test.ts`
- **Good:** per company only the top alum and the top recruiter are drafted; at SDR companies the top sales leader or founder replaces the recruiter (a recruiter whose note exists keeps it). Proof point per person follows the owner's order (partner companies first; recruiters at GTM Eng get systems; crypto/fintech get Kalshi; never Coinbase to a recruiter).

## 6. Connection notes and their code checks

- **Where:** `lib/drafts/prompt.ts` (`draftProblems`, `draftWarnings`, `recruiterClose`, `similarity`, `hasMetric`), `lib/drafts/check.ts` (`noteProblems`, `approveNotes`), `lib/drafts/generate.ts`, `lib/drafts/run.ts`; limits in `lib/profile.ts`.
- **Test:** `npx vitest run tests/people/drafts.test.ts tests/mcp/write.test.ts` and `npx tsx .claude/hooks/owner-rules.ts`
- **Good:** one function (`draftProblems`) is the check for the page's Edit and Approve, bulk approve and the MCP tools. A note is refused when:
  - it is over **250** characters (`PROFILE.noteLimit`); 231 to 250 saves with a warning (`noteSoftLimit` 230);
  - a recruiter (or SDR leader) note doesn't end exactly `Interested in the {role} role at {company}. Open to connecting?` or lacks `graduating March 2027`;
  - it is too close to a colleague's note at the same company (word-trigram overlap over `MAX_SIMILARITY` 0.35);
  - it states or implies a number, a frequency/volume claim, revenue or funding;
  - it uses an internal name (Lume, Kaspen), asks more than one question, names a second proof point, says "clients/customers" for club partners, or implies Conrad worked at a partner;
  - a Kalshi note doesn't say "sourced and closed".

  The generator retries up to 3 times with the specific problem; editing an Approved note moves it back to Drafted.

## 7. After-accept messages

- **Where:** `lib/drafts/afterAccept.ts` (templates, `afterAcceptProblems`, `afterAcceptEmailProblems`), `lib/drafts/recruiterFollowups.ts`; `scripts/recruiter-followups.ts`.
- **Test:** `npx vitest run tests/people/afterAccept.test.ts`
- **Good:** fixed templates per persona, no model call. Alum → Bruin track; recruiter → bullets and the scope question (only goes out once the role is Applied); sales leader/founder → write-up message. Caps: 300 characters (recruiter 550). Every template output passes its own checks; no numbers outside approved bullets.

## 8. Company research, hooks and the review gate

- **Where:** `lib/research/*` (`research.ts`, `write.ts`, `bank.ts`, `gate.ts`, `store.ts`, `blitz.ts`); `components/pipeline/HookPanel.tsx`; `app/api/companies/[key]/research/route.ts`; `scripts/research.ts`, `write-hooks.ts`, `revalidate-hooks.ts`.
- **Test:** `npx vitest run tests/research/research.test.ts`
- **Good:** hooks come from GTM leaders' content dated within 12 months, the quote must be in the source, no headline numbers; a candidate that fails keeps no wording (never patched); at most three. Recruiters and posters at a company whose hook isn't ticked "I've read this" can't be approved or exported.

## 9. Export CSV and sender results import

- **Where:** `lib/export/run.ts`, `csv.ts`, `columns.ts`; `components/pipeline/ExportPanel.tsx`; `app/api/export/route.ts`, `app/api/import/route.ts`; `scripts/export-csv.ts`.
- **Test:** `npx vitest run tests/export/export.test.ts`
- **Good:** only Approved people, never Drafted or Sent; already Exported left out unless asked; `linkedin_url` column first and canonical; notes on one line, after-accept keeps line breaks; notes over the hard limit and unreviewed-hook rows are held out and listed. Import never moves a status backwards. Nothing is sent: the file goes to Conrad.

## 10. Pipeline page and filters

- **Where:** `app/(app)/page.tsx`, `jobs/`, `companies/`; `components/pipeline/PipelineScreen.tsx`; `lib/pipeline/filters.ts`, `load.ts`.
- **Test:** `npx vitest run tests/pipeline/filters.test.ts`, plus `npm run build` for UI changes.
- **Good:** each chip's count is how many rows show if it were clicked, given every other filter; tier chips sum to the tier count; no impossible combinations (Blocked switches Passes to All). UI rendering itself is not tested **(guess: only checkable by running the app signed in)**.

## 11. Requests from Claude (pending actions)

- **Where:** `lib/actions/pending.ts`, `lib/actions/requests.ts`; `components/pipeline/RequestsPanel.tsx`; `app/api/actions/[id]/route.ts`.
- **Test:** `npx vitest run tests/mcp/write.test.ts` and the owner-rules script.
- **Good:** only `find_people`, `draft_notes`, `export_csv` can be filed; they act only after Conrad presses Confirm; awaiting → running → done/failed, conditionally, so each runs once; unconfirmed ones expire after a day.

## 12. MCP server

- **Where:** `lib/mcp/*`, `app/api/mcp/route.ts`; doc `docs/MCP.md`.
- **Test:** `npx vitest run tests/mcp`
- **Good:** exactly 13 `jobhunt_` tools; bearer token compared in constant time, fails closed under 32 chars; rate limits 60 reads/min, 20 writes/min, 10 requests/hour; third-party text wrapped `{"untrusted": ...}`; emails never returned; secrets redacted; no tool sends a message, touches LinkedIn or calls the sender; write tools run the same note checks as the page.

## 13. Weekly Tuesday run and Telegram summary

- **Where:** `lib/weekly/run.ts`; `app/api/cron/weekly/route.ts`; `vercel.json` (crons 15:00 and 16:00 UTC Tuesdays); `scripts/weekly.ts`.
- **Test:** `npx vitest run tests/weekly`
- **Good:** fires 8am Pacific Tuesdays through daylight saving, never two runs in 20 hours; paid steps stop at the **$5** weekly cap; searches and drafts tiers 1 and 2 only (RevOps manual); nothing approved, exported or sent; cron route 401s without the secret; Telegram refuses to send when not configured.

## 14. Sign-in and access

- **Where:** `middleware.ts`, `lib/auth/*` (`isOwner`, `accessKey`, `requireOwner`, `session`), `app/login/`, `app/auth/callback/`, `app/api/auth/*`, `app/k/[key]/route.ts`.
- **Test:** `npx vitest run tests/jobs/normalize.test.ts` (access key) and `tests/mcp/auth.test.ts`. `isOwner` and the middleware have no test **(guess: behaviour read from code only)**.
- **Good:** single owner by magic link to `ALLOWED_EMAIL`; fails closed when unset; `/k/<ACCESS_KEY>` only with a key of 24+ characters; APIs get 401/403 JSON, pages redirect to `/login`.

## 15. Database migrations

- **Where:** `supabase/migrations/` (project `job-hunt`).
- **Test:** none in this repo (no pgTAP, no local Supabase). The Stop hook refuses edits to a migration that is already on main.
- **Good:** schema changes are new migration files; applied ones are never edited.

---

## Owner rules pinned in `.claude/hooks/owner-rules.ts`

Run on every Stop with changes. Change one only when Conrad asks; add one when
he has had to say something twice.

- Note limits 250 hard / 230 soft; a 251-character note is refused.
- Recruiter notes end exactly `Interested in the {role} role at {company}. Open to connecting?`
- Graduation line `graduating March 2027`.
- Kalshi notes say "sourced and closed".
- Notes too close to a colleague's at the same company are refused (similarity ≤ 0.35).
- No numbers, no internal names (Lume, Kaspen), one question.
- Claude can only file `find_people`, `draft_notes`, `export_csv` requests (nothing sends).
- Weekly run: $5 cap, RevOps never automatic.
