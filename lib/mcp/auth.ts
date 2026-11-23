import { timingSafeEqual } from 'node:crypto'

/** Shortest token we accept as configured: a short or empty env var fails closed. */
export const MIN_TOKEN_LENGTH = 32

/** Constant-time compare of two strings (length difference included, no early exit). */
export function secretMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  const same = a.length === b.length
  return timingSafeEqual(same ? a : b, b) && same
}

/**
 * Same auth as Lume's MCP (phase 1): one static bearer token, JOBHUNT_MCP_TOKEN,
 * compared in constant time before the MCP handler sees the request. Returns a
 * 401 Response to send, or null when the caller is allowed through.
 */
export function checkMcpAuth(req: Request, expected = process.env.JOBHUNT_MCP_TOKEN): Response | null {
  const header = req.headers.get('authorization') ?? ''
  const match = /^Bearer[ ]+(\S+)$/i.exec(header.trim())
  const presented = match?.[1]
  const configured = typeof expected === 'string' && expected.length >= MIN_TOKEN_LENGTH
  if (configured && secretMatches(presented, expected)) return null
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="job-hunt"' },
  })
}
