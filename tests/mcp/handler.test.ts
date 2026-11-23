/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'

// No DB in this test: auth + tool list only. Tool bodies are covered in write.test.ts.
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('no db in tests')
  },
}))

import { buildMcpHandler, allTools, SERVER_INSTRUCTIONS } from '@/lib/mcp/server'
import { checkMcpAuth } from '@/lib/mcp/auth'

const TOKEN = 't'.repeat(40)

async function rpc(body: unknown, auth = `Bearer ${TOKEN}`) {
  const handler = buildMcpHandler()
  const req = new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify(body),
  })
  const denied = checkMcpAuth(req, TOKEN)
  if (denied) return denied
  return handler(req)
}

async function json(res: Response): Promise<Record<string, any>> {
  const text = await res.text()
  const data = text.includes('data:') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop()! : text
  return JSON.parse(data)
}

const READS = ['jobhunt_get_overview', 'jobhunt_list_companies', 'jobhunt_get_company', 'jobhunt_list_people', 'jobhunt_export_preview']
const WRITES = ['jobhunt_set_role_status', 'jobhunt_set_person_status', 'jobhunt_approve_note', 'jobhunt_edit_note', 'jobhunt_add_company_note']
const REQUESTS = ['jobhunt_request_find_people', 'jobhunt_request_draft_notes', 'jobhunt_request_export_csv']

describe('MCP handler', () => {
  it('401s without the token, and with a wrong one', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, '')).status).toBe(401)
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, `Bearer ${TOKEN}x`)).status).toBe(401)
  })

  it('lists exactly the 13 tools, jobhunt_ prefixed, with the right annotations', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    expect(res.status).toBe(200)
    const tools = (await json(res)).result.tools as { name: string; annotations: Record<string, boolean> }[]
    expect(tools.map((t) => t.name).sort()).toEqual([...READS, ...WRITES, ...REQUESTS].sort())
    expect(allTools()).toHaveLength(13)
    for (const t of tools) {
      expect(t.name).toMatch(/^jobhunt_[a-z_]+$/)
      expect(t.annotations.destructiveHint).toBe(false)
      expect(t.annotations.openWorldHint).toBe(false)
      expect(t.annotations.readOnlyHint).toBe(READS.includes(t.name))
    }
  })

  it('no tool sends, touches LinkedIn or calls the sender', () => {
    for (const t of allTools()) {
      expect(t.name).not.toMatch(/send|linkedin|connect|message|sender/)
    }
    expect(SERVER_INSTRUCTIONS).toMatch(/Start with jobhunt_get_overview/)
    expect(SERVER_INSTRUCTIONS).toMatch(/untrusted/)
    expect(SERVER_INSTRUCTIONS).toMatch(/next_cursor/)
    expect(SERVER_INSTRUCTIONS).toMatch(/idempotency_key/)
    expect(SERVER_INSTRUCTIONS).toMatch(/No tool sends a message, touches LinkedIn or calls the sender/)
  })

  it('a failing tool returns a short error, not internals', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'jobhunt_get_overview', arguments: {} } })
    const body = await json(res)
    const text = JSON.stringify(body)
    expect(text).not.toMatch(/no db in tests/)
    spy.mockRestore()
  })
})
