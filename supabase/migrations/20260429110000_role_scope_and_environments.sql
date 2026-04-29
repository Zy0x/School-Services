-- 1. Create operator environments
create table if not exists public.operator_environments (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.admin_profiles(user_id) on delete cascade,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (operator_id) -- Asumsi: "Satu operator hanya punya satu environment aktif."
);

-- 2. Create environment invitations (including referral codes)
create table if not exists public.environment_invitations (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.operator_environments(id) on delete cascade,
  email text,
  referral_code text unique,
  created_by uuid not null references public.admin_profiles(user_id) on delete cascade,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  check (email is not null or referral_code is not null)
);

-- 3. Create environment memberships
create table if not exists public.environment_memberships (
  environment_id uuid not null references public.operator_environments(id) on delete cascade,
  user_id uuid not null references public.admin_profiles(user_id) on delete cascade,
  joined_at timestamptz not null default timezone('utc', now()),
  primary key (environment_id, user_id),
  unique (user_id) -- A user belongs to max 1 environment right now? Asumsi: Standalone or one environment.
);

-- 4. Create device assignments
create table if not exists public.device_assignments (
  device_id text not null references public.devices(device_id) on delete cascade,
  user_id uuid not null references public.admin_profiles(user_id) on delete cascade,
  assigned_by uuid references public.admin_profiles(user_id) on delete set null,
  assigned_at timestamptz not null default timezone('utc', now()),
  primary key (device_id, user_id)
);

-- 5. Extend admin_profiles
alter table public.admin_profiles
  add column if not exists registration_source text default 'direct',
  add column if not exists managed_by uuid references public.admin_profiles(user_id) on delete set null;

-- Update auth_policy defaults
update public.app_settings
set value = jsonb_build_object(
  'operatorAutoApproveHours', 24,
  'environmentUserAutoApproveHours', 8,
  'standaloneUserManualMode', true,
  'passwordResetRedirectUrl', 'https://school-services.netlify.app/reset-password',
  'autoApproveEnabled', coalesce((value->>'autoApproveEnabled')::boolean, true)
)
where key = 'auth_policy';

-- 6. Helper SQL Functions
create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles
    where user_id = auth.uid()
      and role = 'operator'
      and status = 'approved'
  );
$$;

create or replace function public.is_operator_for_environment(env_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.operator_environments
    where id = env_id
      and operator_id = auth.uid()
  ) and public.is_operator();
$$;

create or replace function public.can_manage_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
  or (
    public.is_operator() and exists (
      select 1
      from public.environment_memberships em
      join public.operator_environments oe on em.environment_id = oe.id
      where em.user_id = target_user_id
        and oe.operator_id = auth.uid()
    )
  );
$$;

create or replace function public.can_access_device(target_device_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
  or (
    public.is_operator() and exists (
      select 1
      from public.device_assignments da
      join public.environment_memberships em on da.user_id = em.user_id
      join public.operator_environments oe on em.environment_id = oe.id
      where da.device_id = target_device_id
        and oe.operator_id = auth.uid()
    )
  )
  or exists (
    select 1
    from public.device_assignments
    where device_id = target_device_id
      and user_id = auth.uid()
  );
$$;

-- Enable RLS
alter table public.operator_environments enable row level security;
alter table public.environment_invitations enable row level security;
alter table public.environment_memberships enable row level security;
alter table public.device_assignments enable row level security;

-- Policies for operator_environments
create policy "operator_environments_super_admin_all" on public.operator_environments
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "operator_environments_operator_read" on public.operator_environments
  for select to authenticated
  using (operator_id = auth.uid());

create policy "operator_environments_operator_update" on public.operator_environments
  for update to authenticated
  using (operator_id = auth.uid())
  with check (operator_id = auth.uid());

-- Policies for environment_invitations
create policy "environment_invitations_super_admin_all" on public.environment_invitations
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "environment_invitations_operator_all" on public.environment_invitations
  for all to authenticated
  using (public.is_operator_for_environment(environment_id))
  with check (public.is_operator_for_environment(environment_id));

-- Policies for environment_memberships
create policy "environment_memberships_super_admin_all" on public.environment_memberships
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "environment_memberships_operator_all" on public.environment_memberships
  for all to authenticated
  using (public.is_operator_for_environment(environment_id))
  with check (public.is_operator_for_environment(environment_id));

create policy "environment_memberships_self_read" on public.environment_memberships
  for select to authenticated
  using (user_id = auth.uid());

-- Policies for device_assignments
create policy "device_assignments_super_admin_all" on public.device_assignments
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "device_assignments_operator_all" on public.device_assignments
  for all to authenticated
  using (public.can_manage_user(user_id))
  with check (public.can_manage_user(user_id));

create policy "device_assignments_self_read" on public.device_assignments
  for select to authenticated
  using (user_id = auth.uid());

-- Policy for devices using can_access_device
drop policy if exists "devices_admin_select" on public.devices;
create policy "devices_admin_select" on public.devices
  for select to authenticated
  using (public.can_access_device(device_id));

-- Update admin_profiles policy
drop policy if exists "admin_profiles_super_admin_select" on public.admin_profiles;
drop policy if exists "admin_profiles_admin_select" on public.admin_profiles;
create policy "admin_profiles_admin_select" on public.admin_profiles
  for select to authenticated
  using (public.can_manage_user(user_id) or user_id = auth.uid());

drop policy if exists "admin_profiles_super_admin_update" on public.admin_profiles;
drop policy if exists "admin_profiles_admin_update" on public.admin_profiles;
create policy "admin_profiles_admin_update" on public.admin_profiles
  for update to authenticated
  using (public.can_manage_user(user_id) or user_id = auth.uid())
  with check (public.can_manage_user(user_id) or user_id = auth.uid());
