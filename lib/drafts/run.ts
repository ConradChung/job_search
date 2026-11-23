import type { SupabaseClient } from '@supabase/supabase-js'
import { PROFILE } from '@/lib/profile'
import { generateDraft, type DraftClient } from './generate'
import { firstName, type DraftContext } from './prompt'
import { chooseProof } from './proof'
import { loadCompany } from '@/lib/people/run'
import { functionScore, TITLES } from '@/lib/people/targets'
import { trackOf } from '@/lib/jobs/categories'

/** Drafting was skipped on purpose (fit flags, poor fit). Not an error. */
export class DraftSkipped extends Error {}

/**
 * Everything a note needs: the person, the company's primary role, the proof
 * point for that role, and the notes already written to their colleagues.
 * Throws DraftSkipped when the fit flags block drafting (and the owner hasn't
 * overridden them) or when no proof point honestly matches the role.
 */
export async function draftContext(db: SupabaseClient, personId: number) {
  const { data: p, error } = await db
    .from('people')
    .select('id, company_key, company, full_name, title, branch, outreach_status')
    .eq('id', personId)
    .maybeSingle()
  if (error) throw new Error(`load person: ${error.message}`)
  if (!p) return null

  const loaded = await loadCompany(db, p.company_key)
  if (!loaded) throw new DraftSkipped('no roles for this company')
  const { fit } = loaded
  if (!fit.canDraft) {
    throw new DraftSkipped(`fit flags: ${fit.flags.filter((f) => f.level === 'block').map((f) => f.message).join('; ')}`)
  }
  const role = fit.primary
  const { data: extra } = await db.from('jobs').select('title, crypto_or_fintech, description, raw').eq('id', role?.id ?? -1).maybeSingle()
  const { data: sibs } = await db.from('people').select('draft').eq('company_key', p.company_key).neq('id', personId).not('draft', 'is', null)
  const proof = chooseProof({
    company: p.company,
    category: role?.category ?? null,
    cryptoOrFintech: extra?.crypto_or_fintech ?? null,
    context: [(extra?.raw as Record<string, string> | null)?.industries, extra?.description].filter(Boolean).join('\n'),
    roleTitle: extra?.title ?? null,
    branch: p.branch,
    siblingCount: sibs?.length ?? 0,
  })
  if (!proof) throw new DraftSkipped('poor fit: nothing in the profile matches this role')

  const ctx: DraftContext = {
    firstName: firstName(p.full_name),
    title: p.title,
    branch: p.branch,
    company: p.company,
    roleTitle: extra?.title ?? null,
    mentionRole: functionScore(p.title ?? '', trackOf(role?.category)) === 2,
    allowTools:
      (p.branch === 'recruiting' && TITLES.technicalRecruiting.test(p.title ?? '')) ||
      ((p.branch === 'alumni' || p.branch === 'blockchain_ucla') && /engineer|developer|\bdata\b|software/i.test(p.title ?? '')),
    proof,
    siblings: (sibs ?? []).map((s) => s.draft as string),
    limit: PROFILE.noteLimit,
  }
  return { ctx, status: p.outreach_status as string }
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
  return { ...r, personId, proof: loaded.ctx.proof }
}
