/**
 * One-command sheet → database sync: `npm run sync`.
 * Reads the Jobs Final tab (CSV export), inserts new rows, refreshes sheet
 * facts on existing ones. Never touches status/notes/liveness, never writes the sheet.
 */
import { createClient } from '@supabase/supabase-js'
import { fetchSheetCsv, syncFromCsv } from '../lib/jobs/sync'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await syncFromCsv(db, await fetchSheetCsv())
  const reasons = result.skipped.reduce<Record<string, number>>((m, s) => ((m[s.reason] = (m[s.reason] ?? 0) + 1), m), {})
  console.log(JSON.stringify({ read: result.read, inserted: result.inserted, updated: result.updated, skipped: reasons }))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
