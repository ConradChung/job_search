'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, Link2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CompanyResearchView, HookCandidateView } from '@/lib/people/companies'
import { EXPERIENCE_BANK, isBankKey } from '@/lib/research/bank'
import { Input } from '@/components/ui/input'

const KIND_LABEL: Record<string, string> = {
  owner_link: 'your link',
  gtm_leader: 'GTM leader',
  launch: 'launch',
  customer_story: 'customer story',
  engineering: 'engineering',
}

/**
 * Researched hook on the company row (owner, 2026-11-23): up to three candidates
 * (link, speaker, date, the specific idea), pick one or none, paste your own link,
 * and tick "I've read this". Until ticked, recruiter and job-poster messages here
 * can't be approved or exported. Picking or pasting rewrites those messages.
 */
export function HookPanel({ companyKey, research: r }: { companyKey: string; research: CompanyResearchView }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [link, setLink] = useState(r.custom_url ?? '')
  const reviewed = !!r.hook_reviewed_at
  const fit = r.fit_items.filter(isBankKey).map((k) => EXPERIENCE_BANK[k].linkedin)
  const list = r.hook_candidates ?? []

  async function patch(body: Record<string, unknown>, what: string) {
    setBusy(what)
    const res = await fetch(`/api/companies/${encodeURIComponent(companyKey)}/research`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
    const out = await res?.json().catch(() => null)
    setBusy(null)
    if (!res?.ok) return toast.error(out?.error ?? 'Could not save.')
    if (what === 'link') toast.success('Your link is now the hook. Messages rewritten; read it and tick when ready.')
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line px-3 py-2 text-[12px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-fg">Hook for recruiter messages</span>
        {busy && busy !== 'link' && <Loader2 className="size-3.5 animate-spin text-fg-46" aria-hidden />}
      </div>

      {list.length ? (
        <ul className="flex flex-col gap-2" role="radiogroup" aria-label="Hook candidates">
          {list.map((c, i) => (
            <Candidate key={c.url} c={c} chosen={r.chosen_index === i} disabled={!!busy} onPick={() => patch({ choose: i }, `pick${i}`)} />
          ))}
          <li>
            <label className="flex cursor-pointer items-center gap-2 text-fg-46">
              <input type="radio" name={`hook-${companyKey}`} checked={r.chosen_index === null} disabled={!!busy} onChange={() => patch({ choose: null }, 'none')} className="accent-[var(--primary)]" />
              No hook (messages go out without one)
            </label>
          </li>
        </ul>
      ) : (
        <div className="text-fg-46">No candidate: {r.why_no_hook ?? 'nothing specific found'}. Messages go out without a hook.</div>
      )}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (link.trim()) patch({ custom_url: link.trim() }, 'link')
        }}
      >
        <Link2 className="size-3.5 shrink-0 text-fg-46" aria-hidden />
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Use this link instead (podcast, interview, post)" className="h-7 px-2 text-[12px]" aria-label="Use this link" />
        <button type="submit" disabled={!!busy || !link.trim()} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-fg-70 hover:text-fg disabled:opacity-50" title="Reads the page and writes the hook from it (about $0.04)">
          {busy === 'link' && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Use this link
        </button>
      </form>

      {r.hook_sentence && (
        <label className="flex w-fit cursor-pointer items-center gap-1.5 text-fg">
          <input type="checkbox" checked={reviewed} disabled={!!busy} onChange={(e) => patch({ reviewed: e.target.checked }, 'tick')} className="accent-[var(--primary)]" />
          I&apos;ve read this
          {!reviewed && <span className="text-amber">· recruiter messages here can&apos;t be approved or exported until ticked</span>}
        </label>
      )}
      {fit.length > 0 && <div className="text-fg-46">Fit line: {fit.join(' · ')}</div>}
    </div>
  )
}

function Candidate({ c, chosen, disabled, onPick }: { c: HookCandidateView; chosen: boolean; disabled: boolean; onPick: () => void }) {
  return (
    <li className={chosen ? 'rounded-md bg-primary/5 px-2 py-1.5' : 'px-2 py-1.5'}>
      <label className="flex cursor-pointer gap-2">
        <input type="radio" checked={chosen} disabled={disabled} onChange={onPick} className="mt-0.5 accent-[var(--primary)]" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 text-fg">
            <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
              {c.title || c.url}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </span>
          <span className="text-fg-46">
            {[c.speaker && `${c.speaker}${c.speaker_title ? `, ${c.speaker_title}` : ''}`, c.date, KIND_LABEL[c.kind] ?? c.kind].filter(Boolean).join(' · ')}
          </span>
          <span className="text-fg-70">Idea: {c.idea}</span>
          <span className="text-fg-46">Quote: “{c.evidence}”</span>
          <span className="text-fg-70">Email: “{c.hook_sentence}”</span>
          <span className="text-fg-70">LinkedIn: “{c.hook_short}, …”</span>
        </span>
      </label>
    </li>
  )
}
