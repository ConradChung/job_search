import type { SupabaseClient } from '@supabase/supabase-js'
import { parseCsv } from './csv'
import { factsOf, parseJobsFinal, type JobInsert } from './normalize'

export interface SyncResult {
  read: number
  inserted: number
  updated: number
  skipped: { sheetRow: number; reason: string }[]
}

/** Split parsed rows into new ones and ones already in the table, by (company_key, link_key). */
export function planSync(rows: JobInsert[], existingKeys: Set<string>) {
  const toInsert: JobInsert[] = []
  const toUpdate: JobInsert[] = []
  for (const r of rows) {
    if (existingKeys.has(`${r.company_key}|${r.link_key}`)) toUpdate.push(r)
    else toInsert.push(r)
  }
  return { toInsert, toUpdate }
}

const CHUNK = 200

/**
 * Sheet → table. New rows are inserted with their sheet status seeded;
 * existing rows only get their sheet facts refreshed, so status, notes and
 * liveness set in the dashboard are never overwritten. Rows removed from the
 * sheet stay in the table. The sheet is only read.
 */
export async function syncFromCsv(db: SupabaseClient, csvText: string): Promise<SyncResult> {
  const { rows, skipped } = parseJobsFinal(parseCsv(csvText))

  const existing = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('jobs').select('company_key, link_key').range(from, from + 999)
    if (error) throw new Error(`read existing jobs: ${error.message}`)
    for (const r of data ?? []) existing.add(`${r.company_key}|${r.link_key}`)
    if (!data || data.length < 1000) break
  }

  const { toInsert, toUpdate } = planSync(rows, existing)

  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const { error } = await db.from('jobs').insert(toInsert.slice(i, i + CHUNK))
    if (error) throw new Error(`insert jobs: ${error.message}`)
  }
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const { error } = await db
      .from('jobs')
      .upsert(toUpdate.slice(i, i + CHUNK).map(factsOf), { onConflict: 'company_key,link_key' })
    if (error) throw new Error(`refresh jobs: ${error.message}`)
  }

  return { read: rows.length, inserted: toInsert.length, updated: toUpdate.length, skipped }
}

export async function fetchSheetCsv(url = process.env.SHEET_CSV_URL): Promise<string> {
  if (!url) throw new Error('SHEET_CSV_URL is not set')
  const res = await fetch(url, { redirect: 'follow', cache: 'no-store' })
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || !type.includes('text/csv')) {
    throw new Error(`sheet export failed (${res.status} ${type}); is the sheet still shared by link?`)
  }
  return res.text()
}
