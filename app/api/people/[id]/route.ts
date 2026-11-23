import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/auth/requireOwner'
import { createServiceClient } from '@/lib/supabase/service'
import { OUTREACH_VALUES, PERSON_COLUMNS } from '@/lib/people/types'
import { noteProblems } from '@/lib/drafts/check'

const Patch = z
  .object({
    outreach_status: z.string().refine((v) => OUTREACH_VALUES.includes(v), 'unknown status').optional(),
    notes: z.string().max(4000).nullable().optional(),
    draft: z.string().max(1000).nullable().optional(),
  })
  .refine((b) => b.outreach_status !== undefined || b.notes !== undefined || b.draft !== undefined, 'nothing to update')

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'bad id' }, { status: 400 })
  const parsed = Patch.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'bad body' }, { status: 400 })
  const db = createServiceClient()
  // An edited note must pass the same code checks as a generated one.
  if (parsed.data.draft) {
    const problems = await noteProblems(db, id, parsed.data.draft)
    if (problems.length) return NextResponse.json({ error: problems.join(' '), problems }, { status: 422 })
  }
  const { data, error } = await db.from('people').update(parsed.data).eq('id', id).select(PERSON_COLUMNS).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'bad id' }, { status: 400 })
  const { error } = await createServiceClient().from('people').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
