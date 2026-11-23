import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/auth/requireOwner'
import { createServiceClient } from '@/lib/supabase/service'
import { approveNotes } from '@/lib/drafts/check'

const Body = z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) })

/** Bulk approve: Drafted → Approved for notes that pass every code check; the rest are listed. */
export async function POST(request: Request) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'bad body' }, { status: 400 })
  try {
    return NextResponse.json(await approveNotes(createServiceClient(), parsed.data.ids))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'approve failed' }, { status: 500 })
  }
}
