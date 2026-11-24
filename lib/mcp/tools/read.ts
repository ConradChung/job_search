import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/service'
import { loadCompanies, peopleInOrder } from '@/lib/pipeline/load'
import { applyFilters, CLEARED, rollupStatus, rowTrack, type Filters } from '@/lib/pipeline/filters'
import { fitTrack, tierOf, type FitTrack } from '@/lib/jobs/fit'
import { STATUSES } from '@/lib/jobs/statuses'
import { PROFILE } from '@/lib/profile'
import { draftTargetIds } from '@/lib/drafts/targets'
import { contactType } from '@/lib/export/csv'
import { loadPendingActions } from '@/lib/actions/pending'
import { previewExport } from '@/lib/actions/requests'
import type { CompanyView } from '@/lib/people/companies'
import type { PersonRow } from '@/lib/people/types'
import { pageInput, pageOf, queryKey } from '../page'
import { McpUserError, untrusted } from '../sanitize'
import { defineTool, READ_ONLY, type ToolDef } from '../tool'

const NOTE_STATUSES = ['drafted', 'approved', 'exported', 'sent', 'replied', 'no_reply'] as const
const TIER_TRACK: Record<string, FitTrack> = { '1': 'gtm_eng', '2': 'sdr', '3': 'revops', blocked: 'blocked' }
const tierName = (t: FitTrack) => (t === 'blocked' ? 'blocked' : `Tier ${tierOf(t)} · ${PROFILE.constraints.tracks[t]?.label ?? t}`)

const tierInput = z.enum(['1', '2', '3', 'blocked']).optional().describe('Tier 1 GTM Eng, 2 SDR/BDR, 3 RevOps, or blocked. Omit for all.')

function countBy<T>(list: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const x of list) out[key(x)] = (out[key(x)] ?? 0) + 1
  return out
}

const noteCounts = (people: PersonRow[]) => {
  const withNote = people.filter((p) => p.draft)
  return Object.fromEntries(NOTE_STATUSES.map((s) => [s, withNote.filter((p) => p.outreach_status === s).length]))
}

/** A company row as lists show it: no notes, no third-party text beyond the role title. */
function companyRow(c: CompanyView) {
  const t = rowTrack(c)
  return {
    key: c.key,
    name: c.name,
    tier: t === 'blocked' ? null : tierOf(t),
    track: tierName(t),
    passes: c.passes || c.override,
    flags: c.flags.filter((f) => f.level !== 'info').map((f) => `${f.level}: ${f.message}`),
    best_role: c.primary ? { id: c.primary.id, title: untrusted(c.primary.title, 120), status: c.primary.status, live: c.primary.liveness ?? 'unchecked' } : null,
    roles: c.roles.length,
    size: c.band,
    people: c.people.length,
    notes: noteCounts(c.people),
  }
}

const getOverview = defineTool({
  name: 'jobhunt_get_overview',
  title: 'Overview',
  description:
    'Start here. Counts per tier (companies, people, notes), notes by status (drafted, approved, exported, sent, replied, no reply), roles by status, what is waiting on the owner (requests to confirm, notes to review, approved notes ready to export, exports awaiting results), and spend so far. Read-only.',
  cls: 'read',
  input: z.object({}),
  annotations: READ_ONLY,
  run: async () => {
    const db = createServiceClient()
    const [companies, actions] = await Promise.all([loadCompanies(db), loadPendingActions(db)])
    const tracks: FitTrack[] = ['gtm_eng', 'sdr', 'revops']
    const people = companies.flatMap((c) => c.people)
    const roles = companies.flatMap((c) => c.roles)
    const inTier = (t: FitTrack) => companies.filter((c) => rowTrack(c) === t)
    const exa = companies.reduce((n, c) => n + c.spend, 0)
    const claude = companies.reduce((n, c) => n + c.claudeSpend, 0)
    const awaiting = actions.filter((a) => a.status === 'awaiting')
    return {
      data: {
        tiers: tracks.map((t) => {
          const list = inTier(t)
          const ppl = list.flatMap((c) => c.people)
          return { tier: tierOf(t), track: PROFILE.constraints.tracks[t].label, companies: list.length, with_people: list.filter((c) => c.people.length).length, people: ppl.length, notes: noteCounts(ppl) }
        }),
        blocked_companies: inTier('blocked').length,
        notes_by_status: noteCounts(people),
        roles_by_status: Object.fromEntries(STATUSES.map((s) => [s.value, roles.filter((r) => r.status === s.value).length])),
        roles_live: countBy(roles, (r) => r.liveness ?? 'unchecked'),
        waiting_on_owner: {
          requests_to_confirm: awaiting.map((a) => ({ id: a.id, kind: a.kind, summary: a.summary, est_cost_usd: Number(a.est_cost_usd), created_at: a.created_at })),
          notes_to_review: Object.fromEntries(tracks.map((t) => [`tier_${tierOf(t)}`, inTier(t).flatMap((c) => c.people).filter((p) => p.outreach_status === 'drafted' && p.draft).length])),
          approved_ready_to_export: Object.fromEntries(tracks.map((t) => [`tier_${tierOf(t)}`, inTier(t).flatMap((c) => c.people).filter((p) => p.outreach_status === 'approved').length])),
          exported_awaiting_results: people.filter((p) => p.outreach_status === 'exported').length,
        },
        spend_usd: { total: +(exa + claude).toFixed(2), exa: +exa.toFixed(2), claude: +claude.toFixed(2) },
      },
    }
  },
})

const listCompanies = defineTool({
  name: 'jobhunt_list_companies',
  title: 'List companies',
  description:
    "One row per company in the Pipeline page's order (Blockchain @ UCLA alumni, then tier, NYC, newest): tier, fit flags, best role, size, people and note counts. Filters as on the page. Paged. Read-only.",
  cls: 'read',
  input: z.object({
    tier: tierInput,
    fit: z.enum(['passes', 'flagged', 'all']).optional().describe('Default passes.'),
    role_status: z.enum(['new', 'reached_out', 'applied', 'interviewing', 'offer', 'rejected', 'not_fit']).optional().describe("Company status (its furthest-along role)."),
    has_people: z.boolean().optional(),
    search: z.string().max(100).optional().describe('Company, role title, location or person name.'),
    ...pageInput,
  }),
  annotations: READ_ONLY,
  run: async (a) => {
    const f: Filters = {
      ...CLEARED,
      tiers: a.tier ? new Set([TIER_TRACK[a.tier]]) : new Set(),
      fit: a.fit ?? (a.tier === 'blocked' ? 'all' : 'passes'),
      status: a.role_status ?? 'all',
      people: a.has_people === undefined ? 'all' : a.has_people ? 'has' : 'none',
      query: a.search ?? '',
    }
    const rows = applyFilters(await loadCompanies(createServiceClient()), f).map(companyRow)
    return { data: pageOf(rows, a, queryKey('jobhunt_list_companies', a)) }
  },
})

const getCompany = defineTool({
  name: 'jobhunt_get_company',
  title: 'Get a company',
  description:
    "Everything on one company: each role (title, category, tier, status, live, classifier reason, fit flags, the owner's role notes), the routing rule for people search, and each person with their LinkedIn URL, status, note and after-accept message. Emails are never included. Read-only.",
  cls: 'read',
  input: z.object({ company_key: z.string().min(1).max(120).describe('Company key from jobhunt_list_companies.') }),
  annotations: READ_ONLY,
  run: async ({ company_key }) => {
    const companies = await loadCompanies(createServiceClient())
    const c = companies.find((x) => x.key === company_key.toLowerCase() || x.key === company_key)
    if (!c) throw new McpUserError(`No company with key "${company_key}". Use jobhunt_list_companies to find keys.`)
    const targets = draftTargetIds(c.people, new Set(c.fitTrack === 'sdr' ? [c.key] : []))
    return {
      data: {
        ...companyRow(c),
        website: c.website,
        employees: c.employees,
        rule: { text: c.rule, applied: c.ruleApplied, searched_at: c.searchedAt },
        status: rollupStatus(c.roles),
        roles: c.roles.map((r) => ({
          id: r.id,
          title: untrusted(r.title, 160),
          category: r.category,
          tier: tierOf(fitTrack(r.category)) || null,
          status: r.status,
          live: r.liveness ?? 'unchecked',
          posted_at: r.posted_at,
          location: untrusted(r.location, 120),
          link: r.link,
          best_fit: r.id === c.primary?.id,
          reason: untrusted(r.classify_reason, 300),
          flags: (c.roleFlags[r.id] ?? []).map((f) => `${f.level}: ${f.message}`),
          notes: r.notes ?? null,
        })),
        people: peopleInOrder([c]).map((p) => ({
          id: p.id,
          name: untrusted(p.full_name, 80),
          title: untrusted(p.title, 160),
          contact_type: contactType(p.branch, p.title),
          linkedin_url: p.linkedin_url,
          draft_target: targets.has(p.id),
          status: p.outreach_status,
          exported_at: p.exported_at ?? null,
          note: p.draft,
          after_accept_message: p.followup,
        })),
      },
    }
  },
})

const listPeople = defineTool({
  name: 'jobhunt_list_people',
  title: 'List people',
  description: 'People in page order with their company, tier, contact type, status and note. Filter by status and tier. Emails are never included. Paged. Read-only.',
  cls: 'read',
  input: z.object({
    status: z.enum(['none', 'drafted', 'approved', 'exported', 'sent', 'replied', 'no_reply', 'skip']).optional(),
    tier: tierInput,
    ...pageInput,
  }),
  annotations: READ_ONLY,
  run: async (a) => {
    const companies = await loadCompanies(createServiceClient())
    const byKey = new Map(companies.map((c) => [c.key, c]))
    const scoped = a.tier ? companies.filter((c) => rowTrack(c) === TIER_TRACK[a.tier!]) : companies
    const rows = peopleInOrder(scoped)
      .filter((p) => !a.status || p.outreach_status === a.status)
      .map((p) => {
        const c = byKey.get(p.company_key)!
        const t = rowTrack(c)
        return {
          id: p.id,
          name: untrusted(p.full_name, 80),
          company: c.name,
          company_key: c.key,
          tier: t === 'blocked' ? null : tierOf(t),
          contact_type: contactType(p.branch, p.title),
          status: p.outreach_status,
          note: p.draft,
        }
      })
    return { data: pageOf(rows, a, queryKey('jobhunt_list_people', a)) }
  },
})

const exportPreview = defineTool({
  name: 'jobhunt_export_preview',
  title: 'Preview the next export',
  description:
    'Exactly what the next sender CSV batch would contain (Approved notes, page order, highest tier first), with skipped people, notes over the limit and recruiter rows whose role is not Applied. Marks nothing and writes no file. Read-only.',
  cls: 'read',
  input: z.object({
    tiers: z.array(z.number().int().min(1).max(3)).min(1).max(3).optional().describe('Default [1].'),
    limit: z.number().int().min(1).max(200).optional().describe('First N rows (default 15).'),
    include_exported: z.boolean().optional(),
  }),
  annotations: READ_ONLY,
  run: async (a) => {
    const db = createServiceClient()
    const r = await previewExport(db, await loadCompanies(db), { tiers: a.tiers ?? [1], limit: a.limit, include_exported: a.include_exported })
    const { person_ids: _ids, ...rest } = r
    void _ids
    return {
      data: {
        ...rest,
        noUrl: r.noUrl.map((p) => ({ ...p, name: untrusted(p.name, 80) })),
        overLimit: r.overLimit.map((p) => ({ ...p, name: untrusted(p.name, 80) })),
        applyFirst: r.applyFirst.map((p) => ({ ...p, name: untrusted(p.name, 80) })),
        people: r.people.map((p) => ({ id: p.id, name: untrusted(p.name, 80), company: p.company })),
        note: 'Preview only. To export, use jobhunt_request_export_csv; the owner confirms it in the app.',
      },
    }
  },
})

export const readTools: ToolDef[] = [getOverview, listCompanies, getCompany, listPeople, exportPreview] as ToolDef[]
