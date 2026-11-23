import type { SupabaseClient } from '@supabase/supabase-js'
import { buildCompanies, COMPANY_JOB_COLUMNS, type CompanyJob, type CompanyView, type RunSummary } from '@/lib/people/companies'
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
  const [jobs, people, runs, settings] = await Promise.all([
    all<CompanyJob>(db, 'jobs', COMPANY_JOB_COLUMNS),
    all<PersonRow>(db, 'people', PERSON_COLUMNS),
    all<RunSummary>(db, 'people_runs', 'id, company_key, cost_usd, error, finished_at, rule'),
    db.from('company_settings').select('company_key').eq('fit_override', true),
  ])
  return buildCompanies(jobs, people, runs, new Set((settings.data ?? []).map((s) => s.company_key as string)))
}

/** People in page order: companies as sorted, then tree order (branch, then rank). */
export function peopleInOrder(companies: CompanyView[]): PersonRow[] {
  return companies.flatMap((c) => [...c.people].sort((a, b) => BRANCH_ORDER.indexOf(a.branch) - BRANCH_ORDER.indexOf(b.branch) || (a.rank ?? 99) - (b.rank ?? 99)))
}
