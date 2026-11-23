/** One result from Exa's `category: "people"` search. */
export interface ExaResult {
  url: string
  title?: string | null
  text?: string | null
}

export interface Profile {
  full_name: string
  headline: string | null
  location: string | null
  linkedin_url: string
  linkedin_key: string
  /** Roles marked "(Current)" in the profile's Experience section. */
  current: { title: string; company: string | null }[]
  is_ucla: boolean
}

/** `/in/<slug>` → lowercase decoded slug; null if not a LinkedIn profile URL. */
export function linkedinKey(url: string): string | null {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i)
  if (!m) return null
  try {
    return decodeURIComponent(m[1]).toLowerCase()
  } catch {
    return m[1].toLowerCase()
  }
}

export function canonicalLinkedin(key: string): string {
  return `https://www.linkedin.com/in/${encodeURIComponent(key)}`
}

const UCLA = /\bUCLA\b|University of California,?\s+Los Angeles/i

/**
 * Exa's profile text is markdown: "# Name", the headline on the next line,
 * then location, then "## About / ## Experience / ## Education" sections.
 * Current roles are either "### Title - [Company](url) (Current)" or a
 * "### [Company](url)" group followed by "#### Title (Current)".
 */
export function parseProfile(r: ExaResult): Profile | null {
  const key = linkedinKey(r.url)
  if (!key) return null
  const text = r.text ?? ''
  const lines = text.split('\n').map((l) => l.trim())

  const nameIdx = lines.findIndex((l) => l.startsWith('# '))
  const full_name = (nameIdx >= 0 ? lines[nameIdx].slice(2) : r.title ?? '').trim() || (r.title ?? '').trim()
  if (!full_name) return null

  const after = lines.slice(nameIdx + 1).filter((l) => l && !l.startsWith('#'))
  const headline = after[0] ?? null
  const location = after[1] && !/connections|followers/i.test(after[1]) ? after[1] : null

  const current: Profile['current'] = []
  let groupCompany: string | null = null
  for (const l of lines) {
    const group = l.match(/^###\s+\[([^\]]+)\]\(/)
    if (group) {
      groupCompany = group[1].trim()
      continue
    }
    if (!/\(Current\)\s*$/.test(l)) continue
    const inline = l.match(/^#{3,4}\s+(.+?)\s+-\s+\[([^\]]+)\]\([^)]*\)\s*\(Current\)\s*$/)
    if (inline) {
      current.push({ title: inline[1].trim(), company: inline[2].trim() })
      continue
    }
    const sub = l.match(/^#{3,4}\s+(.+?)\s*\(Current\)\s*$/)
    if (sub) current.push({ title: sub[1].trim(), company: groupCompany })
  }

  return {
    full_name,
    headline,
    location,
    linkedin_url: canonicalLinkedin(key),
    linkedin_key: key,
    current,
    is_ucla: UCLA.test(text) || UCLA.test(headline ?? ''),
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|llc|ltd|corp|co|gmbh|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface CompanyMatch {
  /** Title to classify: the current role at this company, else the headline's role part. */
  title: string
  confidence: 'high' | 'medium'
}

/**
 * Is this person at the company now? High confidence when a "(Current)" role
 * names the company; medium when only the headline says "@ Company" /
 * "at Company". Null when neither.
 */
export function matchCompany(p: Profile, company: string, domain?: string | null): CompanyMatch | null {
  const target = norm(company)
  const domainRoot = domain ? norm(domain.replace(/^www\./, '').split('.')[0]) : null
  if (!target) return null

  for (const role of p.current) {
    const c = role.company ? norm(role.company) : ''
    // Exact name (normalized, spacing ignored) or the domain's root. No prefix
    // matching: "Engine" must not match "Engine Room".
    const compact = c.replace(/ /g, '')
    if (c && (compact === target.replace(/ /g, '') || (domainRoot && compact === domainRoot.replace(/ /g, '')))) {
      return { title: role.title, confidence: 'high' }
    }
  }

  const h = p.headline ?? ''
  // The company name must end the headline segment: "@ Engine" matches, "@ Engine Room" doesn't.
  const re = new RegExp(`(?:@|\\bat)\\s*${escape(company.trim())}\\s*(?=$|[|,·•()/\\-–—])`, 'i')
  if (re.test(h)) {
    const rolePart = h.split(/\s+(?:@|at)\s+/i)[0]?.split('|')[0]?.trim() || h
    return { title: rolePart, confidence: 'medium' }
  }
  return null
}
