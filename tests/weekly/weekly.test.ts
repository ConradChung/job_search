import { describe, expect, it, vi } from 'vitest'
import { fits, isEightAmPacific, telegramSender, WEEKLY } from '@/lib/weekly/run'

describe('schedule: 8am Pacific every Tuesday, through daylight saving', () => {
  it('16:00 UTC is 8am in winter (PST); 15:00 UTC is 7am', () => {
    expect(isEightAmPacific(Date.parse('2026-11-24T16:00:00Z'))).toBe(true)
    expect(isEightAmPacific(Date.parse('2026-11-24T15:00:00Z'))).toBe(false)
  })
  it('15:00 UTC is 8am in summer (PDT); 16:00 UTC is 9am', () => {
    expect(isEightAmPacific(Date.parse('2027-06-01T15:00:00Z'))).toBe(true)
    expect(isEightAmPacific(Date.parse('2027-06-01T16:00:00Z'))).toBe(false)
  })
  it('vercel.json fires both hours on Tuesdays', async () => {
    const { default: cfg } = await import('../../vercel.json', { with: { type: 'json' } })
    expect(cfg.crons.map((c: { schedule: string }) => c.schedule).sort()).toEqual(['0 15 * * 2', '0 16 * * 2'])
    expect(cfg.crons.every((c: { path: string }) => c.path === '/api/cron/weekly')).toBe(true)
  })
})

describe('weekly spending cap', () => {
  it('defaults to $5, searches and drafts tiers 1-2 only (RevOps stays manual)', () => {
    expect(WEEKLY.capUsd).toBe(5)
    expect(WEEKLY.autoTracks).toEqual(['gtm_eng', 'sdr'])
  })
  it('a unit runs only if it fits under the cap', () => {
    expect(fits({ spent_usd: 4.98, cap_usd: 5 }, 0.02)).toBe(true)
    expect(fits({ spent_usd: 4.99, cap_usd: 5 }, 0.02)).toBe(false)
    expect(fits({ spent_usd: 0, cap_usd: 0 }, 0.006)).toBe(false)
    expect(fits({ spent_usd: 0, cap_usd: 0 }, 0)).toBe(true) // free title guesses still run
  })
})

describe('Telegram summary', () => {
  it('refuses to send when not configured', async () => {
    await expect(telegramSender(undefined, '123')('hi')).rejects.toThrow(/not configured/)
    await expect(telegramSender('t', undefined)('hi')).rejects.toThrow(/not configured/)
  })
  it('posts to the bot API with the chat id', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await telegramSender('BOT', '42')('hello')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.telegram.org/botBOT/sendMessage')
    expect(JSON.parse(init.body as string)).toMatchObject({ chat_id: '42', text: 'hello' })
    vi.unstubAllGlobals()
  })
})
