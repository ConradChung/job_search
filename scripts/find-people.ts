/**
 * Find people at companies that pass the fit flags: `npm run people -- [options]`
 *
 *   --limit 300      how many companies (default 300)
 *   --company "key"  one company by company_key (ignores the fit filter)
 *   --new-only       skip companies already searched
 *   --yes            actually run (without it: preview + cost estimate only)
 */
import { createClient } from '@supabase/supabase-js'
import { exaSearcher } from '../lib/people/exa'
import { runForCompany, loadCompany } from '../lib/people/run'
import { sizeBand } from '../lib/people/size'
import { EST_COST_PER_SEARCH, maxSearches } from '../lib/people/targets'
import { companyFit } from '../lib/jobs/fit'

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(`--${n}`)
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let keys: string[]
  if (opt('company', '')) {
    keys = [opt('company', '')]
  } else {
    const { data: jobs, error } = await db
      .from('jobs')
      .select('id, company_key, fit_tier, liveness, category, category_confidence, seniority, work_mode, work_locations, start_requirement, start_date')
    if (error) throw new Error(error.message)
    const { data: overrides } = await db.from('company_settings').select('company_key').eq('fit_override', true)
    const forced = new Set((overrides ?? []).map((o) => o.company_key))
    const byCompany = new Map<string, NonNullable<typeof jobs>>()
    for (const j of jobs ?? []) byCompany.set(j.company_key, [...(byCompany.get(j.company_key) ?? []), j])
    const { data: runs } = await db.from('people_runs').select('company_key').is('error', null)
    const searched = new Set((runs ?? []).map((r) => r.company_key))
    keys = [...byCompany.entries()]
      .filter(([k, roles]) => companyFit(roles, forced.has(k)).canDraft)
      .map(([k]) => k)
      .filter((k) => !flag('new-only') || !searched.has(k))
      .slice(0, Number(opt('limit', '300')))
  }

  let maxTotal = 0
  const plan: { key: string; name: string; band: string; track: string; employees: number | null }[] = []
  for (const k of keys) {
    const loaded = await loadCompany(db, k)
    if (!loaded) continue
    const c = loaded.input
    const band = sizeBand(c.employees, c.size_text)
    maxTotal += maxSearches(band, c.track)
    plan.push({ key: k, name: c.company, band, track: c.track, employees: c.employees })
  }
  console.table(plan)
  console.log(`${plan.length} companies, at most ${maxTotal} searches, at most ~$${(maxTotal * EST_COST_PER_SEARCH).toFixed(2)}`)
  if (!flag('yes')) {
    console.log('Preview only. Re-run with --yes to search.')
    return
  }

  const search = exaSearcher()
  let spent = 0
  for (const p of plan) {
    try {
      const r = await runForCompany(db, p.key, search)
      spent += r.cost
      console.log(
        `${r.company} [${r.band}/${r.track}] ${r.searches} searches $${r.cost.toFixed(3)} · ${r.found} at company · saved ${r.saved}: ` +
          r.people.map((x) => `${x.branch}:${x.full_name} (${x.title})`).join('; ')
      )
    } catch (err) {
      console.error(`${p.name}: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log(`Total Exa spend: $${spent.toFixed(3)}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
