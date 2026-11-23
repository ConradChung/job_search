-- Weekly Tuesday run (cron): sync, live check, classify, find people, draft,
-- Telegram summary. One row per run; the run resumes across function calls
-- from `stage`, and stops paid steps at `cap_usd`. RLS on, service role only.
create table if not exists public.weekly_runs (
  id          bigint generated always as identity primary key,
  trigger     text not null default 'cron' check (trigger in ('cron', 'manual')),
  stage       text not null default 'sync' check (stage in ('sync', 'enrich', 'classify', 'people', 'drafts', 'notify', 'done', 'failed')),
  cap_usd     numeric(10, 4) not null,
  spent_usd   numeric(10, 4) not null default 0,
  hops        integer not null default 0,
  summary     jsonb not null default '{}'::jsonb,
  error       text,
  started_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists weekly_runs_started_idx on public.weekly_runs (started_at desc);
alter table public.weekly_runs enable row level security;
