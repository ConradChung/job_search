import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchPosting } from './fetch'

export interface EnrichJob {
  id: number
  link: string
  description: string | null
}

/**
 * Fetch one posting and store what it says: live / closed / not checked, plus
 * department and a missing description. Free (public job boards and LinkedIn's
 * public job page). Shared by `npm run enrich` and the weekly run.
 */
export async function enrichOne(db: SupabaseClient, j: EnrichJob): Promise<'live' | 'dead' | 'unchecked'> {
  const r = await fetchPosting(j.link)
  const now = new Date().toISOString()
  const update: Record<string, unknown> = { fetched_at: now, fetch_error: r.error, liveness_checked_at: now }
  if (r.live === true) update.liveness = 'live'
  if (r.live === null) {
    update.liveness = 'unchecked'
    update.liveness_reason = r.error
  }
  if (r.live === false) {
    update.liveness = 'dead'
    update.liveness_reason = 'posting closed or removed'
  }
  if (r.department) update.department = r.department
  if (r.description && !j.description) {
    update.description = r.description
    update.description_source = r.source
  }
  await db.from('jobs').update(update).eq('id', j.id)
  return r.live === true ? 'live' : r.live === false ? 'dead' : 'unchecked'
}
