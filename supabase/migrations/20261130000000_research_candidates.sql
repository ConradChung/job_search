-- Role-relevant hook research (owner, 2026-11-23, v2): top three candidates per
-- company, the owner's pick, and an owner-pasted link ("use this link").
alter table company_research
  add column if not exists hook_candidates jsonb not null default '[]'::jsonb,
  add column if not exists chosen_index int,
  add column if not exists custom_url text,
  add column if not exists hook_speaker text,
  add column if not exists hook_idea text,
  add column if not exists hook_role_clause text,
  add column if not exists hook_kind text,
  add column if not exists leaders jsonb,
  add column if not exists rejected jsonb;
