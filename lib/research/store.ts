import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import { loadCompany } from '@/lib/people/run'
import { refreshRecruiterFollowups } from '@/lib/drafts/recruiterFollowups'
import { researchCompany, researchUrl, type HookCandidate, type ResearchInput, type ResearchResult } from './research'
import { writeWording } from './write'

/** The hook fields the messages read, from one candidate (or empty). */
export function hookFields(c: HookCandidate | null | undefined) {
  return {
    hook_source_url: c?.url ?? null,
    hook_title: c?.title ?? null,
    hook_date: c?.date ?? null,
    hook_summary: c ? `${c.speaker ? `${c.speaker}${c.speaker_title ? `, ${c.speaker_title}` : ''}: ` : ''}${c.idea}` : null,
    hook_sentence: c?.hook_sentence ?? null,
    hook_short: c?.hook_short ?? null,
    hook_speaker: c?.speaker ?? null,
    hook_idea: c?.idea ?? null,
    hook_role_clause: c?.role_clause ?? null,
    hook_kind: c?.kind ?? null,
    li_hook: c?.li_hook ?? null,
    li_link: c?.li_link ?? null,
    li_item: c?.li_item ?? null,
    email_hook: c?.email_hook ?? null,
  }
}

const usable = (c: HookCandidate | null | undefined) => !!c?.li_hook && !!c.li_link && !!c.email_hook

type Prev = { hook_source_url: string | null; hook_sentence: string | null; hook_reviewed_at: string | null } | null

/** A new or changed hook must be read again; the same hook keeps its tick. */
function reviewedAt(prev: Prev, next: HookCandidate | null | undefined): string | null {
  return prev && next && prev.hook_source_url === next.url && prev.hook_sentence === next.hook_sentence ? prev.hook_reviewed_at : null
}

/** Inputs for research from the company's primary role and its GTM people in the tracker. */
export async function researchInput(db: SupabaseClient, companyKey: string): Promise<{ input: ResearchInput; roleId: number } | null> {
  const loaded = await loadCompany(db, companyKey)
  const role = loaded?.fit.primary as { id: number; title?: string | null; company?: string; company_website?: string | null } | null | undefined
  if (!loaded || !role) return null
  const { data: job } = await db.from('jobs').select('title, company, company_website, description, raw').eq('id', role.id).maybeSingle()
  const { data: ppl } = await db.from('people').select('full_name, title, branch').eq('company_key', companyKey).in('branch', ['gtm_leadership', 'executive'])
  return {
    roleId: role.id,
    input: {
      company: (job?.company as string) ?? companyKey,
      website: (job?.company_website as string | null) ?? null,
      industries: ((job?.raw as Record<string, string> | null)?.industries ?? null) || null,
      roleTitle: (job?.title as string) ?? role.title ?? '',
      posting: (job?.description as string | null) ?? '',
      knownLeaders: (ppl ?? []).map((p) => ({ name: p.full_name as string, title: (p.title as string | null) ?? null })),
    },
  }
}

/** Save a research run: the top candidates, the first one chosen. */
export async function saveResearch(db: SupabaseClient, companyKey: string, roleId: number, r: ResearchResult) {
  const { data: prev } = await db.from('company_research').select('hook_source_url, hook_sentence, hook_reviewed_at, custom_url, hook_candidates').eq('company_key', companyKey).maybeSingle()
  // The owner's own link survives a re-run, at the front.
  const own = ((prev?.hook_candidates ?? []) as HookCandidate[]).filter((c) => c.kind === 'owner_link')
  const candidates = [...own, ...r.hook_candidates.filter((c) => !own.some((o) => o.url === c.url))].slice(0, own.length + 3)
  const chosen = candidates[0] ?? null
  const now = new Date().toISOString()
  const { error } = await db.from('company_research').upsert({
    company_key: companyKey,
    role_id: roleId,
    hook_candidates: candidates,
    chosen_index: chosen ? 0 : null,
    ...hookFields(chosen),
    hook_reviewed_at: reviewedAt(prev as Prev, chosen),
    fit_items: r.fit_items,
    why_no_hook: chosen ? null : r.why_no_hook,
    candidates: r.candidates,
    leaders: r.leaders,
    rejected: r.rejected,
    model: r.model,
    cost_usd: r.cost_usd,
    researched_at: now,
    updated_at: now,
  })
  if (error) throw new Error(`save research: ${error.message}`)
  return { candidates, chosen }
}

/** Owner picks a candidate (or null for no hook). Resets the tick when the hook changes, then rewrites the messages. */
export async function chooseCandidate(db: SupabaseClient, companyKey: string, index: number | null) {
  const { data: row, error } = await db.from('company_research').select('hook_candidates, hook_source_url, hook_sentence, hook_reviewed_at').eq('company_key', companyKey).maybeSingle()
  if (error) throw new Error(error.message)
  if (!row) throw new Error('no research for this company')
  const list = (row.hook_candidates ?? []) as HookCandidate[]
  if (index !== null && !list[index]) throw new Error('no such candidate')
  if (index !== null && !usable(list[index])) throw new Error('That candidate failed the writing checks; pick another or paste a link.')
  const c = index === null ? null : list[index]
  const { error: e } = await db
    .from('company_research')
    .update({ chosen_index: index, ...hookFields(c), hook_reviewed_at: reviewedAt(row as Prev, c), why_no_hook: c ? null : 'Owner chose no hook.', updated_at: new Date().toISOString() })
    .eq('company_key', companyKey)
  if (e) throw new Error(e.message)
  return refreshRecruiterFollowups(db, { companyKey, write: true })
}

/** Owner's own link: research it, put it first and choose it. */
export async function applyOwnLink(db: SupabaseClient, client: Anthropic, companyKey: string, url: string) {
  const ri = await researchInput(db, companyKey)
  if (!ri) throw new Error('no role for this company')
  const r = await researchUrl(client, ri.input, url)
  if (!r.candidate) return { ok: false as const, problems: r.problems, cost: r.cost }
  const { data: row } = await db.from('company_research').select('hook_candidates').eq('company_key', companyKey).maybeSingle()
  const rest = ((row?.hook_candidates ?? []) as HookCandidate[]).filter((c) => c.url !== r.candidate!.url && c.kind !== 'owner_link')
  const { error } = await db
    .from('company_research')
    .upsert({ company_key: companyKey, role_id: ri.roleId, custom_url: url, hook_candidates: [r.candidate, ...rest], updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
  const w = await writeCompany(db, client, companyKey, { choose: 0 })
  const mine = w.candidates[0]
  if (!usable(mine)) return { ok: false as const, problems: [`Read the page, but the wording failed the checks: ${w.problems.join(' ')}`], cost: r.cost + w.cost }
  return { ok: true as const, candidate: mine, cost: r.cost + w.cost }
}

/**
 * Write the sentences for every candidate of a company (one Claude call, about $0.03),
 * keep the pick when it still has wording (else the first that does, else no hook),
 * then rewrite the recruiter and job-poster messages.
 */
export async function writeCompany(db: SupabaseClient, client: Anthropic, companyKey: string, opts: { choose?: number; resetPick?: boolean } = {}) {
  const ri = await researchInput(db, companyKey)
  if (!ri) throw new Error('no role for this company')
  const { data: row, error } = await db
    .from('company_research')
    .select('hook_candidates, chosen_index, fit_items, hook_source_url, email_hook, li_hook, li_link, hook_reviewed_at, why_no_hook')
    .eq('company_key', companyKey)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!row) throw new Error('no research for this company')
  const list = (row.hook_candidates ?? []) as HookCandidate[]
  const w = await writeWording(client, { company: ri.input.company, roleTitle: ri.input.roleTitle, posting: ri.input.posting, fitItems: row.fit_items as string[] }, list)
  const candidates = list.map((c, i) => {
    // Old wording never survives a rewrite: a candidate that now fails keeps none.
    const base: HookCandidate = { ...c }
    delete base.li_hook
    delete base.li_link
    delete base.li_item
    delete base.email_hook
    return { ...base, ...(w.perCandidate[i] ?? {}) } as HookCandidate
  })
  // Only the owner's own "no hook" stays empty; an empty pick left by failed wording is re-picked.
  const ownerNone = row.chosen_index === null && row.why_no_hook === 'Owner chose no hook.' && !opts.resetPick
  const want = opts.resetPick ? null : (opts.choose ?? row.chosen_index)
  const index = want !== null && want !== undefined && usable(candidates[want]) ? want : ownerNone ? null : candidates.findIndex(usable)
  const chosen = index !== null && index >= 0 ? candidates[index] : null
  const prev = row as { hook_source_url: string | null; email_hook: string | null; li_hook: string | null; li_link: string | null; hook_reviewed_at: string | null }
  const sameWords = !!chosen && prev.hook_source_url === chosen.url && prev.email_hook === chosen.email_hook && prev.li_hook === chosen.li_hook && prev.li_link === chosen.li_link
  const now = new Date().toISOString()
  const { error: e } = await db
    .from('company_research')
    .update({
      hook_candidates: candidates,
      chosen_index: chosen ? index : null,
      ...hookFields(chosen),
      // email_hook is what the owner reads and sends: a change means reading again.
      hook_reviewed_at: sameWords ? prev.hook_reviewed_at : null,
      li_nohook: w.company?.li_nohook ?? null,
      li_nohook_item: w.company?.li_nohook_item ?? null,
      email_fit: w.company?.email_fit ?? null,
      why_no_hook: chosen ? null : list.length ? 'No candidate passed the writing checks.' : undefined,
      wording_problems: w.problems,
      written_at: now,
      updated_at: now,
    })
    .eq('company_key', companyKey)
  if (e) throw new Error(e.message)
  const refreshed = await refreshRecruiterFollowups(db, { companyKey, write: true })
  return { candidates, chosen, problems: w.problems, cost: w.cost, refreshed }
}

export { researchCompany }
