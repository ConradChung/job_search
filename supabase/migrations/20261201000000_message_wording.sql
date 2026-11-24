-- Writing rules v3 (owner, 2026-11-23): written sentences per company, not templates.
-- li_hook / li_link / li_item / email_hook come from the chosen candidate (each
-- candidate in hook_candidates carries its own); li_nohook and email_fit are per company.
alter table company_research
  add column if not exists li_hook text,
  add column if not exists li_link text,
  add column if not exists li_item text,
  add column if not exists email_hook text,
  add column if not exists li_nohook text,
  add column if not exists li_nohook_item text,
  add column if not exists email_fit text,
  add column if not exists wording_problems jsonb,
  add column if not exists written_at timestamptz;
