-- GTM-22 (CSV hookup): people exported to the sender's CSV are marked
-- "exported" with the date, and left out of later exports by default.
alter table public.people drop constraint if exists people_outreach_status_check;
alter table public.people add constraint people_outreach_status_check
  check (outreach_status in ('none', 'drafted', 'approved', 'exported', 'sent', 'replied', 'skip'));
alter table public.people add column if not exists exported_at timestamptz;

create or replace function public.people_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.outreach_status is distinct from old.outreach_status and new.outreach_status in ('sent', 'replied') then
    new.last_contacted_at := coalesce(new.last_contacted_at, now());
  end if;
  if new.outreach_status is distinct from old.outreach_status and new.outreach_status = 'exported' then
    new.exported_at := coalesce(new.exported_at, now());
  end if;
  return new;
end $$;
