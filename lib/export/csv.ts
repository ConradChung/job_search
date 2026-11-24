import { canonicalLinkedin, linkedinKey } from '@/lib/people/parse'
import { leaderScore } from '@/lib/drafts/targets'
import { EXPORT_COLUMNS, type ExportRow } from './columns'

/** One line per row: line breaks inside a field become a single space. */
export function oneLine(v: string | null | undefined): string {
  return (v ?? '').replace(/\r\n|\r|\n|\u2028|\u2029/g, ' ').replace(/ {2,}/g, ' ').trim()
}

/** RFC 4180 field: quoted when it holds a comma, quote or line break (or edge spaces); quotes doubled. */
export function csvField(v: string): string {
  return /[",\r\n]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** Fields whose line breaks are part of the message (kept, quoted); every other field is one line. */
export const MULTILINE_COLUMNS: ReadonlySet<string> = new Set(['after_accept_message', 'email_body'])

/** Line breaks kept as \n (the row separator stays CRLF); the field is quoted by csvField. */
export function keepLines(v: string | null | undefined): string {
  return (v ?? '').replace(/\r\n|\r|\u2028|\u2029/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
}

export function exportCell(key: string, v: string | null | undefined): string {
  return csvField(MULTILINE_COLUMNS.has(key) ? keepLines(v) : oneLine(v))
}

/** CSV text (UTF-8, CRLF row endings), header row from the column config. Multi-line messages are quoted. */
export function toCsv(rows: ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.map((c) => csvField(c.header)).join(',')]
  for (const r of rows) lines.push(EXPORT_COLUMNS.map((c) => exportCell(c.key, r[c.key])).join(','))
  return lines.join('\r\n') + '\r\n'
}

/** https://www.linkedin.com/in/<slug>, no query string or trailing slash; null if not a profile URL. */
export function normalizeLinkedIn(url: string | null | undefined): string | null {
  if (!url) return null
  const key = linkedinKey(url.trim())
  return key ? canonicalLinkedin(key) : null
}

/** First / last name, without pronouns, nicknames in brackets or credentials after a comma. */
export function splitName(full: string): { first: string; last: string } {
  const words = full
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/,.*$/, '')
    .replace(/\b(she|he|they)\/(her|him|them|they)s?\b/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return { first: words[0] ?? '', last: words.slice(1).join(' ') }
}

/** alum / recruiter / sales leader / founder (CROs and other sales titles count as sales leaders). */
export function contactType(branch: string, title: string | null): string {
  if (branch === 'alumni' || branch === 'blockchain_ucla') return 'alum'
  if (branch === 'recruiting') return 'recruiter'
  if (branch === 'gtm_leadership') return 'sales leader'
  if (branch === 'executive') return leaderScore({ branch, title }) === 0 ? 'sales leader' : 'founder'
  return branch
}

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, CRLF / LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim()))
}

export interface ExportCandidate {
  id: number
  status: string
  /** 1, 2 or 3 (GTM Eng, SDR, RevOps). */
  tier: number
  /** Position in the page's current sort. */
  order: number
  url: string | null
  name: string
  company: string
  /** Recruiter whose role isn't marked Applied: their message says "I've applied", so they wait ("apply first"). */
  applyFirst?: boolean
  /** Messages use the company's researched hook and the owner hasn't ticked "I've read this". */
  hookUnread?: boolean
}

/**
 * The people a file takes (owner rules, 2026-11-24): Approved notes only
 * (Exported too when asked), the selected tiers only, highest tier first then
 * the page's sort, people without a profile URL skipped and listed, first N.
 */
export function pickForExport(cands: ExportCandidate[], opts: { tiers: number[]; includeExported: boolean; limit: number | null }) {
  const eligible = cands
    .filter((c) => c.status === 'approved' || (opts.includeExported && c.status === 'exported'))
    .filter((c) => opts.tiers.includes(c.tier))
    .sort((a, b) => a.tier - b.tier || a.order - b.order)
  const noUrl = eligible.filter((c) => !normalizeLinkedIn(c.url))
  const applyFirst = eligible.filter((c) => normalizeLinkedIn(c.url) && c.applyFirst)
  const hookUnread = eligible.filter((c) => normalizeLinkedIn(c.url) && !c.applyFirst && c.hookUnread)
  const withUrl = eligible.filter((c) => normalizeLinkedIn(c.url) && !c.applyFirst && !c.hookUnread)
  const chosen = opts.limit ? withUrl.slice(0, opts.limit) : withUrl
  return { chosen, noUrl, applyFirst, hookUnread, available: withUrl.length }
}
