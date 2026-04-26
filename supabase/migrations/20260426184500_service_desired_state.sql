alter table public.services
  add column if not exists desired_state text not null default 'stopped';

alter table public.services
  add column if not exists last_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'services_desired_state_check'
  ) then
    alter table public.services
      add constraint services_desired_state_check
      check (desired_state in ('running', 'stopped'));
  end if;
end
$$;

update public.services
set desired_state = case
  when status = 'running' then 'running'
  else 'stopped'
end
where desired_state is null
   or desired_state not in ('running', 'stopped');
