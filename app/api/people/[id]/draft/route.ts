import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireOwner } from '@/lib/auth/requireOwner'
import { createServiceClient } from '@/lib/supabase/service'
import { DraftSkipped, draftForPerson } from '@/lib/drafts/run'
import { PERSON_COLUMNS } from '@/lib/people/types'

export const maxDuration = 60

/** Generate or regenerate one person's LinkedIn note. Nothing is sent. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'bad id' }, { status: 400 })
  const db = createServiceClient()
  try {
    const r = await draftForPerson(db, new Anthropic(), id)
    const { data } = await db.from('people').select(PERSON_COLUMNS).eq('id', id).single()
    return NextResponse.json({ person: data, cost: r.cost, problems: r.problems, proof: r.proof })
  } catch (err) {
    if (err instanceof DraftSkipped) return NextResponse.json({ skipped: true, error: `Not drafted: ${err.message}` }, { status: 409 })
    if (err instanceof Anthropic.RateLimitError) return NextResponse.json({ error: 'Claude rate limit, try again shortly' }, { status: 429 })
    if (err instanceof Anthropic.APIError) return NextResponse.json({ error: `Claude API ${err.status}` }, { status: 502 })
    const message = err instanceof Error ? err.message : 'draft failed'
    console.error('[people/draft]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
