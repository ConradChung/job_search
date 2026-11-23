-- Company LinkedIn + job poster (often the founder) from the sheet, for the
-- company page link and as the first node of the people tree.
alter table public.jobs
  add column company_linkedin text,
  add column job_poster_name text,
  add column job_poster_title text,
  add column job_poster_url text;

update public.jobs set
  company_linkedin = nullif(trim(raw->>'companyLinkedinUrl'), ''),
  job_poster_name  = nullif(trim(raw->>'jobPosterName'), ''),
  job_poster_title = nullif(trim(raw->>'jobPosterTitle'), ''),
  job_poster_url   = nullif(trim(raw->>'jobPosterProfileUrl'), '');
