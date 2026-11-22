import 'server-only'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ACCESS_COOKIE, accessKeyMatches } from '@/lib/auth/accessKey'
import { verifiedSessionUser } from '@/lib/auth/session'
import { isOwner } from '@/lib/auth/isOwner'

/** Defence in depth for route handlers: the middleware already gates, this re-checks. */
export async function requireOwner(): Promise<boolean> {
  if (accessKeyMatches((await cookies()).get(ACCESS_COOKIE)?.value)) return true
  const supabase = await createClient()
  const user = await verifiedSessionUser(supabase.auth)
  return isOwner(user?.email, process.env.ALLOWED_EMAIL)
}
