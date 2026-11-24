-- Owner hold on a company (e.g. an excluded industry found by hand): held out
-- of drafting and export, notes untouched. A manual hold, not a fit rule.
alter table public.company_settings add column if not exists hold_reason text;
comment on column public.company_settings.hold_reason is 'Owner hold (e.g. excluded industry): company is held out of drafting and export; notes stay untouched. Not a fit rule.';
