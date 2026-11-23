import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/auth/requireOwner'
import { createServiceClient } from '@/lib/supabase/service'

const Body = z.object({ fit_override: z.boolean() })

/** Owner override: draft at this company even though its fit flags fail. Sends nothing. */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const key = decodeURIComponent((await params).key)
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'fit_override (boolean) required' }, { status: 400 })
  const { error } = await createServiceClient()
    .from('company_settings')
    .upsert({ company_key: key, fit_override: parsed.data.fit_override, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
