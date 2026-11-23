import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/auth/requireOwner'
import { createServiceClient } from '@/lib/supabase/service'
import { STATUS_VALUES } from '@/lib/jobs/statuses'
import { refreshRecruiterFollowups } from '@/lib/drafts/recruiterFollowups'

const Patch = z
  .object({
    status: z.string().refine((v) => STATUS_VALUES.includes(v), 'unknown status').optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .refine((b) => b.status !== undefined || b.notes !== undefined, 'nothing to update')

/** Update a job's tracking fields (status, notes). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  const parsed = Patch.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'bad body' }, { status: 400 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('jobs')
    .update(parsed.data)
    .eq('id', id)
    .select('id, company_key, status, notes, status_changed_at, updated_at')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // Status drives the recruiter after-accept wording (applied or not): refresh it, free, from the template.
  let followups = 0
  if (parsed.data.status !== undefined) {
    const r = await refreshRecruiterFollowups(db, { companyKey: data.company_key, write: true }).catch(() => null)
    followups = r?.changes.filter((c) => !c.problems.length).length ?? 0
  }
  return NextResponse.json({ ...data, followups })
}
