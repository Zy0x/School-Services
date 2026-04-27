alter table public.services
  add column if not exists location_status text not null default 'unknown';

alter table public.services
  add column if not exists resolved_path text;

alter table public.services
  add column if not exists location_details jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'services_location_status_check'
  ) then
    alter table public.services
      add constraint services_location_status_check
      check (location_status in ('ready', 'partial', 'missing', 'unknown'));
  end if;
end
$$;

update public.services
set location_status = coalesce(nullif(location_status, ''), 'unknown')
where location_status is null
   or location_status = '';
