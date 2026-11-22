import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { JOB_COLUMNS, type JobRow } from '@/lib/jobs/types'
import { JobsScreen } from '@/components/jobs/JobsScreen'

export const metadata: Metadata = { title: 'Jobs' }
export const dynamic = 'force-dynamic'

/** The middleware has already passed the owner check for this route. */
async function loadJobs(): Promise<JobRow[]> {
  const db = createServiceClient()
  const out: JobRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('jobs')
      .select(JOB_COLUMNS)
      .order('fit_tier', { ascending: true, nullsFirst: false })
      .order('posted_at', { ascending: false, nullsFirst: false })
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`load jobs: ${error.message}`)
    out.push(...((data ?? []) as JobRow[]))
    if (!data || data.length < 1000) break
  }
  return out
}

export default async function JobsPage() {
  return <JobsScreen initial={await loadJobs()} />
}
