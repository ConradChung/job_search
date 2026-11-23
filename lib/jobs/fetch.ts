/**
 * Posting fetcher: live/dead status plus description and department.
 *
 * ATS APIs first (Ashby, Greenhouse, Lever). LinkedIn's public posting page is
 * a fallback only: one attempt, no retries; a failure leaves the job
 * unchecked and its classification low-confidence. Other links get a plain
 * liveness check.
 */
export interface FetchResult {
  live: boolean | null
  description: string | null
  department: string | null
  source: 'ashby' | 'greenhouse' | 'lever' | 'linkedin' | null
  error: string | null
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
const CLOSED = /no longer accepting applications|position has been filled|job (is )?not found|this job (posting )?(has )?(expired|closed)|job is no longer available/i

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }
export function unescapeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z0-9#]+);/gi, (m, k) => ENTITIES[k.toLowerCase()] ?? m)
}
export function htmlToText(html: string): string {
  return unescapeHtml(
    html
      .replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

async function get(url: string, timeoutMs = 15000, accept = 'application/json,text/html') {
  return fetch(url, { headers: { 'user-agent': UA, accept }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
}

/** Ashby returns the whole board; cache per org within a run. */
const ashbyBoards = new Map<string, Promise<{ id: string; department?: string; team?: string; descriptionPlain?: string }[] | null>>()
function ashbyBoard(org: string) {
  if (!ashbyBoards.has(org)) {
    ashbyBoards.set(
      org,
      get(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}`)
        .then(async (r) => (r.ok ? ((await r.json()).jobs ?? []) : r.status === 404 ? [] : null))
        .catch(() => null)
    )
  }
  return ashbyBoards.get(org)!
}

export function parseAtsLink(link: string): { kind: 'ashby' | 'greenhouse' | 'lever' | 'linkedin'; org?: string; id: string } | null {
  let u: URL
  try {
    u = new URL(link)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  const parts = u.pathname.split('/').filter(Boolean)
  if (host.endsWith('ashbyhq.com') && parts.length >= 2) return { kind: 'ashby', org: parts[0], id: parts[1] }
  if (host.endsWith('greenhouse.io')) {
    const i = parts.indexOf('jobs')
    if (i > 0 && parts[i + 1]) return { kind: 'greenhouse', org: parts[i - 1], id: parts[i + 1] }
    const gh = u.searchParams.get('gh_jid')
    if (gh && parts[0]) return { kind: 'greenhouse', org: parts[0], id: gh }
  }
  if (host.endsWith('lever.co') && parts.length >= 2) return { kind: 'lever', org: parts[0], id: parts[1] }
  if (host.endsWith('linkedin.com')) {
    const id = u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1] ?? u.searchParams.get('currentJobId')
    if (id) return { kind: 'linkedin', id }
  }
  return null
}

const none = (error: string | null, live: boolean | null = null): FetchResult => ({ live, description: null, department: null, source: null, error })

export async function fetchPosting(link: string): Promise<FetchResult> {
  const ats = parseAtsLink(link)
  try {
    if (ats?.kind === 'ashby') {
      const jobs = await ashbyBoard(ats.org!)
      if (!jobs) return none('ashby board unavailable')
      const job = jobs.find((j) => j.id === ats.id)
      if (!job) return none(null, false)
      return { live: true, description: job.descriptionPlain ?? null, department: job.department ?? job.team ?? null, source: 'ashby', error: null }
    }
    if (ats?.kind === 'greenhouse') {
      const r = await get(`https://boards-api.greenhouse.io/v1/boards/${ats.org}/jobs/${ats.id}?content=true`)
      if (r.status === 404) return none(null, false)
      if (!r.ok) return none(`greenhouse ${r.status}`)
      const j = await r.json()
      return { live: true, description: j.content ? htmlToText(unescapeHtml(j.content)) : null, department: j.departments?.[0]?.name ?? null, source: 'greenhouse', error: null }
    }
    if (ats?.kind === 'lever') {
      const r = await get(`https://api.lever.co/v0/postings/${ats.org}/${ats.id}`)
      if (r.status === 404) return none(null, false)
      if (!r.ok) return none(`lever ${r.status}`)
      const j = await r.json()
      const lists = (j.lists ?? []).map((l: { text: string; content: string }) => `${l.text}\n${htmlToText(l.content)}`).join('\n')
      return {
        live: true,
        description: [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join('\n'),
        department: j.categories?.department ?? j.categories?.team ?? null,
        source: 'lever',
        error: null,
      }
    }
    if (ats?.kind === 'linkedin') {
      // Fallback only: one attempt, no retry.
      const r = await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${ats.id}`)
      if (r.status === 404) return none(null, false)
      if (!r.ok) return none(`linkedin ${r.status}`)
      const html = await r.text()
      if (CLOSED.test(html)) return none(null, false)
      const m = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)
      return { live: true, description: m ? htmlToText(m[1]) : null, department: null, source: 'linkedin', error: m ? null : 'linkedin: no description' }
    }
    // Any other job page: liveness only.
    // Browser-style Accept: some job sites (Work at a Startup) answer 406 to a JSON-first one.
    const r = await get(link, 15000, 'text/html,application/xhtml+xml,*/*;q=0.8')
    // Only a real "gone" status counts as dead; 401/403/429/5xx usually mean bot blocking.
    if (r.status === 404 || r.status === 410) return none(null, false)
    if (r.status >= 400) return none(`page ${r.status}`)
    const final = new URL(r.url)
    const text = (await r.text()).slice(0, 200_000)
    if (CLOSED.test(text)) return none(null, false)
    if (final.pathname.replace(/\/+$/, '') === '' || /^\/(careers|jobs)\/?$/i.test(final.pathname)) return none(null, false)
    return none(null, true)
  } catch (err) {
    return none(err instanceof Error ? err.message.slice(0, 120) : 'fetch failed')
  }
}
