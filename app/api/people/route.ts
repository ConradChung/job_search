import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/auth/requireOwner'
import { createServiceClient } from '@/lib/supabase/service'
import { canonicalLinkedin, linkedinKey } from '@/lib/people/parse'
import { PERSON_COLUMNS } from '@/lib/people/types'

const Body = z.object({
  company_key: z.string().min(1).max(200),
  linkedin_url: z.string().url().max(500),
  full_name: z.string().trim().min(1).max(200),
  title: z.string().trim().max(300).optional(),
  branch: z.enum(['alumni', 'recruiting', 'gtm_leadership', 'executive', 'other']),
})

/** Add a person by hand (pasted LinkedIn profile). */
export async function POST(request: Request) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'bad body' }, { status: 400 })
  const key = linkedinKey(parsed.data.linkedin_url)
  if (!key) return NextResponse.json({ error: 'Paste a LinkedIn profile URL (linkedin.com/in/...)' }, { status: 400 })

  const db = createServiceClient()
  const { data: job } = await db.from('jobs').select('company').eq('company_key', parsed.data.company_key).limit(1).maybeSingle()
  if (!job) return NextResponse.json({ error: 'unknown company' }, { status: 404 })

  const { data, error } = await db
    .from('people')
    .insert({
      company_key: parsed.data.company_key,
      company: job.company,
      full_name: parsed.data.full_name,
      title: parsed.data.title || null,
      linkedin_url: canonicalLinkedin(key),
      linkedin_key: key,
      branch: parsed.data.branch,
      is_ucla: parsed.data.branch === 'alumni',
      source: 'manual',
      confidence: 'high',
    })
    .select(PERSON_COLUMNS)
    .single()
  if (error) {
    const dup = error.code === '23505'
    return NextResponse.json({ error: dup ? 'That person is already on this company' : error.message }, { status: dup ? 409 : 500 })
  }
  return NextResponse.json(data)
}
