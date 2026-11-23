-- People tree: who to reach out to at each company (docs/specs/people-tree.md).

alter table public.jobs add column company_employees integer;
update public.jobs set company_employees = nullif(regexp_replace(coalesce(raw->>'companyEmployeesCount', ''), '[^0-9.]', '', 'g'), '')::numeric::integer;

create table public.people (
  id                bigint generated always as identity primary key,
  company_key       text not null,
  company           text not null,
  full_name         text not null,
  title             text,
  headline          text,
  location          text,
  linkedin_url      text not null,
  linkedin_key      text not null,
  branch            text not null check (branch in ('alumni', 'recruiting', 'gtm_leadership', 'executive', 'poster', 'other')),
  level             smallint,          -- target level within the size band's rules (1 = first choice)
  size_band         text check (size_band in ('small', 'medium', 'large')),
  is_ucla           boolean not null default false,
  rank              smallint,          -- order within the branch (1 = reach out first)
  source            text not null check (source in ('sheet_poster', 'exa', 'clay', 'apollo', 'manual')),
  confidence        text check (confidence in ('high', 'medium', 'low')),
  outreach_status   text not null default 'none' check (outreach_status in ('none', 'drafted', 'approved', 'sent', 'replied', 'skip')),
  last_contacted_at timestamptz,
  notes             text,
  raw               jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_key, linkedin_key)
);
create index people_company_idx on public.people (company_key);

create table public.people_runs (
  id            bigint generated always as identity primary key,
  source        text not null,
  company_key   text not null,
  searches      integer not null default 0,
  people_found  integer not null default 0,
  people_saved  integer not null default 0,
  cost_usd      numeric(10, 4) not null default 0,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index people_runs_company_idx on public.people_runs (company_key);

create or replace function public.people_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.outreach_status is distinct from old.outreach_status and new.outreach_status in ('sent', 'replied') then
    new.last_contacted_at := coalesce(new.last_contacted_at, now());
  end if;
  return new;
end $$;
create trigger people_touch before update on public.people for each row execute function public.people_touch();

alter table public.people enable row level security;
alter table public.people_runs enable row level security;

-- Seed: job posters already in the sheet.
insert into public.people (company_key, company, full_name, title, linkedin_url, linkedin_key, branch, source, confidence, rank)
select distinct on (j.company_key, lower(regexp_replace(j.job_poster_url, '^https?://([a-z]+\.)?linkedin\.com/in/([^/?#]+).*$', '\2')))
  j.company_key, j.company, j.job_poster_name, j.job_poster_title, j.job_poster_url,
  lower(regexp_replace(j.job_poster_url, '^https?://([a-z]+\.)?linkedin\.com/in/([^/?#]+).*$', '\2')),
  'poster', 'sheet_poster', 'high', 1
from public.jobs j
where j.job_poster_url ilike '%linkedin.com/in/%' and coalesce(trim(j.job_poster_name), '') <> ''
on conflict (company_key, linkedin_key) do nothing;
