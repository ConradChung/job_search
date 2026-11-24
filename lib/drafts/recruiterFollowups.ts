import type { SupabaseClient } from '@supabase/supabase-js'
import { DraftSkipped, draftContext } from './run'
import { afterAcceptEmail, afterAcceptEmailProblems, afterAcceptMessage, afterAcceptProblems } from './afterAccept'

export interface FollowupChange {
  id: number
  branch: string
  company: string
  full_name: string
  status: string
  note: string
  before: string | null
  after: string
  email: { subject: string; body: string } | null
  problems: string[]
}

/**
 * Recruiter after-accept messages from the fixed template (owner, 2026-11-24).
 * No model call, no cost. Drafted / Approved only; the note is never changed.
 * Runs on demand and whenever a role's status changes (applied wording).
 */
export async function refreshRecruiterFollowups(db: SupabaseClient, opts: { companyKey?: string; write: boolean; branches?: string[] }) {
  let q = db
    .from('people')
    .select('id, company, full_name, branch, outreach_status, draft, followup, email_subject, email_body')
    .in('branch', opts.branches ?? ['recruiting', 'poster'])
    .in('outreach_status', ['drafted', 'approved'])
    .not('draft', 'is', null)
    .order('company_key')
  if (opts.companyKey) q = q.eq('company_key', opts.companyKey)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const changes: FollowupChange[] = []
  const skipped: Record<string, number> = {}
  for (const p of data ?? []) {
    let loaded
    try {
      loaded = await draftContext(db, p.id)
    } catch (err) {
      if (err instanceof DraftSkipped) {
        skipped[err.message] = (skipped[err.message] ?? 0) + 1
        continue
      }
      throw err
    }
    if (!loaded) continue
    const { ctx } = loaded
    const input = { firstName: ctx.firstName, branch: ctx.branch, title: ctx.title, company: ctx.company, roleTitle: ctx.roleTitle, fitTrack: ctx.fitTrack, research: ctx.research, hasEmail: ctx.hasEmail, note: p.draft }
    const after = afterAcceptMessage(input).text
    const email = afterAcceptEmail(input)
    if (after === p.followup && (email?.subject ?? null) === p.email_subject && (email?.body ?? null) === p.email_body) continue
    const problems = [...afterAcceptProblems(after, p.draft, ctx.company), ...(email ? afterAcceptEmailProblems(email, ctx.company).map((x) => `email: ${x}`) : [])]
    changes.push({ id: p.id, branch: p.branch, company: p.company, full_name: p.full_name, status: p.outreach_status, note: p.draft, before: p.followup, after, email, problems })
    if (opts.write && !problems.length) {
      const { error: e } = await db.from('people').update({ followup: after, email_subject: email?.subject ?? null, email_body: email?.body ?? null }).eq('id', p.id)
      if (e) throw new Error(`save follow-up: ${e.message}`)
    }
  }
  return { total: data?.length ?? 0, changes, skipped }
}
