import type { SupabaseClient } from '@supabase/supabase-js'
import { PROFILE } from '@/lib/profile'
import { generateDraft, generateFollowup, type DraftClient } from './generate'
import { firstName, shortSdrTitle, type DraftContext } from './prompt'
import { companyFit, isSdr } from '@/lib/jobs/fit'
import { chooseProof } from './proof'
import { loadCompany } from '@/lib/people/run'
import { functionScore, TITLES } from '@/lib/people/targets'
import { trackOf } from '@/lib/jobs/categories'

/** SDR / BDR roles go in notes as "SDR" / "BDR" (a qualifier only when the company has several). */
export function noteRoleTitle(fit: ReturnType<typeof companyFit>, title: string | null): string | null {
  const role = fit.primary
  if (!title || !role || !isSdr(role)) return title
  const others = fit.ranked.filter((r) => r.role.id !== role.id && isSdr(r.role) && r.role.liveness !== 'dead').map((r) => r.role.title ?? '')
  return shortSdrTitle(title, others)
}

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
    .select('id, company_key, company, full_name, title, branch, outreach_status, email')
    .eq('id', personId)
    .maybeSingle()
  if (error) throw new Error(`load person: ${error.message}`)
  if (!p) return null

  const loaded = await loadCompany(db, p.company_key)
  if (!loaded) throw new DraftSkipped('no roles for this company')
  const { fit } = loaded
  if (fit.draftPaused) throw new DraftSkipped(`drafting is paused for the ${PROFILE.constraints.tracks[fit.track]?.label ?? fit.track} track`)
  if (!fit.canDraft) {
    throw new DraftSkipped(`fit flags: ${fit.flags.filter((f) => f.level === 'block').map((f) => f.message).join('; ')}`)
  }
  const role = fit.primary
  const { data: extra } = await db.from('jobs').select('title, status, crypto_or_fintech, description, raw').eq('id', role?.id ?? -1).maybeSingle()
  const { data: sibs } = await db.from('people').select('draft').eq('company_key', p.company_key).neq('id', personId).not('draft', 'is', null)
  const proof = chooseProof({
    company: p.company,
    category: role?.category ?? null,
    cryptoOrFintech: extra?.crypto_or_fintech ?? null,
    context: [(extra?.raw as Record<string, string> | null)?.industries, extra?.description].filter(Boolean).join('\n'),
    roleTitle: extra?.title ?? null,
    branch: p.branch,
    siblingCount: sibs?.length ?? 0,
    siblingTexts: (sibs ?? []).map((s) => s.draft as string),
  })
  if (!proof) throw new DraftSkipped('poor fit: nothing in the profile matches this role')

  const { data: rs } = await db.from('company_research').select('hook_sentence, li_hook, li_link, email_hook, li_nohook, email_fit').eq('company_key', p.company_key).maybeSingle()
  const ctx: DraftContext = {
    firstName: firstName(p.full_name),
    title: p.title,
    branch: p.branch,
    company: p.company,
    roleTitle: noteRoleTitle(fit, extra?.title ?? null),
    roleStatus: extra?.status ?? null,
    fitTrack: fit.track,
    // Written sentences (rules v3): a hook only when the chosen one has its wording; else the no-hook line.
    research: rs && ((rs.hook_sentence && rs.li_hook) || rs.li_nohook) ? { liHook: rs.hook_sentence ? rs.li_hook : null, liLink: rs.hook_sentence ? rs.li_link : null, emailHook: rs.hook_sentence ? rs.email_hook : null, liNohook: rs.li_nohook, emailFit: rs.email_fit } : null,
    hasEmail: !!p.email,
    sdrLeader: fit.track === 'sdr' && (p.branch === 'gtm_leadership' || p.branch === 'executive'),
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
  const f = await generateFollowup(client, loaded.ctx, r.text)
  const update: Record<string, unknown> = {
    draft: r.text,
    followup: f.text,
    email_subject: f.email?.subject ?? null,
    email_body: f.email?.body ?? null,
    draft_generated_at: new Date().toISOString(),
    draft_model: r.model,
    draft_cost_usd: r.cost + f.cost,
  }
  if (loaded.status === 'none') update.outreach_status = 'drafted'
  const { error } = await db.from('people').update(update).eq('id', personId)
  if (error) throw new Error(`save draft: ${error.message}`)
  return { ...r, cost: r.cost + f.cost, followup: f.text, problems: [...r.problems, ...f.problems.map((p) => `follow-up: ${p}`)], personId, proof: loaded.ctx.proof }
}

/** After-accept message only, for a note the owner already approved as written. */
export async function followupForPerson(db: SupabaseClient, client: DraftClient, personId: number) {
  const loaded = await draftContext(db, personId)
  if (!loaded) throw new Error(`person ${personId} not found`)
  const { data } = await db.from('people').select('draft').eq('id', personId).single()
  if (!data?.draft) throw new Error('no note to follow up')
  const f = await generateFollowup(client, loaded.ctx, data.draft)
  const { error } = await db.from('people').update({ followup: f.text, email_subject: f.email?.subject ?? null, email_body: f.email?.body ?? null }).eq('id', personId)
  if (error) throw new Error(`save follow-up: ${error.message}`)
  return f
}
