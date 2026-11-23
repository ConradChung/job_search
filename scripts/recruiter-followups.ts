/**
 * Rewrite recruiter after-accept messages with the fixed template (owner,
 * 2026-11-24). No model call, no cost. Drafted / Approved only; the note itself
 * is never changed. `npm run recruiter-followups [-- --yes]`
 */
import { createClient } from '@supabase/supabase-js'
import { refreshRecruiterFollowups } from '../lib/drafts/recruiterFollowups'

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const write = process.argv.includes('--yes')
  const r = await refreshRecruiterFollowups(db, { write })
  for (const c of r.changes) {
    console.log(`\n[${c.company}] ${c.full_name} (${c.status})${c.problems.length ? ` PROBLEMS: ${c.problems.join(' ')}` : ''}\n  NOTE:  ${c.note}\n  OLD:   ${c.before}\n  NEW:   ${c.after}`)
  }
  console.log(`\n${r.changes.length} of ${r.total} recruiter messages ${write ? 'rewritten' : 'would change (preview; --yes to write)'}. Skipped:`, r.skipped)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
