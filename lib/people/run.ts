import type { SupabaseClient } from '@supabase/supabase-js'
import { domainOf, findPeople, type CompanyInput, type FindResult, type Searcher } from './find'

/** Company facts for a search, from its jobs rows (first row with data wins). */
export async function loadCompany(db: SupabaseClient, companyKey: string): Promise<CompanyInput | null> {
  const { data, error } = await db
    .from('jobs')
    .select('company, company_key, company_website, company_employees, company_size')
    .eq('company_key', companyKey)
    .limit(20)
  if (error) throw new Error(`load company: ${error.message}`)
  if (!data?.length) return null
  const pick = <K extends keyof (typeof data)[number]>(k: K) => data.find((r) => r[k] != null)?.[k] ?? null
  return {
    company: data[0].company,
    company_key: companyKey,
    domain: domainOf(pick('company_website') as string | null),
    employees: pick('company_employees') as number | null,
    size_text: pick('company_size') as string | null,
  }
}

/**
 * Search one company and save what's found. Existing people (same LinkedIn
 * profile at the company) are left untouched so outreach status survives.
 * Every run is logged to people_runs with its real Exa cost.
 */
export async function runForCompany(db: SupabaseClient, companyKey: string, search: Searcher) {
  const company = await loadCompany(db, companyKey)
  if (!company) throw new Error(`no jobs for company ${companyKey}`)

  const { data: runRow, error: runErr } = await db
    .from('people_runs')
    .insert({ source: 'exa', company_key: companyKey })
    .select('id')
    .single()
  if (runErr) throw new Error(`log run: ${runErr.message}`)

  let result: FindResult | null = null
  try {
    result = await findPeople(company, search)
    let saved = 0
    if (result.people.length) {
      const { data, error } = await db
        .from('people')
        .upsert(result.people, { onConflict: 'company_key,linkedin_key', ignoreDuplicates: true })
        .select('id')
      if (error) throw new Error(`save people: ${error.message}`)
      saved = data?.length ?? 0
    }
    await db
      .from('people_runs')
      .update({
        searches: result.searches,
        people_found: result.atCompany,
        people_saved: saved,
        cost_usd: result.cost,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runRow.id)
    return { company: company.company, band: result.band, searches: result.searches, cost: result.cost, found: result.atCompany, saved, people: result.people }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db
      .from('people_runs')
      .update({ error: message, searches: result?.searches ?? 0, cost_usd: result?.cost ?? 0, finished_at: new Date().toISOString() })
      .eq('id', runRow.id)
    throw err
  }
}
