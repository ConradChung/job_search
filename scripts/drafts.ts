/**
 * Draft LinkedIn notes for people without one: `npm run drafts -- [options]`
 *
 *   --companies "a,b"  only these company_keys
 *   --limit 30         at most this many people (default 30)
 *   --redo             also re-draft people who already have a draft
 *   --ids "1,2"        only these people ids (implies --redo)
 *   --yes              actually call Claude (without it: preview only)
 *
 * Nothing is ever sent; drafts land in the dashboard for review.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { draftForPerson } from '../lib/drafts/run'

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(`--${n}`)
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}

const EST_PER_DRAFT = 0.015

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  let q = db.from('people').select('id, company, full_name, branch').neq('outreach_status', 'skip').order('company_key').order('rank')
  const ids = opt('ids', '')
  if (ids) q = q.in('id', ids.split(',').map(Number))
  else if (!flag('redo')) q = q.is('draft', null)
  const companies = opt('companies', '')
  if (companies) q = q.in('company_key', companies.split(',').map((s) => s.trim()))
  const { data, error } = await q.limit(Number(opt('limit', '30')))
  if (error) throw new Error(error.message)
  const people = data ?? []

  console.log(`${people.length} people, about $${(people.length * EST_PER_DRAFT).toFixed(2)} (estimate)`)
  if (!flag('yes')) {
    console.log('Preview only. Re-run with --yes to draft.')
    return
  }

  const client = new Anthropic()
  let spent = 0
  for (const p of people) {
    try {
      const r = await draftForPerson(db, client, p.id)
      spent += r.cost
      console.log(`\n[${p.company}] ${p.full_name} (${p.branch}) ${r.text.length} chars $${r.cost.toFixed(4)}${r.tooLong ? ' TOO LONG' : ''}\n${r.text}`)
    } catch (err) {
      console.error(`${p.company} / ${p.full_name}: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log(`\nTotal Claude spend: $${spent.toFixed(3)}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
