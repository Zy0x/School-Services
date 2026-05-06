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
