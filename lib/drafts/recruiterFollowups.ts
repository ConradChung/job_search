import type { SupabaseClient } from '@supabase/supabase-js'
import { DraftSkipped, draftContext } from './run'
import { afterAcceptMessage, afterAcceptProblems } from './afterAccept'

export interface FollowupChange {
  id: number
  branch: string
  company: string
  full_name: string
  status: string
  note: string
  before: string | null
  after: string
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
    .select('id, company, full_name, branch, outreach_status, draft, followup')
    .in('branch', opts.branches ?? ['recruiting'])
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
    const after = afterAcceptMessage({ firstName: ctx.firstName, branch: ctx.branch, title: ctx.title, company: ctx.company, roleTitle: ctx.roleTitle, fitTrack: ctx.fitTrack, note: p.draft }).text
    if (after === p.followup) continue
    const problems = afterAcceptProblems(after, p.draft, ctx.company)
    changes.push({ id: p.id, branch: p.branch, company: p.company, full_name: p.full_name, status: p.outreach_status, note: p.draft, before: p.followup, after, problems })
    if (opts.write && !problems.length) {
      const { error: e } = await db.from('people').update({ followup: after }).eq('id', p.id)
      if (e) throw new Error(`save follow-up: ${e.message}`)
    }
  }
  return { total: data?.length ?? 0, changes, skipped }
}
