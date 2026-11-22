/** Public origin of this request: APP_URL if set, else proxy headers, else the request URL. */
export function requestOrigin(request: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, '')
  if (configured) return configured
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (host) {
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'
    return `${proto}://${host}`
  }
  return new URL(request.url).origin
}
