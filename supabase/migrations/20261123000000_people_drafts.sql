-- GTM-21 drafts: one LinkedIn connection note per person, reviewed in the dashboard.
alter table public.people
  add column draft text,
  add column draft_generated_at timestamptz,
  add column draft_model text,
  add column draft_cost_usd numeric(10, 5);
