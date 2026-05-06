alter table public.commands
  add column if not exists payload jsonb;

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
  check (action in (
    'start',
    'stop',
    'kill',
    'update',
    'agent_start',
    'agent_stop',
    'agent_restart',
    'configure_tunnel'
  ));

alter table public.devices
  add column if not exists tunnel_preferred_provider text not null default 'cloudflare',
  add column if not exists tunnel_provider_order text[] not null default array['cloudflare', 'ngrok'],
  add column if not exists tunnel_ngrok_configured boolean not null default false,
  add column if not exists tunnel_settings_updated_at timestamptz;

alter table public.services
  add column if not exists tunnel_provider text;

create table if not exists public.device_tunnel_secrets (
  device_id text not null references public.devices(device_id) on delete cascade,
  user_id uuid not null,
  provider text not null check (provider in ('ngrok')),
  secret_value text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (device_id, user_id, provider)
);

create index if not exists idx_device_tunnel_secrets_user_device
  on public.device_tunnel_secrets(user_id, device_id);

alter table public.device_tunnel_secrets enable row level security;

drop policy if exists "device_tunnel_secrets_no_client_select" on public.device_tunnel_secrets;
create policy "device_tunnel_secrets_no_client_select" on public.device_tunnel_secrets
  for select using (false);

drop policy if exists "device_tunnel_secrets_no_client_insert" on public.device_tunnel_secrets;
create policy "device_tunnel_secrets_no_client_insert" on public.device_tunnel_secrets
  for insert with check (false);

drop policy if exists "device_tunnel_secrets_no_client_update" on public.device_tunnel_secrets;
create policy "device_tunnel_secrets_no_client_update" on public.device_tunnel_secrets
  for update using (false) with check (false);
