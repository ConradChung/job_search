-- Job hunt tracker: one row per job posting, imported from the "Jobs Final"
-- tab of the job-search sheet, then tracked here (the dashboard is the source
-- of truth for status; re-sync only adds rows and refreshes sheet facts).
--
-- Access: RLS on with no policies, so anon/authenticated keys see nothing.
-- The Next.js server reads and writes with the service role after the
-- single-owner check in middleware (same model as Lume).

create table public.jobs (
  id              bigint generated always as identity primary key,

  -- Dedupe: company + normalized link (see lib/jobs/normalize.ts).
  company         text not null,
  company_key     text not null,
  link            text not null,
  link_key        text not null,

  title           text,
  section         text not null default 'main' check (section in ('main', 'referrals')),
  fit_tier        smallint check (fit_tier between 1 and 5),

  -- Tracking (owned by the dashboard; a re-sync never overwrites these).
  status          text not null default 'new',
  email_sent      text,
  notes           text,
  status_changed_at timestamptz,

  -- GTM-20 live-job filter writes these.
  liveness        text not null default 'unchecked' check (liveness in ('unchecked', 'live', 'dead')),
  liveness_reason text,
  liveness_checked_at timestamptz,

  -- Sheet facts (refreshed on re-sync).
  funding_stage   text,
  total_funding   numeric,
  salary_text     text,
  salary_min      integer,
  salary_max      integer,
  location        text,
  posted_at       date,
  company_website text,
  company_size    text,
  industries      text,
  sources         text,
  board           text,          -- ashby | greenhouse | lever | linkedin | other
  raw             jsonb not null default '{}'::jsonb,  -- full sheet row, header -> value
  sheet_row       integer,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (company_key, link_key)
);

create index jobs_status_idx on public.jobs (status);
create index jobs_fit_tier_idx on public.jobs (fit_tier);
create index jobs_liveness_idx on public.jobs (liveness);

create or replace function public.jobs_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end $$;

create trigger jobs_touch before update on public.jobs
  for each row execute function public.jobs_touch();

alter table public.jobs enable row level security;
