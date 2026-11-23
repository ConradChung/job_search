/**
 * Job enrichment: `npm run enrich -- [--skip-apify] [--skip-fetch] [--refetch]`
 *
 * 1. Apify backfill: descriptions for LinkedIn rows from the gtm-job-scrape
 *    datasets (curious_coder/linkedin-jobs-scraper keeps `descriptionText`).
 * 2. Fetch every posting for live/dead; fill department and any missing
 *    description from the Ashby / Greenhouse / Lever APIs, LinkedIn's public
 *    page as a one-try fallback.
 *    --board other  limit the fetch to one board
 *    --unchecked    re-check only roles still marked "not checked"
 *    --slow         one LinkedIn request every 4s (use after a 429 rate limit)
 * Free: no paid API calls.
 */
import { createClient } from '@supabase/supabase-js'
import { fetchPosting, parseAtsLink } from '../lib/jobs/fetch'

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(`--${n}`)
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

interface Job {
  id: number
  link: string
  board: string | null
  description: string | null
}

async function allJobs(): Promise<Job[]> {
  const { data, error } = await db.from('jobs').select('id, link, board, description, fetched_at, liveness').order('id')
  if (error) throw new Error(error.message)
  const board = args.includes('--board') ? args[args.indexOf('--board') + 1] : null
  const unchecked = flag('unchecked')
  return (data ?? []).filter(
    (j) => (unchecked ? !j.liveness || j.liveness === 'unchecked' : flag('refetch') || !j.fetched_at) && (!board || j.board === board)
  )
}

async function apifyBackfill() {
  const token = process.env.APIFY_API_TOKEN
  if (!token) return console.log('apify: APIFY_API_TOKEN not set, skipped')
  const h = { authorization: `Bearer ${token}` }
  const datasets: string[] = []
  for (let offset = 0; ; offset += 100) {
    const r = await fetch(`https://api.apify.com/v2/acts/curious_coder~linkedin-jobs-scraper/runs?limit=100&offset=${offset}`, { headers: h })
    const items = (await r.json()).data?.items ?? []
    for (const run of items) if (run.status === 'SUCCEEDED' && run.defaultDatasetId) datasets.push(run.defaultDatasetId)
    if (items.length < 100) break
  }
  const byId = new Map<string, string>()
  for (const ds of datasets) {
    const r = await fetch(`https://api.apify.com/v2/datasets/${ds}/items?clean=true&fields=id,link,descriptionText`, { headers: h })
    if (!r.ok) continue
    for (const it of (await r.json()) as { id?: string; link?: string; descriptionText?: string }[]) {
      const id = it.id ?? (it.link ? parseAtsLink(it.link)?.id : undefined)
      if (id && it.descriptionText && !byId.has(String(id))) byId.set(String(id), it.descriptionText)
    }
  }
  const jobs = (await db.from('jobs').select('id, link').eq('board', 'linkedin').is('description', null)).data ?? []
  let filled = 0
  for (const j of jobs) {
    const id = parseAtsLink(j.link)?.id
    const desc = id ? byId.get(id) : undefined
    if (!desc) continue
    await db.from('jobs').update({ description: desc, description_source: 'apify' }).eq('id', j.id)
    filled++
  }
  console.log(`apify: ${datasets.length} datasets, ${byId.size} postings, filled ${filled} of ${jobs.length} LinkedIn rows`)
}

async function fetchAll() {
  const jobs = await allJobs()
  const linkedin = jobs.filter((j) => j.board === 'linkedin')
  const rest = jobs.filter((j) => j.board !== 'linkedin')
  const tally: Record<string, number> = {}
  const bump = (k: string) => (tally[k] = (tally[k] ?? 0) + 1)

  const one = async (j: Job) => {
    const r = await fetchPosting(j.link)
    const update: Record<string, unknown> = {
      fetched_at: new Date().toISOString(),
      fetch_error: r.error,
      liveness_checked_at: new Date().toISOString(),
    }
    if (r.live === true) update.liveness = 'live'
    if (r.live === null) {
      update.liveness = 'unchecked'
      update.liveness_reason = r.error
    }
    if (r.live === false) {
      update.liveness = 'dead'
      update.liveness_reason = 'posting closed or removed'
    }
    if (r.department) update.department = r.department
    if (r.description && !j.description) {
      update.description = r.description
      update.description_source = r.source
    }
    await db.from('jobs').update(update).eq('id', j.id)
    bump(r.live === true ? 'live' : r.live === false ? 'dead' : 'unchecked')
  }

  const pool = async (list: Job[], size: number, pauseMs: number) => {
    let i = 0
    await Promise.all(
      Array.from({ length: size }, async () => {
        while (i < list.length) {
          const j = list[i++]
          await one(j)
          if (pauseMs) await new Promise((res) => setTimeout(res, pauseMs))
        }
      })
    )
  }
  // --slow: one LinkedIn request every few seconds (after a run hit their rate limit).
  await Promise.all([pool(rest, 4, 0), flag('slow') ? pool(linkedin, 1, 4000) : pool(linkedin, 2, 700)])
  console.log(`fetch: ${jobs.length} jobs`, tally)
}

async function main() {
  if (!flag('skip-apify')) await apifyBackfill()
  if (!flag('skip-fetch')) await fetchAll()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
