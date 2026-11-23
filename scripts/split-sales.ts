/**
 * One-off backfill (owner, 2026-11-23): split stored `sales` roles into SDR/BDR,
 * AE, account management and customer success by title, and mark SDR roles
 * whose posting asks for 2+ years of closing experience. No Claude calls.
 *
 *   npm run split-sales            # preview
 *   npm run split-sales -- --yes   # write
 */
import { createClient } from '@supabase/supabase-js'
import { requiresClosingExperience, splitSales } from '../lib/jobs/categories'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  const { data, error } = await db.from('jobs').select('id, title, category, description').in('category', ['sales', 'sdr'])
  if (error) throw error
  const changes = (data ?? []).map((j) => {
    const category = splitSales(j.title)
    return { id: j.id, title: j.title, from: j.category, category, closing_required: category === 'sdr' ? requiresClosingExperience(j.description) : null }
  })
  const counts: Record<string, number> = {}
  for (const c of changes) counts[c.category] = (counts[c.category] ?? 0) + 1
  console.log(`${changes.length} sales rows →`, counts)
  for (const c of changes.filter((c) => c.category === 'sdr' || c.category === 'sales')) console.log(`  ${c.category.padEnd(6)} ${c.closing_required ? '[closing] ' : ''}${c.id} ${c.title}`)
  if (!process.argv.includes('--yes')) return console.log('Preview only. Re-run with --yes.')
  for (const c of changes) {
    const { error: e } = await db.from('jobs').update({ category: c.category, closing_required: c.closing_required }).eq('id', c.id)
    if (e) throw e
  }
  console.log('done')
}
main()
