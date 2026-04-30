create table if not exists public.devices (
  device_id text primary key,
  device_name text not null,
  status text not null default 'active' check (status in ('active', 'blocked')),
  last_seen timestamptz not null default timezone('utc', now()),
  app_version text,
  release_tag text,
  build_commit text,
  built_at timestamptz,
  latest_release_tag text,
  latest_version text,
  update_available boolean not null default false,
  update_status text not null default 'unchecked',
  update_checked_at timestamptz,
  update_started_at timestamptz,
  update_error text,
  update_asset_name text
);

create table if not exists public.services (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices(device_id) on delete cascade,
  service_name text not null,
  port integer not null,
  status text not null default 'stopped',
  desired_state text not null default 'stopped' check (desired_state in ('running', 'stopped')),
  location_status text not null default 'unknown' check (location_status in ('ready', 'partial', 'missing', 'unknown')),
  resolved_path text,
  location_details jsonb,
  last_error text,
  public_url text,
  last_ping timestamptz not null default timezone('utc', now()),
  unique (device_id, service_name)
);

create table if not exists public.commands (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices(device_id) on delete cascade,
  service_name text,
  action text not null check (action in ('start', 'stop', 'kill', 'update')),
  status text not null default 'pending' check (status in ('pending', 'done')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.agent_logs (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices(device_id) on delete cascade,
  service_name text,
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  details jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_services_device_id on public.services(device_id);
create index if not exists idx_commands_device_status on public.commands(device_id, status);
create index if not exists idx_agent_logs_device_created_at on public.agent_logs(device_id, created_at desc);

alter table public.devices enable row level security;
alter table public.services enable row level security;
alter table public.commands enable row level security;
alter table public.agent_logs enable row level security;

drop policy if exists "open_select_devices" on public.devices;
create policy "open_select_devices" on public.devices
  for select using (true);

drop policy if exists "open_insert_devices" on public.devices;
create policy "open_insert_devices" on public.devices
  for insert with check (true);

drop policy if exists "open_update_devices" on public.devices;
create policy "open_update_devices" on public.devices
  for update using (true) with check (true);

drop policy if exists "open_select_services" on public.services;
create policy "open_select_services" on public.services
  for select using (true);

drop policy if exists "open_insert_services" on public.services;
create policy "open_insert_services" on public.services
  for insert with check (true);

drop policy if exists "open_update_services" on public.services;
create policy "open_update_services" on public.services
  for update using (true) with check (true);

drop policy if exists "open_select_commands" on public.commands;
create policy "open_select_commands" on public.commands
  for select using (true);

drop policy if exists "open_insert_commands" on public.commands;
create policy "open_insert_commands" on public.commands
  for insert with check (true);

drop policy if exists "open_update_commands" on public.commands;
create policy "open_update_commands" on public.commands
  for update using (true) with check (true);

drop policy if exists "open_select_agent_logs" on public.agent_logs;
create policy "open_select_agent_logs" on public.agent_logs
  for select using (true);

drop policy if exists "open_insert_agent_logs" on public.agent_logs;
create policy "open_insert_agent_logs" on public.agent_logs
  for insert with check (true);

alter table public.services replica identity full;
alter table public.devices replica identity full;
alter table public.agent_logs replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'services'
  ) then
    alter publication supabase_realtime add table public.services;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'devices'
  ) then
    alter publication supabase_realtime add table public.devices;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'agent_logs'
  ) then
    alter publication supabase_realtime add table public.agent_logs;
  end if;
end
$$;
