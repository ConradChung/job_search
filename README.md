# job hunt

Tracker for the job search, on Lume's stack (Next.js 15, React 19, Tailwind 4,
shadcn base-nova, Supabase). Neon-orange take on Lume's dark glass UI.

- **Data:** Supabase project `job-hunt` (`lcfodkgpriuefdentltq`), table `jobs`
  (`supabase/migrations/`). RLS on, no policies; the server uses the service
  role after the single-owner check in `middleware.ts`.
- **Source:** the "Jobs Final" tab of the job-search sheet, read through its
  public CSV export (`SHEET_CSV_URL`). No Google service account. The sheet is
  only ever read.
- **Sync:** `npm run sync` or the "Sync from sheet" button. New rows are
  inserted; existing rows (same company + normalized link) only get sheet
  details refreshed. Status, notes and liveness set here are never overwritten.
- **Statuses:** new → reached out → applied → interviewing → offer, plus
  rejected / not a fit (`lib/jobs/statuses.ts`).
- **Liveness:** `liveness` (unchecked / live / dead) is reserved for the
  GTM-20 live-job filter.

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev                  # http://localhost:3000
npm test && npm run typecheck && npm run lint
```

Sign-in is a magic link to `ALLOWED_EMAIL`. For a deployed URL, add
`<url>/auth/callback` to Supabase Auth → URL configuration and set `APP_URL`.
