import { after, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/service'
import { secretMatches } from '@/lib/mcp/auth'
import { fetchSheetCsv } from '@/lib/jobs/sync'
import { exaSearcher } from '@/lib/people/exa'
import { isEightAmPacific, loadRun, recentRun, startRun, stepWeekly, telegramSender, type WeeklyDeps } from '@/lib/weekly/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Each call works for at most this long, then hands off to the next call. */
const BUDGET_MS = 240_000
const MAX_HOPS = 40

/**
 * Weekly Tuesday run (vercel.json crons at 15:00 and 16:00 UTC; only the one
 * that is 8am in Los Angeles starts a run). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; anything else is 401. A run that needs
 * more time continues in a fresh call (?run=<id>) after this one responds.
 * `?force=1` starts a run at any hour (manual test, same secret).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!secret || secret.length < 32 || !secretMatches(auth, secret)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const db = createServiceClient()
  const now = Date.now()
  const deps: WeeklyDeps = {
    db,
    sheetCsv: () => fetchSheetCsv(),
    classifier: () => new Anthropic(),
    drafter: () => new Anthropic(),
    searcher: () => exaSearcher(),
    telegram: telegramSender(),
    now: () => Date.now(),
  }

  let run
  const runId = Number(url.searchParams.get('run'))
  if (runId) {
    run = await loadRun(db, runId)
    if (!run) return NextResponse.json({ error: 'no such run' }, { status: 404 })
    if (run.stage === 'done' || run.stage === 'failed') return NextResponse.json({ run: run.id, stage: run.stage })
    if (run.hops >= MAX_HOPS) return NextResponse.json({ run: run.id, stage: run.stage, stopped: 'too many hops' })
  } else {
    const force = url.searchParams.get('force') === '1'
    if (!force && !isEightAmPacific(now)) return NextResponse.json({ skipped: 'not 8am in Los Angeles' })
    const recent = await recentRun(db, now)
    if (recent && !force) return NextResponse.json({ skipped: 'already ran in the last 20 hours', run: recent.id, stage: recent.stage })
    run = await startRun(db, force ? 'manual' : 'cron')
  }

  run = await stepWeekly(deps, run, now + BUDGET_MS)

  if (run.stage !== 'done' && run.stage !== 'failed') {
    const next = new URL(url.origin + url.pathname)
    next.searchParams.set('run', String(run.id))
    after(async () => {
      await fetch(next, { headers: { authorization: `Bearer ${secret}` } }).catch((err) => console.error('[cron/weekly] hand-off failed', err instanceof Error ? err.message : err))
    })
  }
  return NextResponse.json({ run: run.id, stage: run.stage, spent_usd: run.spent_usd, hops: run.hops })
}
