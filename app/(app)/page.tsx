import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { loadCompanies } from '@/lib/pipeline/load'
import { loadPendingActions } from '@/lib/actions/pending'
import { PipelineScreen } from '@/components/pipeline/PipelineScreen'

export const metadata: Metadata = { title: 'Pipeline' }
export const dynamic = 'force-dynamic'

/** The one page (Jobs + Companies merged). The middleware has already passed the owner check. */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const db = createServiceClient()
  const [companies, actions] = await Promise.all([loadCompanies(db), loadPendingActions(db)])
  const { open } = await searchParams
  return <PipelineScreen initial={companies} openKey={open ?? null} actions={actions} />
}
