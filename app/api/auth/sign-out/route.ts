import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requestOrigin } from '@/lib/http/origin'

export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: 'local' })
  return NextResponse.redirect(`${requestOrigin(request)}/login`, { status: 303 })
}
