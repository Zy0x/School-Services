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
  update_asset_name text,
  tunnel_preferred_provider text not null default 'cloudflare',
  tunnel_provider_order text[] not null default array['cloudflare', 'ngrok'],
  tunnel_ngrok_configured boolean not null default false,
  tunnel_settings_updated_at timestamptz
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
  tunnel_provider text,
  tunnel_state text,
  last_public_url text,
  tunnel_last_error text,
  last_ping timestamptz not null default timezone('utc', now()),
  unique (device_id, service_name)
);

create table if not exists public.commands (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices(device_id) on delete cascade,
  service_name text,
  action text not null check (action in ('start', 'stop', 'kill', 'update', 'agent_start', 'agent_stop', 'agent_restart', 'configure_tunnel')),
  payload jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  progress_percent integer not null default 0,
  phase text,
  message text,
  error text,
  started_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  claimed_by text,
  claimed_pid integer,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.agent_logs (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices(device_id) on delete cascade,
  service_name text,
  command_id bigint references public.commands(id) on delete set null,
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  details jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.device_tunnel_secrets (
  device_id text not null references public.devices(device_id) on delete cascade,
  user_id uuid not null,
  provider text not null check (provider in ('ngrok')),
  secret_value text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (device_id, user_id, provider)
);

create index if not exists idx_services_device_id on public.services(device_id);
create index if not exists idx_commands_device_status on public.commands(device_id, status);
create index if not exists idx_commands_device_recent on public.commands(device_id, created_at desc);
create index if not exists idx_commands_device_active on public.commands(device_id, status, created_at desc) where status in ('pending', 'running');
create index if not exists idx_agent_logs_device_created_at on public.agent_logs(device_id, created_at desc);
create index if not exists idx_agent_logs_command_created_at on public.agent_logs(command_id, created_at desc);
create index if not exists idx_device_tunnel_secrets_user_device on public.device_tunnel_secrets(user_id, device_id);

alter table public.devices enable row level security;
alter table public.services enable row level security;
alter table public.commands enable row level security;
alter table public.agent_logs enable row level security;
alter table public.device_tunnel_secrets enable row level security;

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
drop policy if exists "commands_no_client_select" on public.commands;
create policy "commands_no_client_select" on public.commands
  for select using (false);

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

drop policy if exists "device_tunnel_secrets_no_client_select" on public.device_tunnel_secrets;
create policy "device_tunnel_secrets_no_client_select" on public.device_tunnel_secrets
  for select using (false);

drop policy if exists "device_tunnel_secrets_no_client_insert" on public.device_tunnel_secrets;
create policy "device_tunnel_secrets_no_client_insert" on public.device_tunnel_secrets
  for insert with check (false);

drop policy if exists "device_tunnel_secrets_no_client_update" on public.device_tunnel_secrets;
create policy "device_tunnel_secrets_no_client_update" on public.device_tunnel_secrets
  for update using (false) with check (false);

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
