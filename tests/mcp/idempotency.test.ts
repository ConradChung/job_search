import { describe, expect, it, vi } from 'vitest'
import { argsHash, withIdempotency, type IdemRow, type IdemStore } from '@/lib/mcp/idempotency'

function memStore(): IdemStore & { rows: Map<string, IdemRow> } {
  const rows = new Map<string, IdemRow>()
  return { rows, get: async (k) => rows.get(k) ?? null, put: async (r) => (rows.has(r.key) ? false : (rows.set(r.key, r), true)) }
}

describe('withIdempotency', () => {
  it('without a key it always runs', async () => {
    const run = vi.fn(async () => ({ data: { n: 1 } }))
    await withIdempotency('jobhunt_x', { a: 1 }, run, memStore())
    await withIdempotency('jobhunt_x', { a: 1 }, run, memStore())
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('a repeat with the same key and args replays the first result and does not write again', async () => {
    const s = memStore()
    const run = vi.fn(async () => ({ data: { id: 'first' }, refs: { id: 'first' } }))
    const a = await withIdempotency('jobhunt_x', { idempotency_key: 'k-12345678', b: 2, a: 1 }, run, s)
    const b = await withIdempotency('jobhunt_x', { a: 1, b: 2, idempotency_key: 'k-12345678' }, run, s)
    expect(run).toHaveBeenCalledTimes(1)
    expect(a.data).toEqual({ id: 'first' })
    expect(b).toEqual({ data: { id: 'first', replayed: true }, refs: { id: 'first' } })
  })

  it('the same key with different args or another tool is refused, nothing runs', async () => {
    const s = memStore()
    await withIdempotency('jobhunt_x', { idempotency_key: 'k-12345678', a: 1 }, async () => ({ data: {} }), s)
    const run = vi.fn(async () => ({ data: {} }))
    await expect(withIdempotency('jobhunt_x', { idempotency_key: 'k-12345678', a: 2 }, run, s)).rejects.toThrow(/different call/)
    await expect(withIdempotency('jobhunt_y', { idempotency_key: 'k-12345678', a: 1 }, run, s)).rejects.toThrow(/different call/)
    expect(run).not.toHaveBeenCalled()
  })

  it('a concurrent winner is returned when the put loses the race', async () => {
    const s = memStore()
    const out = await withIdempotency('jobhunt_x', { idempotency_key: 'k-12345678' }, async () => {
      s.rows.set('k-12345678', { key: 'k-12345678', tool: 'jobhunt_x', args_hash: argsHash({}), result: { data: { id: 'winner' } } })
      return { data: { id: 'loser' } }
    }, s)
    expect(out.data).toEqual({ id: 'winner', replayed: true })
  })

  it('a failed run stores nothing, so a retry runs again', async () => {
    const s = memStore()
    await expect(withIdempotency('jobhunt_x', { idempotency_key: 'k-12345678' }, async () => { throw new Error('boom') }, s)).rejects.toThrow('boom')
    expect(s.rows.size).toBe(0)
  })
})
