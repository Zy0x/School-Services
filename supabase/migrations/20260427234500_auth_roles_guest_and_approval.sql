alter table public.admin_profiles
  drop constraint if exists admin_profiles_role_check;

alter table public.admin_profiles
  add column if not exists display_name text,
  add column if not exists status text not null default 'approved',
  add column if not exists approval_due_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid,
  add column if not exists rejection_reason text,
  add column if not exists device_scope jsonb not null default '[]'::jsonb;

alter table public.admin_profiles
  add constraint admin_profiles_role_check
  check (role in ('super_admin', 'operator', 'user'));

alter table public.admin_profiles
  drop constraint if exists admin_profiles_status_check;

alter table public.admin_profiles
  add constraint admin_profiles_status_check
  check (status in ('pending', 'approved', 'rejected', 'disabled'));

update public.admin_profiles
set status = 'approved',
    approved_at = coalesce(approved_at, created_at),
    approval_due_at = null,
    updated_at = timezone('utc', now())
where role = 'super_admin';

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.app_settings (key, value)
values (
  'auth_policy',
  jsonb_build_object(
    'autoApproveEnabled', true,
    'approvalWindowHours', 24,
    'maintenanceIntervalMinutes', 15,
    'passwordResetRedirectUrl', 'https://school-services.netlify.app/reset-password'
  )
)
on conflict (key) do nothing;

create table if not exists public.guest_shortcuts (
  device_id text primary key references public.devices(device_id) on delete cascade,
  guest_path text not null,
  guest_url text not null,
  service_name text not null default 'rapor' check (service_name in ('rapor')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_admin_profiles_role_status
  on public.admin_profiles(role, status);

alter table public.app_settings enable row level security;
alter table public.guest_shortcuts enable row level security;

drop policy if exists "admin_profiles_super_admin_select" on public.admin_profiles;
create policy "admin_profiles_super_admin_select" on public.admin_profiles
  for select to authenticated
  using (
    exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
        and profile.status = 'approved'
    )
  );

drop policy if exists "admin_profiles_super_admin_update" on public.admin_profiles;
create policy "admin_profiles_super_admin_update" on public.admin_profiles
  for update to authenticated
  using (
    exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
        and profile.status = 'approved'
    )
  )
  with check (
    exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
        and profile.status = 'approved'
    )
  );

drop policy if exists "admin_profiles_self_insert" on public.admin_profiles;
create policy "admin_profiles_self_insert" on public.admin_profiles
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and role in ('operator', 'user')
    and status = 'pending'
  );

drop policy if exists "app_settings_super_admin_select" on public.app_settings;
create policy "app_settings_super_admin_select" on public.app_settings
  for select to authenticated
  using (
    exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
        and profile.status = 'approved'
    )
  );

drop policy if exists "app_settings_super_admin_update" on public.app_settings;
create policy "app_settings_super_admin_update" on public.app_settings
  for update to authenticated
  using (
    exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
        and profile.status = 'approved'
    )
  )
  with check (
    exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
        and profile.status = 'approved'
    )
  );

drop policy if exists "guest_shortcuts_super_admin_select" on public.guest_shortcuts;
create policy "guest_shortcuts_super_admin_select" on public.guest_shortcuts
  for select to authenticated
  using (
    exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
        and profile.status = 'approved'
    )
  );

drop policy if exists "guest_shortcuts_open_select" on public.guest_shortcuts;
create policy "guest_shortcuts_open_select" on public.guest_shortcuts
  for select using (true);

drop policy if exists "guest_shortcuts_open_insert" on public.guest_shortcuts;
create policy "guest_shortcuts_open_insert" on public.guest_shortcuts
  for insert with check (true);

drop policy if exists "guest_shortcuts_open_update" on public.guest_shortcuts;
create policy "guest_shortcuts_open_update" on public.guest_shortcuts
  for update using (true) with check (true);

create or replace function public.process_account_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg jsonb;
  auto_approve boolean := true;
  approved_count integer := 0;
begin
  select value into cfg
  from public.app_settings
  where key = 'auth_policy';

  auto_approve := coalesce((cfg ->> 'autoApproveEnabled')::boolean, true);

  if auto_approve then
    update public.admin_profiles
    set status = 'approved',
        approved_at = coalesce(approved_at, timezone('utc', now())),
        approval_due_at = null,
        updated_at = timezone('utc', now())
    where role in ('operator', 'user')
      and status = 'pending'
      and approval_due_at is not null
      and approval_due_at <= timezone('utc', now());

    GET DIAGNOSTICS approved_count = ROW_COUNT;
  end if;

  return jsonb_build_object(
    'autoApproveEnabled', auto_approve,
    'approvedCount', approved_count,
    'processedAt', timezone('utc', now())
  );
end;
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('school-services-account-maintenance');
    exception
      when others then
        null;
    end;

    perform cron.schedule(
      'school-services-account-maintenance',
      '*/15 * * * *',
      $job$select public.process_account_maintenance();$job$
    );
  end if;
end
$$;
