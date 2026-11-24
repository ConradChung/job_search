import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { requireOwner } from '@/lib/auth/requireOwner'
import { createServiceClient } from '@/lib/supabase/service'
import { chooseCandidate, applyOwnLink } from '@/lib/research/store'

export const maxDuration = 60

const Body = z.union([
  z.object({ reviewed: z.boolean() }),
  z.object({ choose: z.number().int().min(0).max(5).nullable() }),
  z.object({ custom_url: z.string().url().max(2000) }),
])

/**
 * The company's researched hook (owner, 2026-11-23):
 * - reviewed: tick / untick "I've read this" (unlocks approve and export).
 * - choose: pick one of the candidates (null = no hook); messages are rewritten, the tick resets.
 * - custom_url: "use this link": read the owner's link (about $0.04), make it the hook.
 * Nothing is sent.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const key = decodeURIComponent((await params).key)
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'reviewed, choose or custom_url required' }, { status: 400 })
  const db = createServiceClient()
  const b = parsed.data
  try {
    if ('reviewed' in b) {
      const now = new Date().toISOString()
      const { data, error } = await db
        .from('company_research')
        .update({ hook_reviewed_at: b.reviewed ? now : null, updated_at: now })
        .eq('company_key', key)
        .select('company_key')
      if (error) throw new Error(error.message)
      if (!data?.length) return NextResponse.json({ error: 'no research for this company' }, { status: 404 })
      return NextResponse.json({ ok: true })
    }
    if ('choose' in b) {
      const r = await chooseCandidate(db, key, b.choose)
      return NextResponse.json({ ok: true, rewritten: r.changes.length })
    }
    const r = await applyOwnLink(db, new Anthropic(), key, b.custom_url)
    if (!r.ok) return NextResponse.json({ error: `No usable idea on that page: ${r.problems.join(' ')}`.slice(0, 600), cost: r.cost }, { status: 422 })
    return NextResponse.json({ ok: true, candidate: r.candidate, cost: r.cost })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 })
  }
}
