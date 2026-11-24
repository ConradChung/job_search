'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CompanyResearchView } from '@/lib/people/companies'
import { EXPERIENCE_BANK, isBankKey } from '@/lib/research/bank'

/**
 * The company's researched hook (owner, 2026-11-23): source link, date, the
 * sentence the messages use, and the "I've read this" tick. Until it's ticked,
 * recruiter and job-poster messages here can't be approved or exported.
 */
export function HookPanel({ companyKey, research: r }: { companyKey: string; research: CompanyResearchView }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const reviewed = !!r.hook_reviewed_at
  const fit = r.fit_items.filter(isBankKey).map((k) => EXPERIENCE_BANK[k].linkedin)

  async function setReviewed(v: boolean) {
    setBusy(true)
    const res = await fetch(`/api/companies/${encodeURIComponent(companyKey)}/research`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reviewed: v }),
    }).catch(() => null)
    setBusy(false)
    if (!res?.ok) return toast.error('Could not save the tick.')
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line px-3 py-2 text-[12px]">
      {r.hook_sentence ? (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-fg-70">Hook:</span>
            <a href={r.hook_source_url ?? '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fg underline-offset-2 hover:underline">
              {r.hook_title || r.hook_source_url}
              <ExternalLink className="size-3" aria-hidden />
            </a>
            {r.hook_date && <span className="text-fg-46">{r.hook_date}</span>}
          </div>
          {r.hook_summary && <div className="text-fg-46">{r.hook_summary}</div>}
          <div className="text-fg-70">Email: “{r.hook_sentence}”</div>
          <div className="text-fg-70">LinkedIn: “{r.hook_short}, …”</div>
          <label className="mt-1 flex w-fit cursor-pointer items-center gap-1.5 text-fg">
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="accent-[var(--primary)]" />}
            I&apos;ve read this
            {!reviewed && <span className="text-amber">· recruiter messages here can&apos;t be approved or exported until ticked</span>}
          </label>
        </>
      ) : (
        <div className="text-fg-46">No hook: {r.why_no_hook ?? 'nothing specific found'}. Messages go out without one.</div>
      )}
      {fit.length > 0 && <div className="text-fg-46">Fit line: {fit.join(' · ')}</div>}
    </div>
  )
}
