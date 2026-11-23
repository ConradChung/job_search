-- Job hunt MCP server (same framework as Lume's): audit + rate limits,
-- idempotency for write tools, and pending actions that request tools file
-- for the owner to confirm in the app. RLS on, no policies: service role only.

create table if not exists public.mcp_audit (
  id         bigint generated always as identity primary key,
  tool       text not null,
  class      text not null check (class in ('read', 'write', 'request')),
  outcome    text not null check (outcome in ('ok', 'error', 'rate_limited')),
  ms         integer not null default 0,
  args       jsonb not null default '{}'::jsonb,
  error      text,
  refs       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists mcp_audit_class_time_idx on public.mcp_audit (class, created_at desc);

create table if not exists public.mcp_idempotency (
  key        text primary key,
  tool       text not null,
  args_hash  text not null,
  result     jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pending_actions (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('find_people', 'draft_notes', 'export_csv')),
  params       jsonb not null default '{}'::jsonb,
  preview      jsonb not null default '{}'::jsonb,
  summary      text not null,
  est_cost_usd numeric(10, 4) not null default 0,
  status       text not null default 'awaiting' check (status in ('awaiting', 'running', 'done', 'rejected', 'failed', 'expired')),
  requested_by text not null default 'mcp',
  result       jsonb,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create index if not exists pending_actions_status_idx on public.pending_actions (status, created_at desc);

alter table public.mcp_audit enable row level security;
alter table public.mcp_idempotency enable row level security;
alter table public.pending_actions enable row level security;

-- "No reply" for people the sender reached who never answered.
alter table public.people drop constraint if exists people_outreach_status_check;
alter table public.people add constraint people_outreach_status_check
  check (outreach_status in ('none', 'drafted', 'approved', 'exported', 'sent', 'replied', 'no_reply', 'skip'));
