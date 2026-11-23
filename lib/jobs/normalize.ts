import { statusFromSheet, type Status } from './statuses'

export type Board = 'ashby' | 'greenhouse' | 'lever' | 'linkedin' | 'other'

/** Sheet facts for one row. Tracking fields (status, notes, liveness) are separate. */
export interface JobFacts {
  company: string
  company_key: string
  link: string
  link_key: string
  title: string | null
  section: 'main' | 'referrals'
  fit_tier: number | null
  funding_stage: string | null
  total_funding: number | null
  salary_text: string | null
  salary_min: number | null
  salary_max: number | null
  location: string | null
  posted_at: string | null
  company_website: string | null
  company_linkedin: string | null
  job_poster_name: string | null
  job_poster_title: string | null
  job_poster_url: string | null
  company_size: string | null
  industries: string | null
  sources: string | null
  board: Board
  raw: Record<string, string>
  sheet_row: number
}

/** A row ready to insert for the first time: facts plus seeded tracking. */
export interface JobInsert extends JobFacts {
  status: Status
  email_sent: string | null
}

export function boardOf(link: string): Board {
  let host = ''
  try {
    host = new URL(link).hostname.toLowerCase()
  } catch {
    return 'other'
  }
  if (host.endsWith('ashbyhq.com')) return 'ashby'
  if (host.endsWith('greenhouse.io')) return 'greenhouse'
  if (host.endsWith('lever.co')) return 'lever'
  if (host.endsWith('linkedin.com')) return 'linkedin'
  return 'other'
}

/**
 * Stable key for a job link. LinkedIn links carry per-click tracking params
 * (and search-results URLs carry the id as `currentJobId`), so both collapse
 * to `linkedin.com/jobs/view/{id}`. Other links: lowercased, no query,
 * fragment or trailing slash.
 */
export function linkKey(link: string): string {
  const trimmed = link.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return trimmed.toLowerCase()
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host.endsWith('linkedin.com')) {
    const viewId = url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1]
    const id = viewId ?? url.searchParams.get('currentJobId')
    if (id) return `linkedin.com/jobs/view/${id}`
  }
  return `${host}${url.pathname}`.replace(/\/+$/, '').toLowerCase()
}

/**
 * Canonical link to store and open: LinkedIn collapses to the clean
 * /jobs/view/{id} URL; everything else is kept as written.
 */
export function canonicalLink(link: string): string {
  const key = linkKey(link)
  return key.startsWith('linkedin.com/jobs/view/') ? `https://www.${key}` : link.trim()
}

export function companyKey(company: string): string {
  return company.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Company from an ATS board URL, for rows where the sheet left it blank. */
export function companyFromLink(link: string): string | null {
  try {
    const url = new URL(link)
    const board = boardOf(link)
    if (board === 'ashby' || board === 'greenhouse' || board === 'lever') {
      return url.pathname.split('/').filter(Boolean)[0] ?? null
    }
  } catch {
    // fall through
  }
  return null
}

const text = (v: string | undefined) => {
  const t = (v ?? '').trim()
  return t ? t : null
}

const num = (v: string | undefined) => {
  const t = (v ?? '').replace(/[$,\s]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const int = (v: string | undefined) => {
  const n = num(v)
  return n === null ? null : Math.round(n)
}

const date = (v: string | undefined) => {
  const t = (v ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null
}

const tier = (v: string | undefined) => {
  const n = int(v)
  return n !== null && n >= 1 && n <= 5 ? n : null
}

export interface ParseResult {
  rows: JobInsert[]
  skipped: { sheetRow: number; reason: string }[]
}

/**
 * Jobs Final CSV rows (header first) → insert rows.
 *
 * A row whose status cell reads "Status" is a section header (the sheet has a
 * "Referrals" block); rows after it get that section. Rows with no link are
 * skipped. Duplicate (company, link) pairs keep the first occurrence.
 */
export function parseJobsFinal(csvRows: string[][]): ParseResult {
  const [header, ...body] = csvRows
  if (!header) return { rows: [], skipped: [] }
  const col = (name: string) => header.indexOf(name)
  const idx = {
    company: col('companyName'),
    title: col('title'),
    link: col('link'),
    status: col('status'),
    email: col('email sent'),
    tier: col('fit_tier'),
  }
  if (idx.company < 0 || idx.link < 0) {
    throw new Error('CSV is not the Jobs Final tab: missing companyName or link column')
  }

  const rows: JobInsert[] = []
  const skipped: ParseResult['skipped'] = []
  const seen = new Set<string>()
  let section: JobFacts['section'] = 'main'

  body.forEach((cells, i) => {
    const sheetRow = i + 2
    const get = (name: string) => {
      const j = header.indexOf(name)
      return j < 0 ? undefined : cells[j]
    }
    if (!cells.some((c) => c.trim())) return

    if ((cells[idx.status] ?? '').trim().toLowerCase() === 'status') {
      section = /referral/i.test(cells[idx.company] ?? '') ? 'referrals' : 'main'
      skipped.push({ sheetRow, reason: 'section header' })
      return
    }

    const rawLink = (cells[idx.link] ?? '').trim()
    if (!rawLink) {
      skipped.push({ sheetRow, reason: 'no link' })
      return
    }

    const company = text(cells[idx.company]) ?? companyFromLink(rawLink) ?? 'Unknown'
    const key = `${companyKey(company)}|${linkKey(rawLink)}`
    if (seen.has(key)) {
      skipped.push({ sheetRow, reason: 'duplicate' })
      return
    }
    seen.add(key)

    const raw: Record<string, string> = {}
    header.forEach((h, j) => {
      if (h && cells[j]?.trim()) raw[h] = cells[j]
    })

    rows.push({
      company,
      company_key: companyKey(company),
      link: canonicalLink(rawLink),
      link_key: linkKey(rawLink),
      title: text(cells[idx.title]),
      section,
      fit_tier: tier(cells[idx.tier]),
      funding_stage: text(get('fundingStage')),
      total_funding: num(get('totalFunding')),
      salary_text: text(get('salaryText')),
      salary_min: int(get('salaryMin')),
      salary_max: int(get('salaryMax')),
      location: text(get('location')),
      posted_at: date(get('postedAt')),
      company_website: text(get('companyWebsite')),
      company_linkedin: text(get('companyLinkedinUrl')),
      job_poster_name: text(get('jobPosterName')),
      job_poster_title: text(get('jobPosterTitle')),
      job_poster_url: text(get('jobPosterProfileUrl')),
      company_size: text(get('companySize')),
      industries: text(get('industries')),
      sources: text(get('sources')),
      board: boardOf(rawLink),
      raw,
      sheet_row: sheetRow,
      status: statusFromSheet(cells[idx.status] ?? ''),
      email_sent: text(cells[idx.email]),
    })
  })

  return { rows, skipped }
}

/** Facts only: what a re-sync may overwrite on an existing row. */
export function factsOf(row: JobInsert): JobFacts {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { status, email_sent, ...facts } = row
  return facts
}
