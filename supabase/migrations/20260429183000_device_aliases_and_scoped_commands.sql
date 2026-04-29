create table if not exists public.device_aliases (
  user_id uuid not null references public.admin_profiles(user_id) on delete cascade,
  device_id text not null references public.devices(device_id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, device_id),
  constraint device_aliases_alias_length check (char_length(trim(alias)) between 1 and 80)
);

alter table public.device_aliases enable row level security;

drop policy if exists "device_aliases_self_select" on public.device_aliases;
create policy "device_aliases_self_select" on public.device_aliases
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "device_aliases_self_insert" on public.device_aliases;
create policy "device_aliases_self_insert" on public.device_aliases
  for insert to authenticated
  with check (auth.uid() = user_id and public.can_access_device(device_id));

drop policy if exists "device_aliases_self_update" on public.device_aliases;
create policy "device_aliases_self_update" on public.device_aliases
  for update to authenticated
  using (auth.uid() = user_id and public.can_access_device(device_id))
  with check (auth.uid() = user_id and public.can_access_device(device_id));

drop policy if exists "device_aliases_self_delete" on public.device_aliases;
create policy "device_aliases_self_delete" on public.device_aliases
  for delete to authenticated
  using (auth.uid() = user_id);
