import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isOwner } from '@/lib/auth/isOwner'
import { requestOrigin } from '@/lib/http/origin'

const Body = z.object({ email: z.string().trim().max(254) })

/** Owner-only magic link. Anyone else gets the same { ok: true }, so it is not an oracle. */
export async function POST(request: Request) {
  let email: string | undefined
  try {
    email = Body.parse(await request.json()).email
  } catch {
    // same response either way
  }
  if (!isOwner(email, process.env.ALLOWED_EMAIL)) return NextResponse.json({ ok: true })

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email: email!,
    // First sign-in creates the owner's auth user; only the owner email gets here.
    options: { shouldCreateUser: true, emailRedirectTo: `${requestOrigin(request)}/auth/callback` },
  })
  if (error) console.error('[magic-link] supabase error:', error.message)
  return NextResponse.json({ ok: true })
}
