import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/requireOwner'
import { createServiceClient } from '@/lib/supabase/service'
import { importResults } from '@/lib/export/run'

/** Sender results CSV (linkedin_url + status) → people marked Sent or Replied. */
export async function POST(request: Request) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const text = await request.text().catch(() => '')
  if (!text.trim()) return NextResponse.json({ error: 'empty file' }, { status: 400 })
  if (text.length > 5_000_000) return NextResponse.json({ error: 'file too large' }, { status: 413 })
  try {
    const r = await importResults(createServiceClient(), text)
    return NextResponse.json(r, { status: r.error ? 400 : 200 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'import failed' }, { status: 500 })
  }
}
