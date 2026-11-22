import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requestOrigin } from '@/lib/http/origin'

/** Magic-link landing: PKCE `code` or `token_hash` + `type` → cookie session → /jobs. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const origin = requestOrigin(request)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const fail = (reason: string) => NextResponse.redirect(`${origin}/login?error=${reason}`)

  if (!code && !(tokenHash && type)) return fail('missing_code')
  const supabase = await createClient()
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type! })
  if (!error) return NextResponse.redirect(`${origin}/jobs`)

  console.warn('[auth/callback] failed:', error.code ?? error.status, error.message)
  return fail(error.code === 'otp_expired' || /expired|invalid/i.test(error.message) ? 'expired' : 'exchange_failed')
}
