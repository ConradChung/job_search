import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/auth/requireOwner'
import { createServiceClient } from '@/lib/supabase/service'
import { moveAction } from '@/lib/actions/pending'

const Body = z.object({
  to: z.enum(['running', 'done', 'failed', 'rejected']),
  result: z.record(z.string(), z.unknown()).optional(),
})

/**
 * The owner's decision on a request the MCP filed. Moves are conditional on
 * the current status (awaiting → running/rejected, running → done/failed), so
 * a request runs once even with two tabs open. The page then runs its own flow.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'bad body' }, { status: 400 })
  const moved = await moveAction(createServiceClient(), id, parsed.data.to, parsed.data.result)
  if (!moved) return NextResponse.json({ error: 'This request was already decided or has expired.' }, { status: 409 })
  return NextResponse.json(moved)
}
