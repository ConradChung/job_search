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
import { loadCompanies, peopleInOrder } from '../lib/pipeline/load'
import { applyFilters, CLEARED } from '../lib/pipeline/filters'
import { runExport } from '../lib/export/run'
import { DEFAULT_BATCH } from '../lib/export/columns'

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(`--${n}`)
const opt = (n: string, d: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const visible = applyFilters(await loadCompanies(db), { ...CLEARED, fit: 'passes' })
  const ids = peopleInOrder(visible)
    .filter((p) => p.outreach_status === 'approved' || p.outreach_status === 'exported')
    .map((p) => p.id)
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
