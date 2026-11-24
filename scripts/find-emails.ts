/**
 * Work emails for recruiters and job posters with a Drafted or Approved note,
 * from their LinkedIn profile URL (Blitz API: one record per email found, misses free).
 * Lookup only: nothing is sent.  npm run find-emails -- [--yes] [--force]
 */
import { createClient } from '@supabase/supabase-js'
import { blitzRecordsRemaining, findWorkEmail } from '../lib/research/blitz'
import { RESEARCHED_BRANCHES } from '../lib/research/gate'

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const write = process.argv.includes('--yes')
  let q = db
    .from('people')
    .select('id, full_name, company, linkedin_url, email_checked_at')
    .in('branch', RESEARCHED_BRANCHES)
    .in('outreach_status', ['drafted', 'approved'])
    .not('draft', 'is', null)
    .not('linkedin_url', 'is', null)
  if (!process.argv.includes('--force')) q = q.is('email_checked_at', null)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  console.log(`${data?.length ?? 0} people to look up; Blitz records remaining: ${await blitzRecordsRemaining()}.`)
  if (!write) return console.log('Preview only; --yes to look up.')
  const tally = { found: 0, not_found: 0, error: 0 }
  for (const p of data ?? []) {
    const r = await findWorkEmail(p.linkedin_url!)
    tally[r.status]++
    const { error: e } = await db
      .from('people')
      .update({ email: r.email, email_status: r.status, email_checked_at: new Date().toISOString() })
      .eq('id', p.id)
    if (e) throw new Error(e.message)
    console.log(`${r.status.padEnd(9)} ${p.company} / ${p.full_name}${r.error ? ` (${r.error})` : ''}`)
    await new Promise((res) => setTimeout(res, 250))
  }
  console.log(`\n${JSON.stringify(tally)}; Blitz records remaining: ${await blitzRecordsRemaining()}.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
