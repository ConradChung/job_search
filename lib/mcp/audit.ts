import { createServiceClient } from '@/lib/supabase/service'
import type { CallClass } from './limits'
import { sanitizeArgs } from './sanitize'

export type AuditOutcome = 'ok' | 'error' | 'rate_limited'

export type AuditEntry = {
  tool: string
  cls: CallClass
  args: unknown
  outcome: AuditOutcome
  ms: number
  error?: string
  /** Ids worth finding later (person, role, action). */
  refs?: Record<string, string>
}

export type AuditSink = (entry: AuditEntry) => Promise<void>

/** One mcp_audit row per tool call, with sanitised args. Also what the rate limits count. */
export const auditToTable: AuditSink = async (e) => {
  const { error } = await createServiceClient()
    .from('mcp_audit')
    .insert({ tool: e.tool, class: e.cls, outcome: e.outcome, ms: e.ms, args: sanitizeArgs(e.args) ?? {}, error: e.error ?? null, refs: e.refs ?? null })
  if (error) throw new Error(error.message)
}
