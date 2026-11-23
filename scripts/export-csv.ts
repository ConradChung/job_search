/**
 * Sender CSV from the command line, same as the page's Export CSV button with
 * the default filters (passing companies, page sort): `npm run export-csv -- [options]`
 *
 *   --tiers 1        tiers in the file, comma-separated (default 1)
 *   --limit 15       first N rows (default 15; 0 = all)
 *   --include-exported
 *   --out DIR        where to save the file (default ~/Downloads)
 *   --yes            write the file and mark those people Exported (without it: preview)
 *
 * Sends nothing; no outside API calls.
 */
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { buildCompanies, COMPANY_JOB_COLUMNS, type CompanyJob, type RunSummary } from '../lib/people/companies'
import { PERSON_COLUMNS, type PersonRow } from '../lib/people/types'
import { BRANCH_ORDER } from '../lib/people/targets'
import { applyFilters, CLEARED } from '../lib/pipeline/filters'
import { runExport } from '../lib/export/run'
import { DEFAULT_BATCH } from '../lib/export/columns'

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(`--${n}`)
const opt = (n: string, d: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const all = async <T>(table: string, columns: string) => {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select(columns).order('id').range(from, from + 999)
      if (error) throw new Error(`load ${table}: ${error.message}`)
      out.push(...((data ?? []) as T[]))
      if (!data || data.length < 1000) break
    }
    return out
  }
  const [jobs, people, runs, settings] = await Promise.all([
    all<CompanyJob>('jobs', COMPANY_JOB_COLUMNS),
    all<PersonRow>('people', PERSON_COLUMNS),
    all<RunSummary>('people_runs', 'id, company_key, cost_usd, error, finished_at, rule'),
    db.from('company_settings').select('company_key').eq('fit_override', true),
  ])
  const companies = buildCompanies(jobs, people, runs, new Set((settings.data ?? []).map((s) => s.company_key as string)))
  const visible = applyFilters(companies, { ...CLEARED, fit: 'passes' })
  const ids = visible.flatMap((c) =>
    [...c.people]
      .sort((a, b) => BRANCH_ORDER.indexOf(a.branch) - BRANCH_ORDER.indexOf(b.branch) || (a.rank ?? 99) - (b.rank ?? 99))
      .filter((p) => p.outreach_status === 'approved' || p.outreach_status === 'exported')
      .map((p) => p.id)
  )
  const limit = Number(opt('limit', String(DEFAULT_BATCH)))
  const r = await runExport(db, {
    ids,
    tiers: opt('tiers', '1').split(',').map(Number),
    includeExported: flag('include-exported'),
    limit: limit > 0 ? limit : null,
    write: flag('yes'),
  })
  console.log(`${r.count} people (first ${r.count} of ${r.available} ready)`)
  for (const p of r.people) console.log(`  ${p.company} / ${p.name}`)
  if (r.noUrl.length) console.log(`Skipped, no profile URL: ${r.noUrl.map((p) => `${p.name} (${p.company})`).join(', ')}`)
  if (r.recruiterNotApplied.length)
    console.log(`Warning, recruiter role not Applied (after-accept asks the scope question): ${r.recruiterNotApplied.map((p) => `${p.name} (${p.company})`).join(', ')}`)
  if (r.overLimit.length) {
    console.log(`REFUSED, over the note limit: ${r.overLimit.map((p) => `${p.name} (${p.company}) ${p.length}`).join(', ')}`)
    process.exit(1)
  }
  if (!flag('yes')) return console.log('Preview only. Re-run with --yes to write the file and mark them Exported.')
  if (!r.csv) return console.log('Nothing to export.')
  const path = join(opt('out', join(homedir(), 'Downloads')), r.filename!)
  writeFileSync(path, r.csv, 'utf8')
  console.log(`Wrote ${path}; ${r.count} people marked Exported.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
