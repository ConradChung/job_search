/**
 * The Tuesday run, by hand: `npm run weekly -- [--cap 5] [--yes]`
 * Same steps as the cron (sync, live check, classify, find people, draft,
 * Telegram summary), stopping paid steps at --cap. Without --yes the cap is 0:
 * only the free steps run and nothing is spent. Nothing is approved or sent.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { fetchSheetCsv } from '../lib/jobs/sync'
import { exaSearcher } from '../lib/people/exa'
import { startRun, stepWeekly, telegramSender, WEEKLY } from '../lib/weekly/run'

const args = process.argv.slice(2)
const opt = (n: string, d: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const cap = args.includes('--yes') ? Number(opt('cap', String(WEEKLY.capUsd))) : 0
  let run = await startRun(db, 'manual', cap)
  console.log(`run ${run.id}, cap $${cap.toFixed(2)}${cap === 0 ? ' (free steps only; add --yes to spend)' : ''}`)
  while (run.stage !== 'done' && run.stage !== 'failed') {
    run = await stepWeekly(
      {
        db,
        sheetCsv: () => fetchSheetCsv(),
        classifier: () => new Anthropic(),
        drafter: () => new Anthropic(),
        searcher: () => exaSearcher(),
        telegram: telegramSender(),
        now: () => Date.now(),
      },
      run,
      Date.now() + 3_600_000
    )
    console.log(`stage ${run.stage}, spent $${run.spent_usd.toFixed(3)}`)
  }
  console.log(JSON.stringify(run.summary, null, 2))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
