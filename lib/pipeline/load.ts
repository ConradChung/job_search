import type { SupabaseClient } from '@supabase/supabase-js'
import { buildCompanies, COMPANY_JOB_COLUMNS, type CompanyJob, type CompanyResearchView, type CompanyView, type RunSummary } from '@/lib/people/companies'
import { PERSON_COLUMNS, type PersonRow } from '@/lib/people/types'
import { BRANCH_ORDER } from '@/lib/people/targets'

async function all<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order('id').range(from, from + 999)
    if (error) throw new Error(`load ${table}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return out
}

/** Every company row as the Pipeline page builds it (one place for the page, scripts and the MCP server). */
export async function loadCompanies(db: SupabaseClient): Promise<CompanyView[]> {
  const [jobs, people, runs, settings, research] = await Promise.all([
    all<CompanyJob>(db, 'jobs', COMPANY_JOB_COLUMNS),
    all<PersonRow>(db, 'people', PERSON_COLUMNS),
    all<RunSummary>(db, 'people_runs', 'id, company_key, cost_usd, error, finished_at, rule'),
    db.from('company_settings').select('company_key, fit_override, hold_reason'),
    db.from('company_research').select('company_key, hook_source_url, hook_title, hook_date, hook_summary, hook_sentence, hook_short, fit_items, hook_reviewed_at, why_no_hook, researched_at, hook_candidates, chosen_index, custom_url'),
  ])
  const byKey = new Map(((research.data ?? []) as (CompanyResearchView & { company_key: string })[]).map((r) => [r.company_key, r]))
  const rows = (settings.data ?? []) as { company_key: string; fit_override: boolean | null; hold_reason: string | null }[]
  const built = buildCompanies(
    jobs,
    people,
    runs,
    new Set(rows.filter((s) => s.fit_override).map((s) => s.company_key)),
    new Map(rows.filter((s) => s.hold_reason).map((s) => [s.company_key, s.hold_reason!]))
  )
  for (const c of built) c.research = byKey.get(c.key) ?? null
  return built
}

/** People in page order: companies as sorted, then tree order (branch, then rank). */
export function peopleInOrder(companies: CompanyView[]): PersonRow[] {
  return companies.flatMap((c) => [...c.people].sort((a, b) => BRANCH_ORDER.indexOf(a.branch) - BRANCH_ORDER.indexOf(b.branch) || (a.rank ?? 99) - (b.rank ?? 99)))
}
