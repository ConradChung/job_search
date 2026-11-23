/**
 * Find people at companies with Exa: `npm run people -- [options]`
 *
 *   --tier 2         only companies with a role of tier <= 2 (default 1)
 *   --limit 10       how many companies (default 10)
 *   --company "key"  one company by company_key (ignores tier/limit)
 *   --rerun          include companies that already had an Exa run
 *   --yes            actually run (without it: preview + cost estimate only)
 */
import { createClient } from '@supabase/supabase-js'
import { exaSearcher } from '../lib/people/exa'
import { runForCompany, loadCompany } from '../lib/people/run'
import { sizeBand } from '../lib/people/size'
import { EST_COST_PER_SEARCH, maxSearches } from '../lib/people/targets'

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
    const tier = Number(opt('tier', '1'))
    const limit = Number(opt('limit', '10'))
    const { data: jobs, error } = await db
      .from('jobs')
      .select('company_key, fit_tier, posted_at')
      .lte('fit_tier', tier)
      .neq('status', 'not_fit')
      .order('posted_at', { ascending: false, nullsFirst: false })
    if (error) throw new Error(error.message)
    const { data: runs } = await db.from('people_runs').select('company_key').is('error', null)
    const done = new Set(flag('rerun') ? [] : (runs ?? []).map((r) => r.company_key))
    keys = [...new Set((jobs ?? []).map((j) => j.company_key))].filter((k) => !done.has(k)).slice(0, limit)
  }

  let maxTotal = 0
  const plan: { key: string; name: string; band: string; employees: number | null; domain: string | null }[] = []
  for (const k of keys) {
    const c = await loadCompany(db, k)
    if (!c) continue
    const band = sizeBand(c.employees, c.size_text)
    maxTotal += maxSearches(band)
    plan.push({ key: k, name: c.company, band, employees: c.employees, domain: c.domain })
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
        `${r.company} [${r.band}] ${r.searches} searches $${r.cost.toFixed(3)} · ${r.found} at company · saved ${r.saved}: ` +
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
