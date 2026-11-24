import type { SupabaseClient } from '@supabase/supabase-js'
import { PROFILE } from '@/lib/profile'
import { loadCompany } from '@/lib/people/run'
import { noteRoleTitle } from '@/lib/drafts/run'
import { shortRole } from '@/lib/drafts/prompt'
import { tierOf } from '@/lib/jobs/fit'
import { IMPORT_STATUS_HEADERS, IMPORT_STATUS_MAP, IMPORT_URL_HEADERS, type ExportRow } from './columns'
import { contactType, normalizeLinkedIn, parseCsv, pickForExport, splitName, toCsv, type ExportCandidate } from './csv'

export interface ExportOptions {
  /** Person ids in the page's current order (filters already applied). */
  ids: number[]
  tiers: number[]
  includeExported: boolean
  limit: number | null
  /** false: preview only (count, warnings). true: build the file and mark people Exported. */
  write: boolean
}

type Listed = { id: number; name: string; company: string }

export interface ExportResult {
  count: number
  available: number
  noUrl: Listed[]
  overLimit: (Listed & { length: number })[]
  /** Recruiters held out of the file until their role is marked Applied (their message says "I've applied"). */
  applyFirst: (Listed & { role: string; status: string; link: string | null })[]
  people: Listed[]
  csv?: string
  filename?: string
}

/**
 * Sender CSV (GTM-22, CSV hookup). Nothing is sent and no outside API is called:
 * this reads the database, builds the file and, when writing, marks the people
 * in it Exported (with the date) so later exports leave them out.
 */
export async function runExport(db: SupabaseClient, o: ExportOptions): Promise<ExportResult> {
  const { data: people, error } = await db
    .from('people')
    .select('id, company_key, company, full_name, title, branch, linkedin_url, outreach_status, draft, followup')
    .in('id', o.ids.length ? o.ids : [-1])
  if (error) throw new Error(error.message)

  const companies = new Map<string, Awaited<ReturnType<typeof loadCompany>>>()
  for (const k of new Set((people ?? []).map((p) => p.company_key))) companies.set(k, await loadCompany(db, k))

  const order = new Map(o.ids.map((id, i) => [id, i]))
  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  const cands: ExportCandidate[] = (people ?? []).map((p) => {
    const fit = companies.get(p.company_key)?.fit
    const exportable = !!fit && (fit.passes || fit.override)
    const roleStatus = (fit?.primary as { status?: string } | null | undefined)?.status ?? ''
    return {
      id: p.id,
      status: p.outreach_status,
      tier: exportable ? tierOf(fit!.track) : 0,
      order: order.get(p.id) ?? 1e9,
      url: p.linkedin_url,
      name: p.full_name,
      company: p.company,
      applyFirst: p.branch === 'recruiting' && roleStatus !== 'applied',
    }
  })
  const picked = pickForExport(cands, { tiers: o.tiers, includeExported: o.includeExported, limit: o.limit })
  const listed = (c: ExportCandidate): Listed => ({ id: c.id, name: c.name, company: c.company })

  const rows: ExportRow[] = []
  const overLimit: ExportResult['overLimit'] = []
  const applyFirst: ExportResult['applyFirst'] = picked.applyFirst.map((c) => {
    const fit = companies.get(byId.get(c.id)!.company_key)!.fit
    const role = fit.primary as { title?: string | null; status?: string; link?: string } | null
    return { ...listed(c), role: shortRole(noteRoleTitle(fit, role?.title ?? null)), status: role?.status || 'new', link: role?.link ?? null }
  })
  for (const c of picked.chosen) {
    const p = byId.get(c.id)!
    const fit = companies.get(p.company_key)!.fit
    const role = fit.primary
    const note = (p.draft ?? '') as string
    if (!note || note.length > PROFILE.noteLimit) overLimit.push({ ...listed(c), length: note.length })
    const roleTitle = shortRole(noteRoleTitle(fit, role?.title ?? null))
    const roleStatus = (role as { status?: string } | null)?.status ?? ''
    const { first, last } = splitName(p.full_name)
    rows.push({
      linkedin_url: normalizeLinkedIn(p.linkedin_url)!,
      first_name: first,
      last_name: last,
      company: p.company,
      title: p.title ?? '',
      contact_type: contactType(p.branch, p.title),
      track: PROFILE.constraints.tracks[fit.track]?.label ?? fit.track,
      role: roleTitle,
      note,
      after_accept_message: p.followup ?? '',
      role_status: roleStatus,
      company_id: p.company_key,
      person_id: String(p.id),
    })
  }

  const result: ExportResult = {
    count: picked.chosen.length,
    available: picked.available,
    noUrl: picked.noUrl.map(listed),
    overLimit,
    applyFirst,
    people: picked.chosen.map(listed),
  }
  // Refused while any note is over the limit (or missing): nothing is written.
  if (!o.write || overLimit.length || !rows.length) return result

  const now = new Date()
  const { error: e } = await db
    .from('people')
    .update({ outreach_status: 'exported', exported_at: now.toISOString() })
    .in('id', picked.chosen.map((c) => c.id))
  if (e) throw new Error(`mark exported: ${e.message}`)
  const tiers = [...new Set(picked.chosen.map((c) => c.tier))].sort().join('-')
  return { ...result, csv: toCsv(rows), filename: `sender-tier${tiers}-${now.toISOString().slice(0, 10)}-${rows.length}.csv` }
}

export interface ImportResult {
  rows: number
  updated: { id: number; name: string; status: string }[]
  unchanged: number
  unmatched: string[]
  unknownStatus: string[]
  error?: string
}

const RANK: Record<string, number> = { none: 0, drafted: 1, approved: 2, exported: 3, sent: 4, replied: 5 }

/**
 * Sender results CSV: linkedin_url + status. Marks people Sent or Replied by
 * matching the normalised profile URL. Never moves a status backwards
 * (replied stays replied) and never touches Skip.
 */
export async function importResults(db: SupabaseClient, text: string): Promise<ImportResult> {
  const table = parseCsv(text)
  const out: ImportResult = { rows: 0, updated: [], unchanged: 0, unmatched: [], unknownStatus: [] }
  if (table.length < 2) return { ...out, error: 'The file has no data rows.' }
  const head = table[0].map((h) => h.trim().toLowerCase())
  const urlCol = head.findIndex((h) => IMPORT_URL_HEADERS.includes(h))
  const statusCol = head.findIndex((h) => IMPORT_STATUS_HEADERS.includes(h))
  if (urlCol < 0 || statusCol < 0) return { ...out, error: `Need a linkedin_url column and a status column; found: ${table[0].join(', ')}` }

  const { data: people, error } = await db.from('people').select('id, full_name, linkedin_url, outreach_status')
  if (error) throw new Error(error.message)
  const byUrl = new Map<string, NonNullable<typeof people>[number][]>()
  for (const p of people ?? []) {
    const u = normalizeLinkedIn(p.linkedin_url)
    if (u) byUrl.set(u.toLowerCase(), [...(byUrl.get(u.toLowerCase()) ?? []), p])
  }

  for (const row of table.slice(1)) {
    out.rows++
    const raw = (row[urlCol] ?? '').trim()
    const url = normalizeLinkedIn(raw)?.toLowerCase()
    const word = (row[statusCol] ?? '').trim().toLowerCase()
    const status = IMPORT_STATUS_MAP[word]
    if (!status) {
      if (word) out.unknownStatus.push(`${raw || '(no url)'}: ${row[statusCol]}`)
      else out.unchanged++
      continue
    }
    const matches = url ? byUrl.get(url) : undefined
    if (!matches?.length) {
      out.unmatched.push(raw || '(no url)')
      continue
    }
    for (const p of matches) {
      if (p.outreach_status === 'skip' || (RANK[p.outreach_status] ?? 0) >= RANK[status]) {
        out.unchanged++
        continue
      }
      const { error: e } = await db.from('people').update({ outreach_status: status }).eq('id', p.id)
      if (e) throw new Error(`import: ${e.message}`)
      p.outreach_status = status
      out.updated.push({ id: p.id, name: p.full_name, status })
    }
  }
  return out
}
