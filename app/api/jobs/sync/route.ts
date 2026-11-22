import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/requireOwner'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchSheetCsv, syncFromCsv } from '@/lib/jobs/sync'

/** "Sync from sheet": pull the Jobs Final CSV export and merge it in. Never writes the sheet. */
export async function POST() {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  try {
    const result = await syncFromCsv(createServiceClient(), await fetchSheetCsv())
    return NextResponse.json({ read: result.read, inserted: result.inserted, updated: result.updated, skipped: result.skipped.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sync failed'
    console.error('[jobs/sync]', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
