/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'
import { makeWriteTools, type WriteDeps } from '@/lib/mcp/tools/write'
import { runTool, type ToolDeps } from '@/lib/mcp/tool'
import type { IdemRow } from '@/lib/mcp/idempotency'
import { ACTION_KINDS, createPendingAction, TRANSITIONS } from '@/lib/actions/pending'

/** A tiny in-memory stand-in for the Supabase query builder: select / update / eq / maybeSingle / single. */
function fakeDb(tables: Record<string, any[]>) {
  const writes: { table: string; patch: any }[] = []
  return {
    writes,
    from(table: string) {
      const filters: [string, unknown][] = []
      let patch: any = null
      const run = (one: boolean) => {
        const rows = (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v))
        if (patch) {
          for (const r of rows) Object.assign(r, patch)
          writes.push({ table, patch })
        }
        return { data: one ? (rows[0] ?? null) : rows, error: null }
      }
      const q: any = {
        select: () => q,
        update: (p: any) => ((patch = p), q),
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        maybeSingle: async () => run(true),
        single: async () => run(true),
        then: (res: any, rej: any) => Promise.resolve(run(false)).then(res, rej),
      }
      return q
    },
  }
}

function setup(people: any[], problems: string[] = []) {
  const db = fakeDb({ people, jobs: [{ id: 7, company_key: 'acme', title: 'GTM Engineer', status: 'new', notes: null }] })
  const check = vi.fn(async () => problems)
  const refreshFollowups = vi.fn(async () => ({ total: 1, changes: [{ problems: [] }], skipped: {} })) as any
  const deps: WriteDeps = { db: () => db as any, check: check as any, refreshFollowups }
  const tools = Object.fromEntries(makeWriteTools(deps).map((t) => [t.name, t]))
  const store = new Map<string, IdemRow>()
  const toolDeps: ToolDeps = {
    audit: async () => {},
    count: async () => 0,
    now: () => new Date('2026-11-23T10:00:00Z'),
    idem: { get: async (k) => store.get(k) ?? null, put: async (r) => (store.has(r.key) ? false : (store.set(r.key, r), true)) },
  }
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await runTool(tools[name] as any, args as any, toolDeps)
    return { error: !!r.isError, text: (r.content[0] as { text: string }).text }
  }
  return { db, check, refreshFollowups, call }
}

const p = (o: Record<string, unknown> = {}) => ({ id: 1, company_key: 'acme', company: 'Acme', full_name: 'Ann Lee', outreach_status: 'drafted', draft: 'Hi Ann', ...o })

describe('edit_note runs the page checks', () => {
  it('rejects an edit that fails a check, and writes nothing', async () => {
    const s = setup([p()], ['It is 260 characters; the limit is 250.'])
    const r = await s.call('jobhunt_edit_note', { person_id: 1, note: 'x'.repeat(260) })
    expect(r.error).toBe(true)
    expect(r.text).toMatch(/fails the checks: It is 260 characters/)
    expect(s.db.writes).toHaveLength(0)
  })
  it('saves a passing edit; an edited Approved note goes back to Drafted', async () => {
    const s = setup([p({ outreach_status: 'approved' })])
    const r = await s.call('jobhunt_edit_note', { person_id: 1, note: '  Hi Ann, new text  ' })
    expect(r.error).toBe(false)
    expect(s.check).toHaveBeenCalledWith(expect.anything(), 1, 'Hi Ann, new text')
    expect(s.db.writes[0].patch).toEqual({ draft: 'Hi Ann, new text', outreach_status: 'drafted' })
  })
  it('a note between 230 and 250 characters is saved with a warning, not blocked', async () => {
    const s = setup([p()])
    const r = await s.call('jobhunt_edit_note', { person_id: 1, note: 'x'.repeat(240) })
    expect(r.error).toBe(false)
    expect(JSON.parse(r.text).warnings[0]).toMatch(/240 characters; aim for 230 or fewer/)
  })
  it('refuses once the note is in a sender file', async () => {
    for (const status of ['exported', 'sent', 'replied']) {
      const s = setup([p({ outreach_status: status })])
      const r = await s.call('jobhunt_edit_note', { person_id: 1, note: 'Hi' })
      expect(r.text).toMatch(/can't be edited/)
      expect(s.db.writes).toHaveLength(0)
    }
  })
})

describe('approve_note runs the page checks', () => {
  it('refuses a failing note; it stays Drafted', async () => {
    const s = setup([p()], ['It states or implies a number'])
    const r = await s.call('jobhunt_approve_note', { person_id: 1 })
    expect(r.error).toBe(true)
    expect(r.text).toMatch(/Not approved/)
    expect(s.db.writes).toHaveLength(0)
  })
  it('approves a passing Drafted note', async () => {
    const s = setup([p()])
    expect((await s.call('jobhunt_approve_note', { person_id: 1 })).error).toBe(false)
    expect(s.db.writes[0].patch).toEqual({ outreach_status: 'approved' })
  })
  it('only Drafted notes', async () => {
    const s = setup([p({ outreach_status: 'none', draft: null })])
    expect((await s.call('jobhunt_approve_note', { person_id: 1 })).text).toMatch(/Only Drafted notes/)
  })
})

describe('set_person_status', () => {
  it('records sent / replied / no reply from the allowed states only', async () => {
    const ok = setup([p({ outreach_status: 'exported' })])
    expect((await ok.call('jobhunt_set_person_status', { person_id: 1, status: 'sent' })).error).toBe(false)
    const early = setup([p({ outreach_status: 'drafted' })])
    expect((await early.call('jobhunt_set_person_status', { person_id: 1, status: 'sent' })).text).toMatch(/Can't mark sent from drafted/)
    const replied = setup([p({ outreach_status: 'replied' })])
    expect((await replied.call('jobhunt_set_person_status', { person_id: 1, status: 'no_reply' })).text).toMatch(/Can't mark/)
  })
  it('rejects statuses outside sent / replied / no_reply', async () => {
    const s = setup([p({ outreach_status: 'exported' })])
    expect((await s.call('jobhunt_set_person_status', { person_id: 1, status: 'approved' })).error).toBe(true)
    expect(s.db.writes).toHaveLength(0)
  })
})

describe('set_role_status', () => {
  it('updates the role and rewrites recruiter after-accept messages, like the page', async () => {
    const s = setup([])
    const r = await s.call('jobhunt_set_role_status', { role_id: 7, status: 'applied' })
    expect(r.error).toBe(false)
    expect(JSON.parse(r.text)).toMatchObject({ role_id: 7, status: 'applied', recruiter_messages_rewritten: 1 })
    expect(s.refreshFollowups).toHaveBeenCalledWith(expect.anything(), { companyKey: 'acme', write: true })
  })
  it('only the five tracker statuses', async () => {
    const s = setup([])
    expect((await s.call('jobhunt_set_role_status', { role_id: 7, status: 'offer' })).error).toBe(true)
  })
})

describe('idempotency on writes', () => {
  it('a repeated key returns the first result and writes once', async () => {
    const s = setup([p()])
    const a = await s.call('jobhunt_approve_note', { person_id: 1, idempotency_key: 'approve-1-abc' })
    s.db.writes.length = 0
    const b = await s.call('jobhunt_approve_note', { person_id: 1, idempotency_key: 'approve-1-abc' })
    expect(JSON.parse(b.text)).toMatchObject({ ...JSON.parse(a.text), replayed: true })
    expect(s.db.writes).toHaveLength(0)
  })
})

describe('request tools only file pending actions', () => {
  it('only the three allowed kinds can be filed', async () => {
    expect(ACTION_KINDS).toEqual(['find_people', 'draft_notes', 'export_csv'])
    await expect(createPendingAction({} as any, { kind: 'send_messages' as any, params: {}, preview: {}, summary: '', est_cost_usd: 0 })).rejects.toThrow(/unknown action kind/)
  })
  it('a request runs once: awaiting → running → done, never back', () => {
    expect(TRANSITIONS.awaiting).toEqual(['running', 'rejected', 'expired'])
    expect(TRANSITIONS.running).toEqual(['done', 'failed'])
    expect(TRANSITIONS.done).toEqual([])
  })
})
