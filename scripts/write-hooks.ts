/**
 * Write the message sentences for every researched company (writing rules v3,
 * owner 2026-11-23): one Claude call per company (about $0.03) covering all its
 * candidates, then rewrite its recruiter and job-poster messages. Notes untouched.
 *   npm run write-hooks -- [--cap 2] [--company KEY] [--reset-pick]
 * --reset-pick: back to the research's order (first candidate whose wording passed).
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { EST_WRITE_COST } from '../lib/research/write'
import { writeCompany } from '../lib/research/store'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const client = new Anthropic()
  const cap = Number(arg('cap') ?? 2)
  let q = db.from('company_research').select('company_key').order('company_key')
  if (arg('company')) q = q.eq('company_key', arg('company')!)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const queue = (data ?? []).map((r) => r.company_key as string)
  console.log(`${queue.length} companies (cap $${cap}).`)
  let spent = 0
  const failed: string[] = []
  const flagged: string[] = []
  async function worker() {
    for (let key = queue.shift(); key; key = queue.shift()) {
      if (spent + EST_WRITE_COST * 3 > cap) {
        failed.push(`${key}: skipped, spend cap`)
        continue
      }
      try {
        const w = await writeCompany(db, client, key, { resetPick: process.argv.includes('--reset-pick') })
        spent += w.cost
        const usable = w.candidates.filter((c) => c.li_hook).length
        if (w.problems.length) flagged.push(`${key}: ${w.problems.join(' | ')}`)
        console.log(`${key}: ${usable}/${w.candidates.length} candidates written · pick: ${w.chosen ? w.chosen.speaker ?? w.chosen.kind : 'no hook'} · messages ${w.refreshed.changes.length} · $${w.cost.toFixed(3)}`)
      } catch (err) {
        failed.push(`${key}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  console.log(`\nSpent $${spent.toFixed(2)}.`)
  if (flagged.length) console.log(`Wording dropped by the checks:\n  ${flagged.join('\n  ')}`)
  if (failed.length) console.log(`Not done:\n  ${failed.join('\n  ')}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
