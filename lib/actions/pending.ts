import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Pending actions: what the MCP request tools file instead of acting. Anything
 * that spends money (people search, drafting) or marks people Exported waits
 * here until the owner confirms it on the Pipeline page, which then runs the
 * page's own flow. Nothing here sends anything.
 */
export const ACTION_KINDS = ['find_people', 'draft_notes', 'export_csv'] as const
export type ActionKind = (typeof ACTION_KINDS)[number]
export type ActionStatus = 'awaiting' | 'running' | 'done' | 'rejected' | 'failed' | 'expired'

export interface PendingAction {
  id: string
  kind: ActionKind
  params: Record<string, unknown>
  preview: Record<string, unknown>
  summary: string
  est_cost_usd: number
  status: ActionStatus
  requested_by: string
  result: Record<string, unknown> | null
  created_at: string
  decided_at: string | null
}

/** Unconfirmed requests expire after a day, so a stale preview is never run. */
export const ACTION_TTL_MS = 24 * 60 * 60 * 1000
const COLS = 'id, kind, params, preview, summary, est_cost_usd, status, requested_by, result, created_at, decided_at'

/** Allowed moves; every update is conditional on the current status, so two tabs can't both run one. */
export const TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  awaiting: ['running', 'rejected', 'expired'],
  running: ['done', 'failed'],
  done: [],
  rejected: [],
  failed: [],
  expired: [],
}

export async function createPendingAction(
  db: SupabaseClient,
  a: { kind: ActionKind; params: Record<string, unknown>; preview: Record<string, unknown>; summary: string; est_cost_usd: number }
): Promise<PendingAction> {
  if (!ACTION_KINDS.includes(a.kind)) throw new Error(`unknown action kind ${a.kind}`)
  const { data, error } = await db
    .from('pending_actions')
    .insert({ ...a, requested_by: 'mcp' })
    .select(COLS)
    .single()
  if (error) throw new Error(`file action: ${error.message}`)
  return data as PendingAction
}

/** Awaiting and running requests, plus the last few decided ones. Expires stale ones first. */
export async function loadPendingActions(db: SupabaseClient): Promise<PendingAction[]> {
  await db
    .from('pending_actions')
    .update({ status: 'expired', decided_at: new Date().toISOString() })
    .eq('status', 'awaiting')
    .lt('created_at', new Date(Date.now() - ACTION_TTL_MS).toISOString())
  const { data, error } = await db.from('pending_actions').select(COLS).order('created_at', { ascending: false }).limit(30)
  if (error) return []
  return (data ?? []) as PendingAction[]
}

export async function moveAction(db: SupabaseClient, id: string, to: ActionStatus, result?: Record<string, unknown>): Promise<PendingAction | null> {
  const from = (Object.keys(TRANSITIONS) as ActionStatus[]).filter((s) => TRANSITIONS[s].includes(to))
  const { data, error } = await db
    .from('pending_actions')
    .update({ status: to, decided_at: new Date().toISOString(), ...(result ? { result } : {}) })
    .eq('id', id)
    .in('status', from)
    .select(COLS)
    .maybeSingle()
  if (error) throw new Error(`update action: ${error.message}`)
  return (data as PendingAction | null) ?? null
}
