/** A jobs row as the dashboard reads it (no raw blob). */
export interface JobRow {
  id: number
  company: string
  title: string | null
  link: string
  section: 'main' | 'referrals'
  fit_tier: number | null
  status: string
  email_sent: string | null
  notes: string | null
  status_changed_at: string | null
  liveness: 'unchecked' | 'live' | 'dead'
  funding_stage: string | null
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
  board: string | null
}

export const JOB_COLUMNS =
  'id, company, title, link, section, fit_tier, status, email_sent, notes, status_changed_at, liveness, funding_stage, salary_text, salary_min, salary_max, location, posted_at, company_website, company_linkedin, job_poster_name, job_poster_title, job_poster_url, board'
