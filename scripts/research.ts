/**
 * Role-relevant hook research (owner, 2026-11-23, v2). Companies with a recruiter
 * or job poster whose note is Drafted or Approved (held companies skipped).
 * Per company: GTM leaders, three or four Exa content searches (page text plus
 * role-targeted excerpts), one Claude call; about $0.10. Saves the top three
 * candidates, the first chosen. Stops before the spend cap.
 *   npm run research -- [--cap 8] [--limit N] [--force] [--company KEY]
 * Writes only company_research. Sends nothing.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { loadCompanies } from '../lib/pipeline/load'
import { EST_RESEARCH_COST, researchCompany } from '../lib/research/research'
import { researchInput, saveResearch } from '../lib/research/store'
import { RESEARCHED_BRANCHES } from '../lib/research/gate'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const client = new Anthropic()
  const cap = Number(arg('cap') ?? 8)
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
  const { data: done } = await db.from('company_research').select('company_key, hook_candidates')
  // v2 records carry candidates; v1 records (none) are redone without --force.
  const doneKeys = new Set((done ?? []).filter((d) => (d.hook_candidates as unknown[])?.length).map((d) => d.company_key))
  const todo = companies.filter((c) => force || !doneKeys.has(c.key)).slice(0, limit)
  console.log(`${companies.length} companies in scope; ${todo.length} to research (cap $${cap}).`)

  let spent = 0
  let withHook = 0
  const failed: string[] = []
  const queue = [...todo]
  async function worker() {
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (spent + EST_RESEARCH_COST * 3 > cap) {
        failed.push(`${c.name}: skipped, spend cap`)
        continue
      }
      try {
        const ri = await researchInput(db, c.key)
        if (!ri) throw new Error('no role')
        const r = await researchCompany(client, ri.input)
        spent += r.cost_usd
        const { candidates } = await saveResearch(db, c.key, ri.roleId, r)
        if (candidates.length) withHook++
        const lines = candidates.map((k, n) => `   ${n === 0 ? '*' : ' '} [${k.kind}] ${k.speaker ?? '-'} · ${k.date} · ${k.url}\n       idea: ${k.idea}\n       hook: ${k.hook_sentence}`)
        console.log(
          `\n${candidates.length ? 'HOOK' : 'none'} ${c.name} (${ri.input.roleTitle}) $${r.cost_usd.toFixed(3)} · leaders: ${r.leaders.map((l) => l.name).join(', ') || '-'}${r.fitError ? ` FIT: ${r.fitError}` : ''}\n${lines.join('\n') || `   ${r.why_no_hook}`}\n   fit: ${r.fit_items.join(', ')} · rejected ${r.rejected.length}`
        )
      } catch (err) {
        failed.push(`${c.name}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  console.log(`\nResearched ${todo.length - failed.length}; with a hook ${withHook}; spent $${spent.toFixed(2)}.`)
  if (failed.length) console.log(`Not done:\n  ${failed.join('\n  ')}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
