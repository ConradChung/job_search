/**
 * Re-check stored hook candidates against their pages (attribution: show names and
 * speakers). Fetches page text only (Exa contents, about $0.001 a page). Failing
 * candidates are dropped, never edited; the pick moves to the next one when needed,
 * and recruiter messages are rewritten.  npm run revalidate-hooks -- [--yes]
 */
import { createClient } from '@supabase/supabase-js'
import { attributionProblems, type HookCandidate } from '../lib/research/research'
import { hookFields } from '../lib/research/store'
import { refreshRecruiterFollowups } from '../lib/drafts/recruiterFollowups'

async function pages(urls: string[]) {
  const r = await fetch('https://api.exa.ai/contents', {
    method: 'POST',
    headers: { 'x-api-key': process.env.EXA_API_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({ urls, text: { maxCharacters: 30000 } }),
  })
  const d = (await r.json()) as { results?: { url: string; title?: string; text?: string }[]; costDollars?: { total?: number } }
  return { byUrl: new Map((d.results ?? []).map((x) => [x.url, x])), cost: Number(d.costDollars?.total ?? 0) }
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const write = process.argv.includes('--yes')
  const { data } = await db
    .from('company_research')
    .select('company_key, hook_candidates, chosen_index, rejected, hook_reviewed_at, hook_source_url, hook_sentence')
    .order('company_key')
  let cost = 0
  let dropped = 0
  for (const row of data ?? []) {
    const list = (row.hook_candidates ?? []) as HookCandidate[]
    if (!list.length) continue
    const { byUrl, cost: c } = await pages(list.map((x) => x.url))
    cost += c
    const keep: HookCandidate[] = []
    const why: string[] = []
    for (const cand of list) {
      const page = byUrl.get(cand.url)
      // Unreadable now: keep it (it passed when researched); only a positive mismatch drops it.
      const problems = page
        ? attributionProblems(cand, { url: cand.url, title: page.title ?? cand.title, text: (page.text ?? '').replace(/\s+/g, ' '), highlights: [] })
        : []
      if (problems.length) why.push(`${cand.url}: ${problems.join(' ')}`)
      else keep.push(cand)
    }
    if (!why.length) continue
    dropped += why.length
    const chosen = row.chosen_index === null ? null : list[row.chosen_index]
    const stillChosen = chosen ? keep.findIndex((k) => k.url === chosen.url) : -1
    const nextIndex = row.chosen_index === null ? null : stillChosen >= 0 ? stillChosen : keep.length ? 0 : null
    const next = nextIndex === null ? null : keep[nextIndex]
    console.log(`${row.company_key}: dropped ${why.length}\n  ${why.join('\n  ')}\n  pick: ${next ? `${next.speaker ?? '-'} · ${next.url}` : 'none'}`)
    if (!write) continue
    const same = !!next && row.hook_source_url === next.url && row.hook_sentence === next.hook_sentence
    const { error } = await db
      .from('company_research')
      .update({
        hook_candidates: keep,
        chosen_index: nextIndex,
        ...hookFields(next),
        hook_reviewed_at: same ? row.hook_reviewed_at : null,
        why_no_hook: next ? null : 'Every candidate failed the attribution check.',
        rejected: [...((row.rejected as string[]) ?? []), ...why],
        updated_at: new Date().toISOString(),
      })
      .eq('company_key', row.company_key)
    if (error) throw new Error(error.message)
    await refreshRecruiterFollowups(db, { companyKey: row.company_key, write: true })
  }
  console.log(`\nDropped ${dropped} candidate(s); Exa $${cost.toFixed(3)}${write ? '' : ' (preview; --yes to write)'}.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
