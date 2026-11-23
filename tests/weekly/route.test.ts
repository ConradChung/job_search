import { afterEach, describe, expect, it, vi } from 'vitest'

// No DB, no network: only the auth gate is under test.
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('no db in tests')
  },
}))

import { GET } from '@/app/api/cron/weekly/route'

const SECRET = 's'.repeat(64)
const call = (auth?: string) => GET(new Request('http://localhost/api/cron/weekly', { headers: auth ? { authorization: auth } : {} }))

describe('cron route auth', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('401s without the cron secret, with a wrong one, and when unset or short', async () => {
    vi.stubEnv('CRON_SECRET', SECRET)
    expect((await call()).status).toBe(401)
    expect((await call(`Bearer ${SECRET}x`)).status).toBe(401)
    expect((await call(SECRET)).status).toBe(401)
    vi.stubEnv('CRON_SECRET', 'short')
    expect((await call('Bearer short')).status).toBe(401)
    vi.stubEnv('CRON_SECRET', '')
    expect((await call('Bearer ')).status).toBe(401)
  })

  it('lets the right secret through to the run (which then needs the DB)', async () => {
    vi.stubEnv('CRON_SECRET', SECRET)
    await expect(call(`Bearer ${SECRET}`)).rejects.toThrow(/no db in tests/)
  })
})
