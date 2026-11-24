/**
 * Review file: Drafted notes in the sender CSV format, plus a `checks` column,
 * for reading before approving. Changes nothing: no approval, nothing marked
 * Exported, so the sender should not import it.
 *
 *   npm run review-csv -- [--tier 1] [--status drafted] [--out DIR]
 */
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadCompanies, peopleInOrder } from '../lib/pipeline/load'
import { applyFilters, CLEARED } from '../lib/pipeline/filters'
import { tierOf, type FitTrack } from '../lib/jobs/fit'
import { PROFILE } from '../lib/profile'
import { EXPORT_COLUMNS, type ExportRow } from '../lib/export/columns'
import { contactType, csvField, exportCell, normalizeLinkedIn, oneLine, splitName } from '../lib/export/csv'
import { draftWarnings, shortRole } from '../lib/drafts/prompt'
import { noteProblems } from '../lib/drafts/check'

const args = process.argv.slice(2)
const opt = (n: string, d: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)
const TIER_TRACK: Record<string, FitTrack> = { '1': 'gtm_eng', '2': 'sdr', '3': 'revops' }

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const tier = opt('tier', '1')
  const status = opt('status', 'drafted')
  const companies = applyFilters(await loadCompanies(db), { ...CLEARED, fit: 'passes', tiers: new Set([TIER_TRACK[tier]]) })
  const byKey = new Map(companies.map((c) => [c.key, c]))
  const people = peopleInOrder(companies).filter((p) => p.outreach_status === status && p.draft)

  const header = [...EXPORT_COLUMNS.map((c) => c.header), 'checks']
  const lines = [header.map(csvField).join(',')]
  let failing = 0
  for (const p of people) {
    const c = byKey.get(p.company_key)!
    const role = c.primary
    const problems = await noteProblems(db, p.id, p.draft!)
    const checks = problems.length ? `FAILS: ${problems.join(' ')}` : draftWarnings(p.draft!).join(' ') || 'ok'
    if (problems.length) failing++
    const { first, last } = splitName(p.full_name)
    const row: ExportRow = {
      linkedin_url: normalizeLinkedIn(p.linkedin_url) ?? '',
      first_name: first,
      last_name: last,
      company: c.name,
      title: p.title ?? '',
      contact_type: contactType(p.branch, p.title),
      track: `Tier ${tierOf(c.fitTrack)} · ${PROFILE.constraints.tracks[c.fitTrack]?.label ?? c.fitTrack}`,
      role: shortRole(role?.title),
      note: p.draft ?? '',
      after_accept_message: p.followup ?? '',
      role_status: role?.status ?? '',
      company_id: c.key,
      person_id: String(p.id),
    }
    lines.push([...EXPORT_COLUMNS.map((col) => exportCell(col.key, row[col.key])), csvField(oneLine(checks))].join(','))
  }
  const path = join(opt('out', join(homedir(), 'Downloads')), `tier${tier}-${status}-review-${new Date().toISOString().slice(0, 10)}-${people.length}.csv`)
  writeFileSync(path, lines.join('\r\n') + '\r\n', 'utf8')
  console.log(`Wrote ${path}: ${people.length} ${status} notes at ${new Set(people.map((p) => p.company_key)).size} companies; ${failing} fail a check. Nothing approved or marked.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
