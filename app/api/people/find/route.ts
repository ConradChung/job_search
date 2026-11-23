import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/auth/requireOwner'
import { createServiceClient } from '@/lib/supabase/service'
import { exaSearcher } from '@/lib/people/exa'
import { runForCompany } from '@/lib/people/run'

export const maxDuration = 60

const Body = z.object({ company_key: z.string().min(1).max(200) })

/** Run the Exa people search for one company (the UI loops for batches). */
export async function POST(request: Request) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'company_key required' }, { status: 400 })
  try {
    const r = await runForCompany(createServiceClient(), parsed.data.company_key, exaSearcher())
    return NextResponse.json({ company: r.company, band: r.band, searches: r.searches, cost: r.cost, found: r.found, saved: r.saved })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'search failed'
    console.error('[people/find]', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
