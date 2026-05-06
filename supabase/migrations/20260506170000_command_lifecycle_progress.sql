alter table public.commands
  add column if not exists progress_percent integer not null default 0,
  add column if not exists phase text,
  add column if not exists message text,
  add column if not exists error text,
  add column if not exists started_at timestamptz,
  add column if not exists updated_at timestamptz not null default timezone('utc', now()),
  add column if not exists completed_at timestamptz,
  add column if not exists claimed_by text,
  add column if not exists claimed_pid integer;

do $$
declare
  constraint_name text;
begin
  select conname
  into constraint_name
  from pg_constraint
  where conrelid = 'public.commands'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.commands drop constraint %I', constraint_name);
  end if;
end
$$;

alter table public.commands
  add constraint commands_status_check
  check (status in ('pending', 'running', 'done', 'failed'));

alter table public.agent_logs
  add column if not exists command_id bigint references public.commands(id) on delete set null;

create index if not exists idx_commands_device_recent
  on public.commands(device_id, created_at desc);

create index if not exists idx_commands_device_active
  on public.commands(device_id, status, created_at desc)
  where status in ('pending', 'running');

create index if not exists idx_agent_logs_command_created_at
  on public.agent_logs(command_id, created_at desc);
