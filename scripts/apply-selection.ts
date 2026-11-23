/**
 * Re-apply contact-selection rules to people already found, without a paid
 * search: `npm run reselect -- [--yes]`
 *
 * - Drops leadership / executive / fractional recruiters (untouched only:
 *   status none or drafted) unless the company's primary role is director+.
 * - Re-ranks UCLA / Blockchain @ UCLA alumni by closeness to the role's function.
 * Blockchain @ UCLA detection needs profile text, so it only applies to people
 * found after 2026-11-23 (re-search to backfill).
 */
import { createClient } from '@supabase/supabase-js'
import { loadCompany } from '../lib/people/run'
import { functionScore, TITLES } from '../lib/people/targets'

const yes = process.argv.includes('--yes')

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: people, error } = await db.from('people').select('id, company_key, full_name, title, branch, rank, outreach_status, source')
  if (error) throw new Error(error.message)
  const byCompany = new Map<string, NonNullable<typeof people>>()
  for (const p of people ?? []) byCompany.set(p.company_key, [...(byCompany.get(p.company_key) ?? []), p])

  const drop: number[] = []
  const rerank: { id: number; rank: number }[] = []
  for (const [key, list] of byCompany) {
    const loaded = await loadCompany(db, key)
    if (!loaded) continue
    const director = loaded.input.roleSeniority === 'director_plus'
    const track = loaded.input.track
    for (const p of list) {
      if (!director && p.source === 'exa' && ['none', 'drafted'].includes(p.outreach_status) && TITLES.leadershipRecruiter.test(p.title ?? '')) drop.push(p.id)
    }
    for (const branch of ['alumni', 'blockchain_ucla']) {
      const group = list.filter((p) => p.branch === branch && !drop.includes(p.id))
      group
        .sort((a, b) => functionScore(b.title ?? '', track) - functionScore(a.title ?? '', track) || (a.rank ?? 9) - (b.rank ?? 9))
        .forEach((p, i) => {
          if (p.rank !== i + 1) rerank.push({ id: p.id, rank: i + 1 })
        })
    }
  }
  console.log(`drop ${drop.length} leadership/executive recruiters, re-rank ${rerank.length} alumni`)
  if (!yes) return console.log('Preview only. Re-run with --yes.')
  if (drop.length) await db.from('people').delete().in('id', drop)
  for (const r of rerank) await db.from('people').update({ rank: r.rank }).eq('id', r.id)
  console.log('done')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
