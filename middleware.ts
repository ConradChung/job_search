import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { isOwner } from '@/lib/auth/isOwner'
import { ACCESS_COOKIE, accessKeyMatches } from '@/lib/auth/accessKey'

/**
 * Single-owner gate (same model as Lume). Public: /login, /auth/*, the
 * magic-link endpoint. APIs get 401/403 JSON; pages redirect to /login.
 */
const PUBLIC = ['/login', '/api/auth/magic-link']

/** The private link route sets its own cookie; it checks the key itself. */
const isPrivateLink = (p: string) => p.startsWith('/k/')

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isAuthPage = PUBLIC.includes(pathname) || pathname.startsWith('/auth/')
  const isApi = pathname.startsWith('/api/')

  if (isPrivateLink(pathname)) return NextResponse.next({ request })
  // MCP server: its own bearer-token check runs in the route (lib/mcp/auth.ts), before anything else.
  if (pathname === '/api/mcp') return NextResponse.next({ request })
  // Weekly cron: checks CRON_SECRET itself (app/api/cron/weekly/route.ts).
  if (pathname.startsWith('/api/cron/')) return NextResponse.next({ request })
  // Private-link cookie: let the browser in without a Supabase session.
  if (!isAuthPage && accessKeyMatches(request.cookies.get(ACCESS_COOKIE)?.value)) {
    return NextResponse.next({ request })
  }

  const { response, user } = await updateSession(request)
  const owner = isOwner(user?.email, process.env.ALLOWED_EMAIL)

  if (isAuthPage) {
    if (pathname === '/login' && owner) return redirectTo('/', request, response)
    return response
  }
  if (!user || !owner) {
    if (isApi) return jsonError(user ? 'forbidden' : 'unauthenticated', user ? 403 : 401, response)
    return redirectTo('/login', request, response)
  }
  return response
}

function redirectTo(pathname: string, request: NextRequest, from: NextResponse) {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  url.search = ''
  const to = NextResponse.redirect(url)
  for (const c of from.cookies.getAll()) to.cookies.set(c)
  return to
}

function jsonError(error: string, status: 401 | 403, from: NextResponse) {
  const to = NextResponse.json({ error }, { status })
  for (const c of from.cookies.getAll()) to.cookies.set(c)
  return to
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
