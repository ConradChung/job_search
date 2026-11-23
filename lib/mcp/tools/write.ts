import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { noteProblems } from '@/lib/drafts/check'
import { refreshRecruiterFollowups } from '@/lib/drafts/recruiterFollowups'
import { loadCompany } from '@/lib/people/run'
import { idempotencyKey } from '../idempotency'
import { McpUserError } from '../sanitize'
import { defineTool, INTERNAL_APPEND, INTERNAL_WRITE, type ToolDef } from '../tool'

/**
 * Write tools change only this app's own rows (job status, person status,
 * notes). Nothing is sent, nothing touches LinkedIn or the sender, nothing
 * costs money. Each takes an optional idempotency_key.
 */

export type WriteDeps = {
  db: () => SupabaseClient
  check: typeof noteProblems
  refreshFollowups: typeof refreshRecruiterFollowups
}
export const writeDeps: WriteDeps = { db: () => createServiceClient(), check: noteProblems, refreshFollowups: refreshRecruiterFollowups }

const ROLE_STATUSES = ['new', 'applied', 'interviewing', 'rejected', 'not_fit'] as const
const PERSON_STATUSES = ['sent', 'replied', 'no_reply'] as const
/** Where a person may be marked from: the note went out (or was about to). Replied never moves back. */
const PERSON_FROM: Record<(typeof PERSON_STATUSES)[number], string[]> = {
  sent: ['approved', 'exported', 'no_reply'],
  replied: ['approved', 'exported', 'sent', 'no_reply'],
  no_reply: ['approved', 'exported', 'sent'],
}
/** A note can be edited until it has gone into a sender file. */
const EDITABLE = ['none', 'drafted', 'approved']

async function person(db: SupabaseClient, id: number) {
  const { data, error } = await db.from('people').select('id, company_key, company, full_name, outreach_status, draft').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new McpUserError(`No person with id ${id}.`)
  return data
}

export function makeWriteTools(deps: WriteDeps = writeDeps): ToolDef[] {
  const setRoleStatus = defineTool({
    name: 'jobhunt_set_role_status',
    title: 'Set a role status',
    description:
      "Sets one role's tracker status: new, applied, interviewing, rejected or not_fit. Like the page, a status change rewrites that company's recruiter after-accept messages from the fixed template (Applied gets the applied wording); notes are not touched. Changes only this app's data.",
    cls: 'write',
    input: z.object({ role_id: z.number().int().positive(), status: z.enum(ROLE_STATUSES), idempotency_key: idempotencyKey }),
    annotations: INTERNAL_WRITE,
    run: async ({ role_id, status }) => {
      const db = deps.db()
      const { data, error } = await db.from('jobs').update({ status }).eq('id', role_id).select('id, company_key, title, status').maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new McpUserError(`No role with id ${role_id}.`)
      const r = await deps.refreshFollowups(db, { companyKey: data.company_key, write: true })
      const rewritten = r.changes.filter((c) => !c.problems.length).length
      return { data: { role_id, status, recruiter_messages_rewritten: rewritten }, refs: { role: String(role_id) } }
    },
  })

  const setPersonStatus = defineTool({
    name: 'jobhunt_set_person_status',
    title: 'Set a person status',
    description:
      'Records what happened after the sender ran: sent, replied or no_reply. Only from Approved, Exported or Sent (a reply is never moved back). Records only; sends nothing. Changes only this app\'s data.',
    cls: 'write',
    input: z.object({ person_id: z.number().int().positive(), status: z.enum(PERSON_STATUSES), idempotency_key: idempotencyKey }),
    annotations: INTERNAL_WRITE,
    run: async ({ person_id, status }) => {
      const db = deps.db()
      const p = await person(db, person_id)
      if (p.outreach_status === status) return { data: { person_id, status, unchanged: true }, refs: { person: String(person_id) } }
      if (!PERSON_FROM[status].includes(p.outreach_status)) {
        throw new McpUserError(`Can't mark ${status} from ${p.outreach_status}. Allowed from: ${PERSON_FROM[status].join(', ')}.`)
      }
      const { error } = await db.from('people').update({ outreach_status: status }).eq('id', person_id).eq('outreach_status', p.outreach_status)
      if (error) throw new Error(error.message)
      return { data: { person_id, from: p.outreach_status, status }, refs: { person: String(person_id) } }
    },
  })

  const approveNote = defineTool({
    name: 'jobhunt_approve_note',
    title: 'Approve a note',
    description:
      'Drafted → Approved for one note, only if it passes every code check the page runs (length, numbers, banned phrases, proof-point rules, recruiter shape). A failing note stays Drafted and the problems are returned. Approving sends nothing; Approved notes go out only in a CSV the owner exports.',
    cls: 'write',
    input: z.object({ person_id: z.number().int().positive(), idempotency_key: idempotencyKey }),
    annotations: INTERNAL_WRITE,
    run: async ({ person_id }) => {
      const db = deps.db()
      const p = await person(db, person_id)
      if (p.outreach_status === 'approved') return { data: { person_id, status: 'approved', unchanged: true }, refs: { person: String(person_id) } }
      if (p.outreach_status !== 'drafted' || !p.draft) throw new McpUserError(`Only Drafted notes can be approved; this one is ${p.outreach_status}${p.draft ? '' : ' with no note'}.`)
      const problems = await deps.check(db, person_id, p.draft)
      if (problems.length) throw new McpUserError(`Not approved; the note fails the checks: ${problems.join(' ')}`)
      const { error } = await db.from('people').update({ outreach_status: 'approved' }).eq('id', person_id).eq('outreach_status', 'drafted')
      if (error) throw new Error(error.message)
      return { data: { person_id, status: 'approved' }, refs: { person: String(person_id) } }
    },
  })

  const editNote = defineTool({
    name: 'jobhunt_edit_note',
    title: 'Edit a note',
    description:
      "Replaces one person's connection note. The new text runs through the same code checks as the page (length, numbers, banned phrases, proof-point rules, recruiter shape, closeness to colleagues' notes) and is rejected with the problems if any fail. An edited Approved note goes back to Drafted for the owner to re-approve. Not allowed once the note is in a sender file. Changes only this app's data.",
    cls: 'write',
    input: z.object({ person_id: z.number().int().positive(), note: z.string().min(1).max(1000), idempotency_key: idempotencyKey }),
    annotations: INTERNAL_WRITE,
    run: async ({ person_id, note }) => {
      const db = deps.db()
      const p = await person(db, person_id)
      if (!EDITABLE.includes(p.outreach_status)) throw new McpUserError(`This note is ${p.outreach_status}; it can't be edited any more.`)
      const text = note.trim()
      const problems = await deps.check(db, person_id, text)
      if (problems.length) throw new McpUserError(`Rejected; the note fails the checks: ${problems.join(' ')}`)
      const status = p.outreach_status === 'none' ? 'drafted' : p.outreach_status === 'approved' ? 'drafted' : p.outreach_status
      const { error } = await db.from('people').update({ draft: text, outreach_status: status }).eq('id', person_id)
      if (error) throw new Error(error.message)
      return { data: { person_id, status, length: text.length }, refs: { person: String(person_id) } }
    },
  })

  const addCompanyNote = defineTool({
    name: 'jobhunt_add_company_note',
    title: 'Add a company note',
    description:
      "Appends a dated note (marked 'via Claude') to the company's best-fit role notes, shown on the Pipeline page. Never replaces what is there. Changes only this app's data.",
    cls: 'write',
    input: z.object({ company_key: z.string().min(1).max(120), note: z.string().min(1).max(1000), idempotency_key: idempotencyKey }),
    annotations: INTERNAL_APPEND,
    run: async ({ company_key, note }) => {
      const db = deps.db()
      const loaded = await loadCompany(db, company_key)
      const role = loaded?.fit.primary
      if (!role) throw new McpUserError(`No company with key "${company_key}".`)
      const { data, error } = await db.from('jobs').select('notes').eq('id', role.id).single()
      if (error) throw new Error(error.message)
      const line = `[${new Date().toISOString().slice(0, 10)} via Claude] ${note.trim()}`
      const notes = data?.notes ? `${data.notes}\n${line}` : line
      if (notes.length > 4000) throw new McpUserError('Role notes would pass 4000 characters; trim them in the app first.')
      const { error: e } = await db.from('jobs').update({ notes }).eq('id', role.id)
      if (e) throw new Error(e.message)
      return { data: { company_key, role_id: role.id, added: line }, refs: { role: String(role.id) } }
    },
  })

  return [setRoleStatus, setPersonStatus, approveNote, editNote, addCompanyNote] as ToolDef[]
}

export const writeTools = makeWriteTools()
