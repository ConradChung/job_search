import type { SupabaseClient } from '@supabase/supabase-js'
import { classificationRow, classifyJob, type ClassifyClient } from './classify'
import { guessFromTitle } from './titleGuess'
import { finalCategory } from './categories'

export interface UnclassifiedJob {
  id: number
  company: string
  title: string | null
  location: string | null
  department: string | null
  description: string | null
  raw: unknown
  liveness: string | null
}

export const UNCLASSIFIED_COLUMNS = 'id, company, title, location, department, description, raw, liveness'

/** Closed postings with no text get a free title guess (low confidence), no Claude call. */
export const needsClaude = (j: Pick<UnclassifiedJob, 'liveness' | 'description'>) => !(j.liveness === 'dead' && (j.description ?? '').length < 400)

/** Rough cost before the call: a posting with text vs. title only (measured). */
export const estimateClassify = (j: Pick<UnclassifiedJob, 'liveness' | 'description'>) => (!needsClaude(j) ? 0 : (j.description ?? '').length >= 400 ? 0.018 : 0.006)

/** Classify and store one job. Returns the Claude cost (0 for a title guess). Shared by the script and the weekly run. */
export async function classifyOne(db: SupabaseClient, client: ClassifyClient, j: UnclassifiedJob): Promise<{ cost: number; category: string }> {
  if (!needsClaude(j)) {
    const g = guessFromTitle(j.title)
    const category = finalCategory(g.category, j.title)
    await db
      .from('jobs')
      .update({
        category,
        category_confidence: 'low',
        seniority: g.seniority,
        work_mode: 'unknown',
        start_requirement: 'unknown',
        classification: { reason: 'Title guess: posting closed, no description to read.', method: 'title_guess' },
        classified_at: new Date().toISOString(),
      })
      .eq('id', j.id)
    return { cost: 0, category }
  }
  const raw = (j.raw ?? {}) as Record<string, string>
  const r = await classifyJob(client, {
    title: j.title,
    company: j.company,
    industries: raw.industries ?? null,
    location: j.location,
    sheetSeniority: raw.seniorityLevel ?? null,
    department: j.department,
    description: j.description,
  })
  const row = classificationRow(r, j)
  await db.from('jobs').update(row).eq('id', j.id)
  return { cost: r.cost, category: String(row.category) }
}
