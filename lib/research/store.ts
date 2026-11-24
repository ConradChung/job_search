import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import { loadCompany } from '@/lib/people/run'
import { refreshRecruiterFollowups } from '@/lib/drafts/recruiterFollowups'
import { researchCompany, researchUrl, type HookCandidate, type ResearchInput, type ResearchResult } from './research'

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
  }
}

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
  await chooseCandidate(db, companyKey, 0)
  return { ok: true as const, candidate: r.candidate, cost: r.cost }
}

export { researchCompany }
