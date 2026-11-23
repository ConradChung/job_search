import type { SupabaseClient } from '@supabase/supabase-js'
import { generateDraft, type DraftClient } from './generate'
import { firstName, type DraftContext } from './prompt'

/** Context for one person: their row plus the company's best-fit open role. */
export async function draftContext(db: SupabaseClient, personId: number): Promise<{ ctx: DraftContext; status: string } | null> {
  const { data: p, error } = await db
    .from('people')
    .select('id, company_key, company, full_name, title, branch, is_ucla, size_band, outreach_status')
    .eq('id', personId)
    .maybeSingle()
  if (error) throw new Error(`load person: ${error.message}`)
  if (!p) return null
  const { data: roles } = await db
    .from('jobs')
    .select('title, fit_tier, posted_at')
    .eq('company_key', p.company_key)
    .neq('status', 'not_fit')
    .order('fit_tier', { ascending: true, nullsFirst: false })
    .order('posted_at', { ascending: false, nullsFirst: false })
    .limit(1)
  return {
    status: p.outreach_status,
    ctx: {
      firstName: firstName(p.full_name),
      title: p.title,
      branch: p.branch,
      isUcla: p.is_ucla,
      company: p.company,
      sizeBand: p.size_band,
      roleTitle: roles?.[0]?.title ?? null,
    },
  }
}

/**
 * Draft (or re-draft) one person's note and save it. Status moves from "none"
 * to "drafted"; any later status (approved, sent...) is left alone.
 */
export async function draftForPerson(db: SupabaseClient, client: DraftClient, personId: number) {
  const loaded = await draftContext(db, personId)
  if (!loaded) throw new Error(`person ${personId} not found`)
  const r = await generateDraft(client, loaded.ctx)
  const update: Record<string, unknown> = {
    draft: r.text,
    draft_generated_at: new Date().toISOString(),
    draft_model: r.model,
    draft_cost_usd: r.cost,
  }
  if (loaded.status === 'none') update.outreach_status = 'drafted'
  const { error } = await db.from('people').update(update).eq('id', personId)
  if (error) throw new Error(`save draft: ${error.message}`)
  return { ...r, personId }
}
