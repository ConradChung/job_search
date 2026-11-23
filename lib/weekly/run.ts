import type { SupabaseClient } from '@supabase/supabase-js'
import { syncFromCsv } from '@/lib/jobs/sync'
import { enrichOne } from '@/lib/jobs/enrich'
import { classifyOne, estimateClassify, UNCLASSIFIED_COLUMNS, type UnclassifiedJob } from '@/lib/jobs/classifyOne'
import type { ClassifyClient } from '@/lib/jobs/classify'
import { runForCompany } from '@/lib/people/run'
import type { Searcher } from '@/lib/people/find'
import { EST_COST_PER_SEARCH, maxSearches } from '@/lib/people/targets'
import { DraftSkipped, draftForPerson } from '@/lib/drafts/run'
import type { DraftClient } from '@/lib/drafts/generate'
import { draftTargetIds } from '@/lib/drafts/targets'
import { loadCompanies, peopleInOrder } from '@/lib/pipeline/load'
import { rowTrack } from '@/lib/pipeline/filters'
import { blocks, fitTrack, tierOf, type FitTrack } from '@/lib/jobs/fit'
import { PROFILE } from '@/lib/profile'

/**
 * The Tuesday run (owner, 2026-11-23): sync the sheet, check postings, classify
 * new roles, find contacts at newly passing companies, draft their notes, then
 * a Telegram summary. Paid steps stop at the weekly cap; nothing is approved,
 * exported or sent. Resumable: each call advances `stage` until its deadline.
 */
export const WEEKLY = {
  capUsd: 5,
  /** Tiers the run searches and drafts on its own. RevOps (tier 3) stays manual (owner: hold RevOps searches). */
  autoTracks: ['gtm_eng', 'sdr'] as FitTrack[],
  draftEstimate: 0.02,
  appUrl: process.env.APP_URL ?? 'https://job-search-two-sandy.vercel.app',
}

export type Stage = 'sync' | 'enrich' | 'classify' | 'people' | 'drafts' | 'notify' | 'done' | 'failed'
const NEXT: Record<Stage, Stage> = { sync: 'enrich', enrich: 'classify', classify: 'people', people: 'drafts', drafts: 'notify', notify: 'done', done: 'done', failed: 'failed' }

export interface Summary {
  sync?: { read: number; inserted: number; updated: number }
  enrich?: { live: number; dead: number; unchecked: number }
  classify?: { done: number; cost: number; failed: number[] }
  people?: { companies: string[]; saved: number; cost: number; failed: string[] }
  drafts?: { drafted: number; cost: number; skipped: number; failed: number[] }
  /** Paid work left undone because the cap was reached. */
  capped?: { stage: Stage; left: number }
  notified?: boolean
  notify_error?: string
  message?: string
}

export interface WeeklyRun {
  id: number
  trigger: 'cron' | 'manual'
  stage: Stage
  cap_usd: number
  spent_usd: number
  hops: number
  summary: Summary
  started_at: string
}

export interface WeeklyDeps {
  db: SupabaseClient
  sheetCsv: () => Promise<string>
  classifier: () => ClassifyClient
  drafter: () => DraftClient
  searcher: () => Searcher
  telegram: (text: string) => Promise<void>
  now: () => number
}

export async function startRun(db: SupabaseClient, trigger: 'cron' | 'manual', capUsd = WEEKLY.capUsd): Promise<WeeklyRun> {
  const { data, error } = await db.from('weekly_runs').insert({ trigger, cap_usd: capUsd }).select('*').single()
  if (error) throw new Error(`start run: ${error.message}`)
  return normalise(data)
}

export async function loadRun(db: SupabaseClient, id: number): Promise<WeeklyRun | null> {
  const { data } = await db.from('weekly_runs').select('*').eq('id', id).maybeSingle()
  return data ? normalise(data) : null
}

/** The run started in the last 20 hours, if any (so the 15:00 and 16:00 UTC triggers never start two). */
export async function recentRun(db: SupabaseClient, now: number): Promise<WeeklyRun | null> {
  const { data } = await db
    .from('weekly_runs')
    .select('*')
    .gte('started_at', new Date(now - 20 * 3600_000).toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? normalise(data) : null
}

function normalise(r: Record<string, unknown>): WeeklyRun {
  return { ...(r as unknown as WeeklyRun), cap_usd: Number(r.cap_usd), spent_usd: Number(r.spent_usd), summary: (r.summary ?? {}) as Summary }
}

async function save(db: SupabaseClient, run: WeeklyRun, extra: Record<string, unknown> = {}) {
  await db
    .from('weekly_runs')
    .update({ stage: run.stage, spent_usd: run.spent_usd, hops: run.hops, summary: run.summary, updated_at: new Date().toISOString(), ...extra })
    .eq('id', run.id)
}

/** Room under the cap for a unit that may cost `est`. */
export const fits = (run: Pick<WeeklyRun, 'spent_usd' | 'cap_usd'>, est: number) => run.spent_usd + est <= run.cap_usd + 1e-9

/**
 * Advances the run until it is done or `deadline` (ms epoch) is near. Returns
 * the run; `stage !== 'done'` means call again (the route chains itself).
 */
export async function stepWeekly(deps: WeeklyDeps, run: WeeklyRun, deadline: number): Promise<WeeklyRun> {
  const { db } = deps
  const timeLeft = () => deadline - deps.now()
  run.hops++
  try {
    while (run.stage !== 'done' && run.stage !== 'failed' && timeLeft() > 25_000) {
      const finished = await STAGES[run.stage as Exclude<Stage, 'done' | 'failed'>](deps, run, timeLeft)
      if (finished) run.stage = NEXT[run.stage]
      await save(db, run, run.stage === 'done' ? { finished_at: new Date().toISOString() } : {})
      // A stage that stopped for time ends this call; one that just finished a batch goes round again.
      if (!finished && timeLeft() <= 25_000) break
    }
  } catch (err) {
    run.stage = 'failed'
    await save(db, run, { error: err instanceof Error ? err.message.slice(0, 500) : 'failed', finished_at: new Date().toISOString() })
    await deps.telegram(`Job hunt weekly run failed at a step: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}. Nothing was sent. ${WEEKLY.appUrl}`).catch(() => {})
  }
  return run
}

type StageFn = (deps: WeeklyDeps, run: WeeklyRun, timeLeft: () => number) => Promise<boolean>

const STAGES: Record<Exclude<Stage, 'done' | 'failed'>, StageFn> = {
  async sync({ db, sheetCsv }, run) {
    const r = await syncFromCsv(db, await sheetCsv())
    run.summary.sync = { read: r.read, inserted: r.inserted, updated: r.updated }
    return true
  },

  /** New rows (never fetched) and roles still "not checked" from before this run. Free. */
  async enrich({ db }, run, timeLeft) {
    const tally = (run.summary.enrich ??= { live: 0, dead: 0, unchecked: 0 })
    const { data, error } = await db
      .from('jobs')
      .select('id, link, board, description')
      .or(`fetched_at.is.null,and(liveness.eq.unchecked,liveness_checked_at.lt.${run.started_at})`)
      .order('id')
      .limit(40)
    if (error) throw new Error(`enrich: ${error.message}`)
    if (!data?.length) return true
    for (const j of data) {
      if (timeLeft() < 30_000) return false
      tally[await enrichOne(db, j)]++
      if (j.board === 'linkedin') await new Promise((r) => setTimeout(r, 700))
    }
    return false
  },

  async classify({ db, classifier }, run, timeLeft) {
    const s = (run.summary.classify ??= { done: 0, cost: 0, failed: [] })
    let q = db.from('jobs').select(UNCLASSIFIED_COLUMNS).is('classified_at', null).order('id').limit(20)
    if (s.failed.length) q = q.not('id', 'in', `(${s.failed.join(',')})`)
    const { data, error } = await q
    if (error) throw new Error(`classify: ${error.message}`)
    const jobs = (data ?? []) as UnclassifiedJob[]
    if (!jobs.length) return true
    const client = classifier()
    for (const j of jobs) {
      if (timeLeft() < 30_000) return false
      if (!fits(run, estimateClassify(j))) {
        run.summary.capped = { stage: 'classify', left: jobs.length }
        run.stage = 'drafts' // cap reached: skip people search and drafting (drafts → notify next)
        return true
      }
      try {
        const r = await classifyOne(db, client, j)
        s.done++
        s.cost += r.cost
        run.spent_usd += r.cost
      } catch {
        s.failed.push(j.id)
      }
      await save(db, run)
    }
    return false
  },

  /** Contacts at passing tier 1-2 companies never searched. Exa spend, capped. */
  async people({ db, searcher }, run, timeLeft) {
    const s = (run.summary.people ??= { companies: [], saved: 0, cost: 0, failed: [] })
    const companies = await loadCompanies(db)
    const todo = companies.filter((c) => WEEKLY.autoTracks.includes(rowTrack(c)) && !c.searchedAt && !s.failed.includes(c.key))
    if (!todo.length) return true
    const search = searcher()
    for (const c of todo) {
      if (timeLeft() < 40_000) return false
      const est = maxSearches(c.band, c.track, c.fitTrack === 'sdr') * EST_COST_PER_SEARCH
      if (!fits(run, est)) {
        run.summary.capped = { stage: 'people', left: todo.length - todo.indexOf(c) }
        return true
      }
      try {
        const r = await runForCompany(db, c.key, search)
        s.companies.push(c.name)
        s.saved += r.saved
        s.cost += r.cost
        run.spent_usd += r.cost
      } catch {
        s.failed.push(c.key)
      }
      await save(db, run)
    }
    return true
  },

  /** Notes for draft targets without one, tier 1-2 companies that can draft. Claude spend, capped. */
  async drafts({ db, drafter }, run, timeLeft) {
    const s = (run.summary.drafts ??= { drafted: 0, cost: 0, skipped: 0, failed: [] })
    const companies = await loadCompanies(db)
    const scoped = companies.filter((c) => WEEKLY.autoTracks.includes(rowTrack(c)) && c.canDraft)
    const targets = draftTargetIds(companies.flatMap((c) => c.people), new Set(companies.filter((c) => c.fitTrack === 'sdr').map((c) => c.key)))
    const todo = peopleInOrder(scoped).filter((p) => targets.has(p.id) && !p.draft && p.outreach_status === 'none' && !s.failed.includes(p.id))
    if (!todo.length) return true
    const client = drafter()
    for (const p of todo) {
      if (timeLeft() < 40_000) return false
      if (!fits(run, WEEKLY.draftEstimate)) {
        run.summary.capped = { stage: 'drafts', left: todo.length - todo.indexOf(p) }
        return true
      }
      try {
        const r = await draftForPerson(db, client, p.id)
        s.drafted++
        s.cost += r.cost
        run.spent_usd += r.cost
      } catch (err) {
        if (err instanceof DraftSkipped) s.skipped++
        s.failed.push(p.id) // never retried this run, so a bad row can't loop
      }
      await save(db, run)
    }
    return false
  },

  async notify(deps, run) {
    const text = await weeklyMessage(deps.db, run)
    run.summary.message = text
    // A missing or failing Telegram never fails the run: the summary is kept on the row.
    try {
      await deps.telegram(text)
      run.summary.notified = true
    } catch (err) {
      run.summary.notified = false
      run.summary.notify_error = err instanceof Error ? err.message.slice(0, 200) : 'telegram failed'
    }
    return true
  },
}

/** The Tuesday summary: new roles, passing by tier, contacts found, notes ready to approve, spend. */
export async function weeklyMessage(db: SupabaseClient, run: WeeklyRun): Promise<string> {
  const companies = await loadCompanies(db)
  const s = run.summary
  const { data: fresh } = await db.from('jobs').select('id').gte('created_at', run.started_at)
  const freshIds = new Set((fresh ?? []).map((j) => j.id as number))
  const passingNew: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
  for (const c of companies)
    for (const r of c.roles) {
      const tier = tierOf(fitTrack(r.category))
      if (freshIds.has(r.id) && tier && !blocks(c.roleFlags[r.id] ?? [])) passingNew[tier]++
    }
  const toApprove = (t: FitTrack) => companies.filter((c) => rowTrack(c) === t).flatMap((c) => c.people).filter((p) => p.outreach_status === 'drafted' && p.draft).length
  const ready = (t: FitTrack) => companies.filter((c) => rowTrack(c) === t).flatMap((c) => c.people).filter((p) => p.outreach_status === 'approved').length
  const tiers: FitTrack[] = ['gtm_eng', 'sdr', 'revops']
  const label = (t: FitTrack) => `T${tierOf(t)} ${PROFILE.constraints.tracks[t].label}`
  const lines = [
    `Job hunt · weekly update${run.trigger === 'manual' ? ' (manual run)' : ''}`,
    '',
    `New roles from the sheet: ${s.sync?.inserted ?? 0} (passing: ${tiers.map((t) => `T${tierOf(t)} ${passingNew[tierOf(t)]}`).join(', ')})`,
    `Postings checked: ${s.enrich?.live ?? 0} live, ${s.enrich?.dead ?? 0} closed, ${s.enrich?.unchecked ?? 0} not reachable`,
    `Contacts found: ${s.people?.saved ?? 0} at ${s.people?.companies.length ?? 0} new companies${s.people?.companies.length ? ` (${s.people.companies.slice(0, 6).join(', ')}${s.people.companies.length > 6 ? ', …' : ''})` : ''}`,
    `Notes drafted: ${s.drafts?.drafted ?? 0}`,
    '',
    'Waiting on you:',
    ...tiers.map((t) => `· ${label(t)}: ${toApprove(t)} to approve, ${ready(t)} approved and ready to export`),
    '',
    `Spend this run: $${run.spent_usd.toFixed(2)} of the $${run.cap_usd.toFixed(2)} cap${s.capped ? `. Cap reached at ${s.capped.stage}: ${s.capped.left} left for next week or a manual run` : ''}`,
    'Nothing was approved, exported or sent.',
    WEEKLY.appUrl,
  ]
  return lines.join('\n')
}

/** Telegram via the bot already used for Lume alerts. Throws if not configured. */
export function telegramSender(token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID) {
  return async (text: string) => {
    if (!token || !chatId) throw new Error('Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)')
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    })
    if (!res.ok) throw new Error(`Telegram ${res.status}`)
  }
}

/** True at 8am in Los Angeles: the cron fires at 15:00 and 16:00 UTC so one of them is always 8am Pacific. */
export function isEightAmPacific(now: number): boolean {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(new Date(now))
  return Number(hour) === 8
}
