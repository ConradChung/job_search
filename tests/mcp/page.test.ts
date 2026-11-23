import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor, pageOf, queryKey, DEFAULT_LIMIT } from '@/lib/mcp/page'

const all = Array.from({ length: 120 }, (_, i) => i + 1)
const q = queryKey('jobhunt_list_people', { status: 'approved', tier: '1', limit: 50 })

describe('paging (next_cursor)', () => {
  it('walks every row exactly once and ends with next_cursor null', () => {
    const seen: number[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const p = pageOf(all, { limit: 50, cursor }, q)
      seen.push(...p.rows)
      expect(p.total).toBe(120)
      cursor = p.next_cursor ?? undefined
      pages++
    } while (cursor)
    expect(pages).toBe(3)
    expect(seen).toEqual(all)
  })

  it('defaults to 50 rows', () => {
    expect(pageOf(all, {}, q).rows).toHaveLength(DEFAULT_LIMIT)
    expect(pageOf([1, 2], {}, q).next_cursor).toBeNull()
  })

  it('a cursor only works for the query it came from', () => {
    const next = pageOf(all, { limit: 10 }, q).next_cursor!
    expect(decodeCursor(next, q)).toBe(10)
    const other = queryKey('jobhunt_list_people', { status: 'drafted', tier: '1' })
    expect(() => decodeCursor(next, other)).toThrow(/Invalid cursor/)
  })

  it('limit and cursor are not part of the query key', () => {
    expect(queryKey('t', { a: 1, limit: 5, cursor: 'x' })).toBe(queryKey('t', { a: 1 }))
  })

  it('rejects tampered cursors', () => {
    expect(() => decodeCursor('not base64 json', q)).toThrow(/Invalid cursor/)
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ o: -5, q })).toString('base64url'), q)).toThrow(/Invalid cursor/)
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ o: 1.5, q })).toString('base64url'), q)).toThrow(/Invalid cursor/)
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ o: '10', q })).toString('base64url'), q)).toThrow(/Invalid cursor/)
    expect(decodeCursor(encodeCursor(0, q), q)).toBe(0)
  })
})
