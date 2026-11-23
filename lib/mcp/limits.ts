import { createServiceClient } from '@/lib/supabase/service'

export type CallClass = 'read' | 'write' | 'request'

/** Per-class budget: `max` calls per `windowMs`, counted across all instances. */
export const LIMITS: Record<CallClass, { max: number; windowMs: number; label: string }> = {
  read: { max: 60, windowMs: 60_000, label: '60 reads per minute' },
  write: { max: 20, windowMs: 60_000, label: '20 writes per minute' },
  request: { max: 10, windowMs: 3_600_000, label: '10 requests per hour' },
}

/** Counts this class's recent audit rows. Injected in tests. */
export type CallCounter = (cls: CallClass, sinceIso: string) => Promise<number>

/** Serverless instances share no memory, so the count comes from mcp_audit. Rate-limited calls don't count. */
export const countFromAudit: CallCounter = async (cls, sinceIso) => {
  const { count, error } = await createServiceClient()
    .from('mcp_audit')
    .select('id', { count: 'exact', head: true })
    .eq('class', cls)
    .neq('outcome', 'rate_limited')
    .gte('created_at', sinceIso)
  if (error) throw new Error('rate limit count failed')
  return count ?? 0
}

export type LimitResult = { ok: true } | { ok: false; message: string }

/** Fails closed: if the count can't be read, the call is refused. */
export async function checkLimit(cls: CallClass, count: CallCounter = countFromAudit, now: Date = new Date()): Promise<LimitResult> {
  const { max, windowMs, label } = LIMITS[cls]
  let used: number
  try {
    used = await count(cls, new Date(now.getTime() - windowMs).toISOString())
  } catch {
    return { ok: false, message: 'Rate limit check is unavailable right now. Try again in a minute.' }
  }
  if (used >= max) return { ok: false, message: `Rate limit reached (${label}). Wait and retry.` }
  return { ok: true }
}
