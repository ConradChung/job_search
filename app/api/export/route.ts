import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/auth/requireOwner'
import { createServiceClient } from '@/lib/supabase/service'
import { runExport } from '@/lib/export/run'

const Body = z.object({
  ids: z.array(z.number().int().positive()).max(5000),
  tiers: z.array(z.number().int().min(1).max(3)).min(1),
  includeExported: z.boolean().default(false),
  limit: z.number().int().positive().max(1000).nullable().default(15),
  write: z.boolean().default(false),
})

/**
 * Sender CSV export (GTM-22). write=false previews (count, skipped, warnings);
 * write=true returns the file and marks those people Exported. Sends nothing.
 */
export async function POST(request: Request) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'bad body' }, { status: 400 })
  try {
    const r = await runExport(createServiceClient(), parsed.data)
    if (parsed.data.write && r.overLimit.length) return NextResponse.json({ ...r, error: 'Some notes are over the limit; nothing was exported.' }, { status: 422 })
    return NextResponse.json(r)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'export failed' }, { status: 500 })
  }
}
