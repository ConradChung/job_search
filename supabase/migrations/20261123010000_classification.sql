-- Role classification from the real posting, fit flags, Blockchain @ UCLA contacts.

alter table public.jobs
  add column description text,
  add column description_source text check (description_source in ('apify', 'ashby', 'greenhouse', 'lever', 'linkedin', 'sheet')),
  add column department text,
  add column category text check (category in ('gtm_eng', 'growth_eng_product', 'sales', 'revops', 'partnerships_bd', 'marketing', 'engineering', 'other')),
  add column category_confidence text check (category_confidence in ('high', 'medium', 'low')),
  add column seniority text check (seniority in ('intern', 'entry', 'mid', 'senior', 'director_plus', 'unknown')),
  add column work_mode text check (work_mode in ('remote', 'hybrid', 'onsite', 'unknown')),
  add column work_locations text[],
  add column start_requirement text check (start_requirement in ('immediate', 'flexible', 'specific_date', 'unknown')),
  add column start_date date,
  add column crypto_or_fintech boolean,
  add column classification jsonb,
  add column classified_at timestamptz,
  add column fetched_at timestamptz,
  add column fetch_error text;

-- Per-company owner decisions (e.g. draft even though fit flags fail).
create table public.company_settings (
  company_key  text primary key,
  fit_override boolean not null default false,
  updated_at   timestamptz not null default now()
);
alter table public.company_settings enable row level security;

alter table public.people
  add column profile_text text,
  add column in_blockchain_ucla boolean not null default false;

alter table public.people drop constraint people_branch_check;
alter table public.people add constraint people_branch_check
  check (branch in ('blockchain_ucla', 'alumni', 'recruiting', 'gtm_leadership', 'executive', 'poster', 'other'));

alter table public.people_runs add column rule text;
