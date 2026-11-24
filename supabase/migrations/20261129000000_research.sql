-- Researched after-accept messages (owner, 2026-11-23).
-- One research record per company (shared by everyone there): a dated, sourced
-- hook and the three experience-bank items that best match the primary role.
create table if not exists company_research (
  company_key text primary key,
  role_id bigint,
  hook_source_url text,
  hook_title text,
  hook_date date,
  hook_summary text,
  hook_sentence text,
  hook_short text,
  fit_items text[] not null default '{}',
  -- Owner tick: messages using the hook cannot be approved or exported until set.
  hook_reviewed_at timestamptz,
  why_no_hook text,
  candidates jsonb,
  model text,
  cost_usd numeric(10, 5) not null default 0,
  researched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table company_research enable row level security;

-- Work email (Blitz) and the email version of the after-accept message.
alter table people
  add column if not exists email text,
  add column if not exists email_status text check (email_status in ('found', 'not_found', 'error')),
  add column if not exists email_checked_at timestamptz,
  add column if not exists email_subject text,
  add column if not exists email_body text;
