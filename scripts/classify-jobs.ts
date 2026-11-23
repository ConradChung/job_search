/**
 * Classify jobs with Claude: `npm run classify -- [options]`
 *
 *   --ids "1,2"     only these job ids
 *   --limit 600     at most this many (default 600)
 *   --redo          also re-classify already classified jobs
 *   --yes           actually call Claude (without it: preview + estimate)
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { classificationRow, classifyJob } from '../lib/jobs/classify'
import { guessFromTitle } from '../lib/jobs/titleGuess'

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(`--${n}`)
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  let q = db.from('jobs').select('id, company, title, location, department, description, raw, liveness').order('id')
  const ids = opt('ids', '')
  if (ids) q = q.in('id', ids.split(',').map(Number))
  else if (!flag('redo')) q = q.is('classified_at', null)
  const { data, error } = await q.limit(Number(opt('limit', '600')))
  if (error) throw new Error(error.message)
  const all = data ?? []
  // Closed postings with no text: free title guess, low confidence, no Claude call.
  const guessed = all.filter((j) => j.liveness === 'dead' && (j.description ?? '').length < 400)
  const jobs = all.filter((j) => !guessed.includes(j))
  const withDesc = jobs.filter((j) => (j.description ?? '').length >= 400).length
  const est = withDesc * 0.018 + (jobs.length - withDesc) * 0.006
  console.log(`${all.length} jobs: ${withDesc} with a posting + ${jobs.length - withDesc} title-only live/unchecked -> Claude (about $${est.toFixed(2)}); ${guessed.length} closed title-only -> free title guess`)
  if (!flag('yes')) return console.log('Preview only. Re-run with --yes.')

  for (const j of guessed) {
    const g = guessFromTitle(j.title)
    await db
      .from('jobs')
      .update({
        category: g.category,
        category_confidence: 'low',
        seniority: g.seniority,
        work_mode: 'unknown',
        start_requirement: 'unknown',
        classification: { reason: 'Title guess: posting closed, no description to read.', method: 'title_guess' },
        classified_at: new Date().toISOString(),
      })
      .eq('id', j.id)
  }

  const client = new Anthropic()
  let spent = 0
  const counts: Record<string, number> = {}
  let i = 0
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (i < jobs.length) {
        const j = jobs[i++]
        try {
          const r = await classifyJob(client, {
            title: j.title,
            company: j.company,
            industries: (j.raw as Record<string, string>)?.industries ?? null,
            location: j.location,
            sheetSeniority: (j.raw as Record<string, string>)?.seniorityLevel ?? null,
            department: j.department,
            description: j.description,
          })
          spent += r.cost
          const key = `${r.classification.category}/${r.confidence}`
          counts[key] = (counts[key] ?? 0) + 1
          await db.from('jobs').update(classificationRow(r)).eq('id', j.id)
          if (ids) console.log(`${j.id} ${j.company} | ${j.title} → ${r.classification.category} (${r.confidence}), ${r.classification.seniority}, ${r.classification.work_mode} ${r.classification.work_locations.join('/')}, start ${r.classification.start_requirement} · $${r.cost.toFixed(4)}\n   ${r.classification.reason}`)
        } catch (err) {
          console.error(`${j.id} ${j.company}: ${err instanceof Error ? err.message : err}`)
        }
      }
    })
  )
  console.log(counts)
  console.log(`Total Claude spend: $${spent.toFixed(3)}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
