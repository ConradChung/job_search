import type { SupabaseClient } from '@supabase/supabase-js'
import { DraftSkipped, draftContext } from './run'
import { draftProblems } from './prompt'
import { hookGated, HOOK_GATE_MESSAGE, unreviewedHookCompanies } from '@/lib/research/gate'

/**
 * Every code check a note must pass (length, banned phrases, numbers, proof-point
 * rules, recruiter shape, closeness to colleagues' notes), with the same context
 * the generator uses. One place for the page's Edit and Approve, bulk approve and
 * the MCP tools. Returns [] when the note is fine.
 */
export async function noteProblems(db: SupabaseClient, personId: number, text: string): Promise<string[]> {
  let loaded
  try {
    loaded = await draftContext(db, personId)
  } catch (err) {
    if (err instanceof DraftSkipped) return [`This company can't take notes right now: ${err.message}.`]
    throw err
  }
  if (!loaded) return ['Person not found.']
  if (!text.trim()) return ['The note is empty.']
  return draftProblems(text.trim(), loaded.ctx)
}

export interface BulkApproveResult {
  approved: { id: number; name: string; company: string }[]
  refused: { id: number; name: string; company: string; problems: string[] }[]
  skipped: number
}

/** Drafted → Approved for these people, only where the note passes every check. Nothing is sent. */
export async function approveNotes(db: SupabaseClient, ids: number[]): Promise<BulkApproveResult> {
  const out: BulkApproveResult = { approved: [], refused: [], skipped: 0 }
  if (!ids.length) return out
  const { data, error } = await db.from('people').select('id, full_name, company, company_key, branch, outreach_status, draft').in('id', ids)
  if (error) throw new Error(error.message)
  const unreviewed = await unreviewedHookCompanies(db, (data ?? []).map((p) => p.company_key))
  for (const p of data ?? []) {
    if (p.outreach_status !== 'drafted' || !p.draft) {
      out.skipped++
      continue
    }
    if (hookGated(p, unreviewed)) {
      out.refused.push({ id: p.id, name: p.full_name, company: p.company, problems: [HOOK_GATE_MESSAGE] })
      continue
    }
    const problems = await noteProblems(db, p.id, p.draft)
    if (problems.length) {
      out.refused.push({ id: p.id, name: p.full_name, company: p.company, problems })
      continue
    }
    const { error: e } = await db.from('people').update({ outreach_status: 'approved' }).eq('id', p.id).eq('outreach_status', 'drafted')
    if (e) throw new Error(`approve: ${e.message}`)
    out.approved.push({ id: p.id, name: p.full_name, company: p.company })
  }
  return out
}
