import { z } from 'zod'
import { McpUserError } from './sanitize'

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

/** Shared pagination inputs (same names as Lume's): pass next_cursor back as cursor. */
export const pageInput = {
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Rows to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`),
  cursor: z.string().max(200).optional().describe('Pass next_cursor from the previous page.'),
}

/**
 * Lists here are built in memory in the page's own order (a few hundred
 * companies), so the cursor is an offset plus a fingerprint of the query it
 * belongs to. Both are validated; a cursor from another query is refused.
 */
export function encodeCursor(offset: number, query: string): string {
  return Buffer.from(JSON.stringify({ o: offset, q: query })).toString('base64url')
}

export function decodeCursor(raw: string | undefined, query: string): number {
  if (!raw) return 0
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { o: unknown; q: unknown }
    if (typeof c.o === 'number' && Number.isInteger(c.o) && c.o >= 0 && c.o <= 100_000 && c.q === query) return c.o
  } catch {
    /* fall through */
  }
  throw new McpUserError('Invalid cursor. Start again without one.')
}

/** One page of an ordered list, with next_cursor (null on the last page) and the total. */
export function pageOf<T>(all: T[], page: { limit?: number; cursor?: string }, query: string): { rows: T[]; next_cursor: string | null; total: number } {
  const limit = page.limit ?? DEFAULT_LIMIT
  const start = decodeCursor(page.cursor, query)
  const rows = all.slice(start, start + limit)
  const next = start + limit < all.length ? encodeCursor(start + limit, query) : null
  return { rows, next_cursor: next, total: all.length }
}

/** Stable fingerprint of a tool's filters, so a cursor only works for the query it came from. */
export function queryKey(tool: string, filters: Record<string, unknown>): string {
  const keys = Object.keys(filters).filter((k) => k !== 'cursor' && k !== 'limit' && filters[k] !== undefined).sort()
  return `${tool}:${keys.map((k) => `${k}=${JSON.stringify(filters[k])}`).join('&')}`.slice(0, 120)
}
