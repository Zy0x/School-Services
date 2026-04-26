create table if not exists public.agent_logs (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices(device_id) on delete cascade,
  service_name text,
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  details jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_agent_logs_device_created_at on public.agent_logs(device_id, created_at desc);

alter table public.agent_logs enable row level security;

drop policy if exists "open_select_agent_logs" on public.agent_logs;
create policy "open_select_agent_logs" on public.agent_logs
  for select using (true);

drop policy if exists "open_insert_agent_logs" on public.agent_logs;
create policy "open_insert_agent_logs" on public.agent_logs
  for insert with check (true);

alter table public.agent_logs replica identity full;

do $$
begin
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
