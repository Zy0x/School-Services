alter table public.devices
  add column if not exists latest_release_tag text,
  add column if not exists latest_version text,
  add column if not exists update_available boolean not null default false,
  add column if not exists update_status text not null default 'unchecked',
  add column if not exists update_checked_at timestamptz,
  add column if not exists update_started_at timestamptz,
  add column if not exists update_error text,
  add column if not exists update_asset_name text;

do $$
declare
  constraint_name text;
begin
  select conname
  into constraint_name
  from pg_constraint
  where conrelid = 'public.commands'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%action%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.commands drop constraint %I', constraint_name);
  end if;
end
$$;

alter table public.commands
  add constraint commands_action_check
  check (action in ('start', 'stop', 'kill', 'update'));
