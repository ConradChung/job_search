/**
 * Company research for the after-accept messages (owner, 2026-11-23).
 * Companies with a recruiter or job poster whose note is Drafted or Approved
 * (held companies skipped). Two Exa searches + one Claude call each, about $0.05.
 * Stops before the spend cap. Already-researched companies are skipped unless --force.
 *   npm run research -- [--cap 4] [--limit N] [--force] [--company KEY]
 * Writes only company_research. Sends nothing.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { loadCompanies } from '../lib/pipeline/load'
import { EST_RESEARCH_COST, researchCompany } from '../lib/research/research'
import { RESEARCHED_BRANCHES } from '../lib/research/gate'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const client = new Anthropic()
  const cap = Number(arg('cap') ?? 4)
  const limit = arg('limit') ? Number(arg('limit')) : Infinity
  const only = arg('company')
  const force = process.argv.includes('--force')

  const companies = (await loadCompanies(db)).filter(
    (c) =>
      c.canDraft &&
      c.primary &&
      (!only || c.key === only) &&
      c.people.some((p) => RESEARCHED_BRANCHES.includes(p.branch) && ['drafted', 'approved'].includes(p.outreach_status) && p.draft)
  )
  const { data: done } = await db.from('company_research').select('company_key')
  const doneKeys = new Set((done ?? []).map((d) => d.company_key))
  const todo = companies.filter((c) => force || !doneKeys.has(c.key)).slice(0, limit)
  console.log(`${companies.length} companies in scope; ${todo.length} to research (cap $${cap}).`)

  let spent = 0
  let hooks = 0
  const failed: string[] = []
  const queue = [...todo]
  async function worker() {
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (spent + EST_RESEARCH_COST * 2 > cap) {
        failed.push(`${c.name}: skipped, spend cap`)
        continue
      }
      try {
        const { data: job } = await db.from('jobs').select('title, description, raw').eq('id', c.primary!.id).maybeSingle()
        const r = await researchCompany(client, {
          company: c.name,
          website: c.website,
          industries: ((job?.raw as Record<string, string> | null)?.industries ?? null) || null,
          roleTitle: job?.title ?? c.primary!.title ?? '',
          posting: (job?.description as string | null) ?? '',
        })
        spent += r.cost_usd
        const { fitError, ...rec } = r
        const { data: prev } = await db.from('company_research').select('hook_source_url, hook_sentence, hook_reviewed_at').eq('company_key', c.key).maybeSingle()
        const sameHook = !!prev && prev.hook_source_url === rec.hook_source_url && prev.hook_sentence === rec.hook_sentence
        const now = new Date().toISOString()
        const { error } = await db.from('company_research').upsert({
          company_key: c.key,
          role_id: c.primary!.id,
          ...rec,
          // A new or changed hook must be read again.
          hook_reviewed_at: sameHook ? prev!.hook_reviewed_at : null,
          researched_at: now,
          updated_at: now,
        })
        if (error) throw new Error(error.message)
        if (rec.hook_sentence) hooks++
        console.log(
          `${rec.hook_sentence ? 'HOOK' : 'none'} ${c.name} $${r.cost_usd.toFixed(3)}${fitError ? ` FIT: ${fitError}` : ''}\n   ${rec.hook_sentence ?? rec.why_no_hook}\n   ${rec.hook_source_url ?? ''} ${rec.hook_date ?? ''}\n   fit: ${rec.fit_items.join(', ')}`
        )
      } catch (err) {
        failed.push(`${c.name}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  console.log(`\nResearched ${todo.length - failed.length}; with a hook ${hooks}; spent $${spent.toFixed(2)}.`)
  if (failed.length) console.log(`Not done:\n  ${failed.join('\n  ')}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
