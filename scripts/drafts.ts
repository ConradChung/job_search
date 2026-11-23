/**
 * Draft LinkedIn notes: `npm run drafts -- [options]`
 *
 *   --companies "a,b"   only these company_keys
 *   --ids "1,2"         only these people ids
 *   --status drafted    only people in this outreach status (default: none + drafted)
 *   --redo              include people who already have a draft
 *   --fresh             with --redo: clear the selected drafts before redrafting,
 *                       so siblings are compared with new notes only
 *   --clear-blocked     clear Drafted notes at companies whose fit flags now block
 *   --limit 500         at most this many people (default 500)
 *   --followup-only     with --ids: write only the after-accept message, keep the note
 *   --yes               actually do it (without it: preview only)
 *
 * Never touches approved, sent or replied notes. Nothing is ever sent.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { DraftSkipped, draftForPerson, followupForPerson } from '../lib/drafts/run'
import { loadCompany } from '../lib/people/run'
import { draftTargetIds } from '../lib/drafts/targets'

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(`--${n}`)
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
// Note + after-accept message, with retries (measured 2026-11-24: about $0.02 each).
const EST_PER_DRAFT = 0.02

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (flag('clear-blocked')) {
    const { data } = await db.from('people').select('id, company_key').eq('outreach_status', 'drafted')
    const keys = [...new Set((data ?? []).map((p) => p.company_key))]
    const blocked: string[] = []
    for (const k of keys) {
      const loaded = await loadCompany(db, k)
      if (loaded && !loaded.fit.canDraft) blocked.push(k)
    }
    const ids = (data ?? []).filter((p) => blocked.includes(p.company_key)).map((p) => p.id)
    console.log(`${ids.length} Drafted notes at ${blocked.length} blocked companies: ${blocked.join(', ')}`)
    if (flag('yes') && ids.length) {
      await db.from('people').update({ draft: null, draft_generated_at: null, outreach_status: 'none' }).in('id', ids)
      console.log('cleared')
    }
    return
  }

  const status = opt('status', '')
  // Only untouched notes: anything approved, sent or replied is never redrafted.
  let q = db
    .from('people')
    .select('id, company_key, company, full_name, branch, rank')
    .in('outreach_status', status ? [status] : ['none', 'drafted'])
    .order('company_key')
    .order('branch')
    .order('rank')
  const ids = opt('ids', '')
  if (ids) q = q.in('id', ids.split(',').map(Number))
  else if (!flag('redo')) q = q.is('draft', null)
  const companies = opt('companies', '')
  if (companies) q = q.in('company_key', companies.split(',').map((s) => s.trim()))
  const { data, error } = await q.limit(Number(opt('limit', '500')))
  if (error) throw new Error(error.message)
  // Top alum + top recruiter per company only, unless specific ids are given.
  let people = data ?? []
  if (!ids) {
    const { data: everyone } = await db.from('people').select('id, company_key, branch, rank, title, draft')
    // SDR companies: the sales leader / founder replaces the recruiter as a target.
    const sdr = new Set<string>()
    for (const k of new Set(people.map((p) => p.company_key))) {
      const loaded = await loadCompany(db, k)
      if (loaded?.fit.track === 'sdr') sdr.add(k)
    }
    const targets = draftTargetIds(everyone ?? [], sdr)
    people = people.filter((p) => targets.has(p.id))
  }
  // Leaders first, so their note takes the prospecting line and the alum's varies from it.
  const lead = (b: string) => (b === 'gtm_leadership' || b === 'executive' ? 0 : 1)
  people.sort((a, b) => a.company_key.localeCompare(b.company_key) || lead(a.branch) - lead(b.branch))

  console.log(`${people.length} people, about $${(people.length * EST_PER_DRAFT).toFixed(2)} (estimate)`)
  if (!flag('yes')) {
    console.log('Preview only. Re-run with --yes to draft.')
    return
  }

  if (flag('redo') && flag('fresh') && people.length) {
    await db.from('people').update({ draft: null }).in('id', people.map((p) => p.id))
  }

  const client = new Anthropic()
  if (flag('followup-only')) {
    // After-accept message only, keeping the note exactly as written.
    for (const p of people) {
      const f = await followupForPerson(db, client, p.id)
      console.log(`\n[${p.company}] ${p.full_name} follow-up $${f.cost.toFixed(4)}${f.problems.length ? ` PROBLEMS: ${f.problems.join(' ')}` : ''}\n${f.text}`)
    }
    return
  }
  let spent = 0
  const skipped: Record<string, number> = {}
  for (const p of people) {
    try {
      const r = await draftForPerson(db, client, p.id)
      spent += r.cost
      console.log(
        `\n[${p.company}] ${p.full_name} (${p.branch}) ${r.text.length} chars $${r.cost.toFixed(4)} [${r.proof.key}${r.proof.partner ? `:${r.proof.partner}` : ''}]${r.problems.length ? ` PROBLEMS: ${r.problems.join(' ')}` : ''}\n${r.text}`
      )
    } catch (err) {
      if (err instanceof DraftSkipped) {
        skipped[err.message] = (skipped[err.message] ?? 0) + 1
        continue
      }
      console.error(`${p.company} / ${p.full_name}: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log('\nSkipped:', skipped)
  console.log(`Total Claude spend: $${spent.toFixed(3)}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
