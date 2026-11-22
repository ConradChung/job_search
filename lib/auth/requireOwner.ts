import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { verifiedSessionUser } from '@/lib/auth/session'
import { isOwner } from '@/lib/auth/isOwner'

/** Defence in depth for route handlers: the middleware already gates, this re-checks. */
export async function requireOwner(): Promise<boolean> {
  const supabase = await createClient()
  const user = await verifiedSessionUser(supabase.auth)
  return isOwner(user?.email, process.env.ALLOWED_EMAIL)
}
