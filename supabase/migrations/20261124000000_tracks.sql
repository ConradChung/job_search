-- Tracks: Sales split into SDR/BDR, AE, account management, customer success.
-- `sales` stays allowed for sales roles that are none of those.
alter table public.jobs drop constraint jobs_category_check;
alter table public.jobs add constraint jobs_category_check check (category in (
  'gtm_eng', 'sdr', 'revops', 'growth_eng_product', 'ae', 'account_management', 'customer_success',
  'sales', 'partnerships_bd', 'marketing', 'engineering', 'other'));

-- SDR roles asking for 2+ years of closing experience block (set from the posting text).
alter table public.jobs add column closing_required boolean;
