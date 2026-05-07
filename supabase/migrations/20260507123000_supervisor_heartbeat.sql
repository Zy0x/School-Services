alter table public.devices
  add column if not exists supervisor_last_seen timestamptz,
  add column if not exists supervisor_pid integer,
  add column if not exists supervisor_desired_agent_state text;

create index if not exists idx_devices_supervisor_last_seen
  on public.devices(supervisor_last_seen desc);
