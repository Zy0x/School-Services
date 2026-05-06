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

notify pgrst, 'reload schema';
