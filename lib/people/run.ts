import type { SupabaseClient } from '@supabase/supabase-js'
import { domainOf, findPeople, type CompanyInput, type FindResult, type Searcher } from './find'
import { trackOf } from '@/lib/jobs/categories'
import { companyFit } from '@/lib/jobs/fit'

const ROLE_COLUMNS =
  'id, company, company_key, company_website, company_employees, company_size, fit_tier, liveness, category, category_confidence, seniority, work_mode, work_locations, start_requirement, start_date'

/** Company facts plus its primary role (the one the fit flags and routing use). */
export async function loadCompany(db: SupabaseClient, companyKey: string) {
  const { data, error } = await db.from('jobs').select(ROLE_COLUMNS).eq('company_key', companyKey).limit(50)
  if (error) throw new Error(`load company: ${error.message}`)
  if (!data?.length) return null
  const pick = <K extends keyof (typeof data)[number]>(k: K) => data.find((r) => r[k] != null)?.[k] ?? null
  const { data: settings } = await db.from('company_settings').select('fit_override').eq('company_key', companyKey).maybeSingle()
  const fit = companyFit(data, settings?.fit_override ?? false)
  const input: CompanyInput = {
    company: data[0].company,
    company_key: companyKey,
    domain: domainOf(pick('company_website') as string | null),
    employees: pick('company_employees') as number | null,
    size_text: pick('company_size') as string | null,
    track: trackOf(fit.primary?.category),
    roleSeniority: fit.primary?.seniority ?? null,
  }
  return { input, fit }
}

/**
 * Search one company and save what's found, with the full profile text.
 * Existing people keep their outreach status, notes and draft; their profile
 * facts are refreshed. Earlier Exa results at this company that the new rules
 * no longer select are removed, but only while untouched (status none or
 * drafted). Every run is logged to people_runs with its cost and rule.
 */
export async function runForCompany(db: SupabaseClient, companyKey: string, search: Searcher) {
  const loaded = await loadCompany(db, companyKey)
  if (!loaded) throw new Error(`no jobs for company ${companyKey}`)
  const company = loaded.input

  const { data: runRow, error: runErr } = await db.from('people_runs').insert({ source: 'exa', company_key: companyKey }).select('id').single()
  if (runErr) throw new Error(`log run: ${runErr.message}`)

  let result: FindResult | null = null
  try {
    result = await findPeople(company, search)
    let saved = 0
    if (result.people.length) {
      const { data, error } = await db.from('people').upsert(result.people, { onConflict: 'company_key,linkedin_key' }).select('id')
      if (error) throw new Error(`save people: ${error.message}`)
      saved = data?.length ?? 0
    }
    const keep = result.people.map((p) => p.linkedin_key)
    let stale = db.from('people').delete().eq('company_key', companyKey).eq('source', 'exa').in('outreach_status', ['none', 'drafted'])
    if (keep.length) stale = stale.not('linkedin_key', 'in', `(${keep.map((k) => `"${k.replace(/"/g, '')}"`).join(',')})`)
    const { error: staleErr } = await stale
    if (staleErr) throw new Error(`prune people: ${staleErr.message}`)

    await db
      .from('people_runs')
      .update({
        searches: result.searches,
        people_found: result.atCompany,
        people_saved: saved,
        cost_usd: result.cost,
        rule: result.rule,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runRow.id)
    return { company: company.company, band: result.band, track: result.track, rule: result.rule, searches: result.searches, cost: result.cost, found: result.atCompany, saved, people: result.people }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db
      .from('people_runs')
      .update({ error: message, searches: result?.searches ?? 0, cost_usd: result?.cost ?? 0, finished_at: new Date().toISOString() })
      .eq('id', runRow.id)
    throw err
  }
}
