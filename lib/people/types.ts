import type { Branch } from './targets'

export const OUTREACH = [
  { value: 'none', label: 'Not contacted', tone: 'idle' },
  { value: 'drafted', label: 'Drafted', tone: 'run' },
  { value: 'approved', label: 'Approved', tone: 'wait' },
  { value: 'sent', label: 'Sent', tone: 'run' },
  { value: 'replied', label: 'Replied', tone: 'ok' },
  { value: 'skip', label: 'Skip', tone: 'bad' },
] as const

export const OUTREACH_VALUES: readonly string[] = OUTREACH.map((o) => o.value)

export interface PersonRow {
  id: number
  company_key: string
  full_name: string
  title: string | null
  linkedin_url: string
  branch: Branch
  level: number | null
  is_ucla: boolean
  in_blockchain_ucla: boolean
  rank: number | null
  source: string
  confidence: 'high' | 'medium' | 'low' | null
  outreach_status: string
  last_contacted_at: string | null
  notes: string | null
  draft: string | null
  followup: string | null
  draft_generated_at: string | null
  draft_cost_usd: number | null
}

export const PERSON_COLUMNS =
  'id, company_key, full_name, title, linkedin_url, branch, level, is_ucla, in_blockchain_ucla, rank, source, confidence, outreach_status, last_contacted_at, notes, draft, followup, draft_generated_at, draft_cost_usd'
