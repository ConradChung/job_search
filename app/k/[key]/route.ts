import { NextResponse } from 'next/server'
import { ACCESS_COOKIE, accessKeyMatches } from '@/lib/auth/accessKey'
import { requestOrigin } from '@/lib/http/origin'

/** Private link: /k/<ACCESS_KEY> → access cookie (1 year) → /jobs. Wrong key → /login. */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const origin = requestOrigin(request)
  if (!accessKeyMatches(key)) return NextResponse.redirect(`${origin}/login`)
  const res = NextResponse.redirect(`${origin}/jobs`)
  res.cookies.set(ACCESS_COOKIE, key, {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https://'),
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return res
}
