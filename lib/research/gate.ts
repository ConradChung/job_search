import type { SupabaseClient } from '@supabase/supabase-js'

/** Branches whose after-accept messages use the company research (owner, 2026-11-23). */
export const RESEARCHED_BRANCHES = ['recruiting', 'poster']

export const HOOK_GATE_MESSAGE = "The after-accept messages use this company's researched hook. Tick \"I've read this\" on the company row first."

/** Companies (of these) whose hook is used but not yet ticked "I've read this". */
export async function unreviewedHookCompanies(db: SupabaseClient, companyKeys: string[]): Promise<Set<string>> {
  if (!companyKeys.length) return new Set()
  const { data, error } = await db
    .from('company_research')
    .select('company_key')
    .in('company_key', [...new Set(companyKeys)])
    .not('hook_sentence', 'is', null)
    .is('hook_reviewed_at', null)
  if (error) throw new Error(`hook gate: ${error.message}`)
  return new Set((data ?? []).map((r) => r.company_key as string))
}

/** Problem for this person when their messages carry an unreviewed hook; null when they can be approved or exported. */
export function hookGated(p: { branch: string; company_key: string }, unreviewed: Set<string>): boolean {
  return RESEARCHED_BRANCHES.includes(p.branch) && unreviewed.has(p.company_key)
}

export async function hookGateProblem(db: SupabaseClient, personId: number): Promise<string | null> {
  const { data } = await db.from('people').select('branch, company_key').eq('id', personId).maybeSingle()
  if (!data) return null
  const unreviewed = await unreviewedHookCompanies(db, [data.company_key])
  return hookGated(data, unreviewed) ? HOOK_GATE_MESSAGE : null
}
