import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { buildCompanies, COMPANY_JOB_COLUMNS, type CompanyJob, type RunSummary } from '@/lib/people/companies'
import { PERSON_COLUMNS, type PersonRow } from '@/lib/people/types'
import { CompaniesScreen } from '@/components/people/CompaniesScreen'

export const metadata: Metadata = { title: 'Companies' }
export const dynamic = 'force-dynamic'

async function all<T>(table: string, columns: string): Promise<T[]> {
  const db = createServiceClient()
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order('id').range(from, from + 999)
    if (error) throw new Error(`load ${table}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return out
}

/** The middleware has already passed the owner check for this route. */
export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const [jobs, people, runs, settings] = await Promise.all([
    all<CompanyJob>('jobs', COMPANY_JOB_COLUMNS),
    all<PersonRow>('people', PERSON_COLUMNS),
    all<RunSummary>('people_runs', 'id, company_key, cost_usd, error, finished_at, rule'),
    createServiceClient().from('company_settings').select('company_key').eq('fit_override', true),
  ])
  const overrides = new Set((settings.data ?? []).map((s) => s.company_key as string))
  const { open } = await searchParams
  return <CompaniesScreen initial={buildCompanies(jobs, people, runs, overrides)} openKey={open ?? null} />
}
