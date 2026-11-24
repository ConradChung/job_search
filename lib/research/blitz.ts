/**
 * Work email from a LinkedIn profile URL (Blitz API, POST /v2/enrichment/email).
 * One record per email found; a miss costs nothing. Rate limit 5/s on this key.
 * Read-only lookup: nothing is sent to anyone.
 */
const BASE = 'https://api.blitz-api.ai'

export interface EmailLookup {
  status: 'found' | 'not_found' | 'error'
  email: string | null
  error?: string
}

export async function findWorkEmail(linkedinUrl: string, apiKey = process.env.BLITZ_API_KEY): Promise<EmailLookup> {
  if (!apiKey) throw new Error('BLITZ_API_KEY is not set')
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}/v2/enrichment/email`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ person_linkedin_url: linkedinUrl }),
      cache: 'no-store',
    })
    if (res.status === 429 || res.status === 503) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
      continue
    }
    if (!res.ok) return { status: 'error', email: null, error: `Blitz ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}` }
    const data = (await res.json()) as { found?: boolean; email?: string | null }
    const email = data.found && data.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email) ? data.email.trim().toLowerCase() : null
    return email ? { status: 'found', email } : { status: 'not_found', email: null }
  }
  return { status: 'error', email: null, error: 'Blitz rate limited' }
}

export async function blitzRecordsRemaining(apiKey = process.env.BLITZ_API_KEY): Promise<number | null> {
  if (!apiKey) return null
  const res = await fetch(`${BASE}/v2/account/key-info`, { headers: { 'x-api-key': apiKey }, cache: 'no-store' })
  if (!res.ok) return null
  const d = (await res.json()) as { records_remaining?: number }
  return d.records_remaining ?? null
}
