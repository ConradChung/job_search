import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/service'
import { loadCompanies } from '@/lib/pipeline/load'
import { createPendingAction } from '@/lib/actions/pending'
import { previewDraftNotes, previewExport, previewFindPeople } from '@/lib/actions/requests'
import { idempotencyKey } from '../idempotency'
import { McpUserError, untrusted } from '../sanitize'
import { defineTool, INTERNAL_APPEND, type ToolDef } from '../tool'

/**
 * Request tools never act. Anything that spends money (people search with Exa,
 * drafting with Claude) or marks people Exported is filed as a pending action
 * with its preview; the owner confirms it on the Pipeline page, which runs the
 * page's own flow. Nothing here sends a message or touches LinkedIn.
 */

const scope = {
  company_keys: z.array(z.string().min(1).max(120)).max(50).optional().describe('Specific companies. Omit to use a tier.'),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe('Passing companies in this tier, page order (when company_keys is omitted).'),
  limit: z.number().int().min(1).max(50).optional().describe('At most this many (default 25).'),
}

const findPeople = defineTool({
  name: 'jobhunt_request_find_people',
  title: 'Request a people search',
  description:
    'Files a request to search people (Exa, costs money) at companies not yet searched. Does not search: the owner confirms it in the app. Returns the preview: companies, searches and worst-case cost.',
  cls: 'request',
  input: z.object({ ...scope, idempotency_key: idempotencyKey }),
  annotations: INTERNAL_APPEND,
  run: async ({ idempotency_key: _k, ...s }) => {
    void _k
    const db = createServiceClient()
    const preview = previewFindPeople(await loadCompanies(db), s)
    if (!preview.company_keys.length) throw new McpUserError('Every company in that scope has already been searched; nothing to request.')
    const action = await createPendingAction(db, {
      kind: 'find_people',
      params: { company_keys: preview.company_keys },
      preview,
      summary: `Find people at ${preview.company_keys.length} compan${preview.company_keys.length === 1 ? 'y' : 'ies'} (at most ${preview.searches} Exa searches)`,
      est_cost_usd: preview.est_cost_usd,
    })
    return { data: { action_id: action.id, status: 'awaiting owner confirmation in the app', ...preview }, refs: { action: action.id } }
  },
})

const draftNotes = defineTool({
  name: 'jobhunt_request_draft_notes',
  title: 'Request note drafting',
  description:
    'Files a request to draft LinkedIn notes (Claude, costs money) for target people who have none yet. Does not draft: the owner confirms it in the app. Returns the preview: people and estimated cost.',
  cls: 'request',
  input: z.object({ ...scope, idempotency_key: idempotencyKey }),
  annotations: INTERNAL_APPEND,
  run: async ({ idempotency_key: _k, ...s }) => {
    void _k
    const db = createServiceClient()
    const preview = previewDraftNotes(await loadCompanies(db), s)
    if (!preview.person_ids.length) throw new McpUserError('No target people without a note in that scope; nothing to request.')
    const action = await createPendingAction(db, {
      kind: 'draft_notes',
      params: { person_ids: preview.person_ids },
      preview,
      summary: `Draft notes for ${preview.person_ids.length} people`,
      est_cost_usd: preview.est_cost_usd,
    })
    return { data: { action_id: action.id, status: 'awaiting owner confirmation in the app', ...preview }, refs: { action: action.id } }
  },
})

const exportCsv = defineTool({
  name: 'jobhunt_request_export_csv',
  title: 'Request a sender CSV export',
  description:
    'Files a request to export the next batch of Approved notes as the sender CSV (which marks those people Exported). Does not export: the owner confirms it in the app, which downloads the file. The batch is fixed now, so what the owner confirms is exactly what goes in the file.',
  cls: 'request',
  input: z.object({
    tiers: z.array(z.number().int().min(1).max(3)).min(1).max(3).optional().describe('Default [1]. Tiers mix only when more than one is given.'),
    limit: z.number().int().min(1).max(200).optional().describe('First N rows (default 15).'),
    include_exported: z.boolean().optional(),
    idempotency_key: idempotencyKey,
  }),
  annotations: INTERNAL_APPEND,
  run: async ({ tiers = [1], limit, include_exported }) => {
    const db = createServiceClient()
    const r = await previewExport(db, await loadCompanies(db), { tiers, limit, include_exported })
    if (r.overLimit.length) throw new McpUserError(`Refused: ${r.overLimit.length} note(s) over the limit or missing. Fix them first.`)
    if (!r.count) throw new McpUserError(`No Approved notes to export in tier ${tiers.join(', ')}.`)
    const preview = {
      count: r.count,
      available: r.available,
      people: r.people.map((p) => ({ id: p.id, company: p.company })),
      no_url: r.noUrl.length,
      apply_first: r.applyFirst.length,
      hook_unread: r.hookUnread.length,
    }
    const action = await createPendingAction(db, {
      kind: 'export_csv',
      params: { person_ids: r.person_ids, tiers, include_exported: !!include_exported },
      preview,
      summary: `Export ${r.count} Approved notes (tier ${tiers.join(' + ')}) to the sender CSV`,
      est_cost_usd: 0,
    })
    return {
      data: {
        action_id: action.id,
        status: 'awaiting owner confirmation in the app',
        ...preview,
        people: r.people.map((p) => ({ id: p.id, name: untrusted(p.name, 80), company: p.company })),
      },
      refs: { action: action.id },
    }
  },
})

export const requestTools: ToolDef[] = [findPeople, draftNotes, exportCsv] as ToolDef[]
