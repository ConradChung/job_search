import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/auth/requireOwner'
import { createServiceClient } from '@/lib/supabase/service'

const Body = z.object({ reviewed: z.boolean() })

/** Owner tick "I've read this" on the company's researched hook. Unlocks approve and export; sends nothing. */
export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const key = decodeURIComponent((await params).key)
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'reviewed (boolean) required' }, { status: 400 })
  const now = new Date().toISOString()
  const { data, error } = await createServiceClient()
    .from('company_research')
    .update({ hook_reviewed_at: parsed.data.reviewed ? now : null, updated_at: now })
    .eq('company_key', key)
    .select('company_key')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'no research for this company' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
