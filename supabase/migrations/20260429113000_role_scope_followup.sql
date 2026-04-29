alter table public.admin_profiles
  add column if not exists primary_environment_id uuid,
  add column if not exists standalone_state text not null default 'standalone';

alter table public.admin_profiles
  drop constraint if exists admin_profiles_standalone_state_check;

alter table public.admin_profiles
  add constraint admin_profiles_standalone_state_check
  check (standalone_state in ('standalone', 'linked', 'pending_environment'));

alter table public.operator_environments
  add column if not exists referral_code text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create unique index if not exists idx_operator_environments_referral_code
  on public.operator_environments(referral_code)
  where referral_code is not null;

alter table public.environment_invitations
  add column if not exists invite_role text not null default 'user',
  add column if not exists status text not null default 'pending',
  add column if not exists accepted_by uuid,
  add column if not exists accepted_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.environment_invitations
  drop constraint if exists environment_invitations_invite_role_check;

alter table public.environment_invitations
  add constraint environment_invitations_invite_role_check
  check (invite_role in ('user'));

alter table public.environment_invitations
  drop constraint if exists environment_invitations_status_check;

alter table public.environment_invitations
  add constraint environment_invitations_status_check
  check (status in ('pending', 'accepted', 'cancelled', 'expired', 'revoked'));

alter table public.environment_memberships
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists role text not null default 'user',
  add column if not exists status text not null default 'pending',
  add column if not exists joined_via text not null default 'referral_code',
  add column if not exists requested_by_user_id uuid,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_by uuid,
  add column if not exists rejected_at timestamptz,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.environment_memberships
set created_at = coalesce(created_at, joined_at),
    updated_at = coalesce(updated_at, joined_at)
where joined_at is not null;

create unique index if not exists idx_environment_memberships_id
  on public.environment_memberships(id);

create unique index if not exists idx_environment_memberships_user_active
  on public.environment_memberships(user_id)
  where status in ('pending', 'approved');

alter table public.environment_memberships
  drop constraint if exists environment_memberships_role_check;

alter table public.environment_memberships
  add constraint environment_memberships_role_check
  check (role in ('operator', 'user'));

alter table public.environment_memberships
  drop constraint if exists environment_memberships_status_check;

alter table public.environment_memberships
  add constraint environment_memberships_status_check
  check (status in ('pending', 'approved', 'rejected', 'removed'));

alter table public.environment_memberships
  drop constraint if exists environment_memberships_joined_via_check;

alter table public.environment_memberships
  add constraint environment_memberships_joined_via_check
  check (joined_via in ('operator_created', 'super_admin_created', 'invite_email', 'referral_code', 'direct_superadmin', 'standalone_request'));

alter table public.device_assignments
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists environment_id uuid,
  add column if not exists assignment_role text not null default 'owner',
  add column if not exists status text not null default 'active',
  add column if not exists is_primary boolean not null default true,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.device_assignments
set created_at = coalesce(created_at, assigned_at),
    updated_at = coalesce(updated_at, assigned_at)
where assigned_at is not null;

create unique index if not exists idx_device_assignments_id
  on public.device_assignments(id);

create unique index if not exists idx_device_assignments_active_device
  on public.device_assignments(device_id)
  where status = 'active' and is_primary = true;

alter table public.device_assignments
  drop constraint if exists device_assignments_assignment_role_check;

alter table public.device_assignments
  add constraint device_assignments_assignment_role_check
  check (assignment_role in ('owner', 'member', 'observer'));

alter table public.device_assignments
  drop constraint if exists device_assignments_status_check;

alter table public.device_assignments
  add constraint device_assignments_status_check
  check (status in ('pending', 'active', 'revoked'));

update public.app_settings
set value = jsonb_strip_nulls(
      coalesce(value, '{}'::jsonb)
      || jsonb_build_object(
        'operatorAutoApproveHours', coalesce((value ->> 'operatorAutoApproveHours')::integer, 24),
        'environmentUserAutoApproveHours', coalesce((value ->> 'environmentUserAutoApproveHours')::integer, 8),
        'standaloneUserApprovalMode', case
          when value ? 'standaloneUserApprovalMode' then value ->> 'standaloneUserApprovalMode'
          when coalesce((value ->> 'standaloneUserManualMode')::boolean, true) = false then 'auto'
          else 'manual'
        end,
        'standaloneUserAutoApproveHours', coalesce((value ->> 'standaloneUserAutoApproveHours')::integer, 24),
        'maintenanceIntervalMinutes', coalesce((value ->> 'maintenanceIntervalMinutes')::integer, 15),
        'passwordResetRedirectUrl', coalesce(value ->> 'passwordResetRedirectUrl', 'https://school-services.netlify.app/reset-password')
      )
    ),
    updated_at = timezone('utc', now())
where key = 'auth_policy';

create or replace function public.generate_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_code text;
begin
  loop
    next_code := upper(substr(translate(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (
      select 1 from public.operator_environments env where env.referral_code = next_code
    );
  end loop;

  return next_code;
end;
$$;

update public.operator_environments
set referral_code = public.generate_referral_code(),
    updated_at = timezone('utc', now())
where referral_code is null or referral_code = '';

create or replace function public.current_environment_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select profile.primary_environment_id
     from public.admin_profiles profile
     where profile.user_id = auth.uid()
     limit 1),
    (select env.id
     from public.operator_environments env
     where env.operator_id = auth.uid()
     limit 1),
    (select membership.environment_id
     from public.environment_memberships membership
     where membership.user_id = auth.uid()
       and membership.status = 'approved'
     order by membership.updated_at desc
     limit 1)
  );
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
      where em.user_id = target_user_id
        and em.environment_id = public.current_environment_id()
        and em.status in ('pending', 'approved')
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
  or exists (
    select 1
    from public.device_assignments da
    where da.device_id = target_device_id
      and da.status = 'active'
      and (
        da.user_id = auth.uid()
        or (
          public.is_operator()
          and da.environment_id is not null
          and da.environment_id = public.current_environment_id()
        )
      )
  );
$$;

create or replace function public.process_account_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg jsonb;
  operator_hours integer := 24;
  environment_user_hours integer := 8;
  standalone_hours integer := 24;
  standalone_mode text := 'manual';
  approved_operators integer := 0;
  approved_users integer := 0;
begin
  select value into cfg
  from public.app_settings
  where key = 'auth_policy';

  operator_hours := greatest(1, coalesce((cfg ->> 'operatorAutoApproveHours')::integer, 24));
  environment_user_hours := greatest(1, coalesce((cfg ->> 'environmentUserAutoApproveHours')::integer, 8));
  standalone_hours := greatest(1, coalesce((cfg ->> 'standaloneUserAutoApproveHours')::integer, 24));
  standalone_mode := coalesce(cfg ->> 'standaloneUserApprovalMode', 'manual');

  update public.admin_profiles
  set status = 'approved',
      approved_at = coalesce(approved_at, timezone('utc', now())),
      approval_due_at = null,
      updated_at = timezone('utc', now())
  where role = 'operator'
    and status = 'pending'
    and approval_due_at is not null
    and approval_due_at <= timezone('utc', now());

  GET DIAGNOSTICS approved_operators = ROW_COUNT;

  update public.admin_profiles profile
  set status = 'approved',
      approved_at = coalesce(profile.approved_at, timezone('utc', now())),
      approval_due_at = null,
      updated_at = timezone('utc', now())
  where profile.role = 'user'
    and profile.status = 'pending'
    and (
      (
        profile.primary_environment_id is not null
        and profile.approval_due_at is not null
        and profile.approval_due_at <= timezone('utc', now())
      )
      or (
        profile.primary_environment_id is null
        and standalone_mode = 'auto'
        and profile.approval_due_at is not null
        and profile.approval_due_at <= timezone('utc', now())
      )
    );

  GET DIAGNOSTICS approved_users = ROW_COUNT;

  update public.environment_memberships membership
  set status = 'approved',
      approved_at = coalesce(membership.approved_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  from public.admin_profiles profile
  where membership.user_id = profile.user_id
    and membership.status = 'pending'
    and profile.status = 'approved'
    and profile.primary_environment_id = membership.environment_id;

  update public.admin_profiles profile
  set standalone_state = case when profile.primary_environment_id is null then 'standalone' else 'linked' end,
      updated_at = timezone('utc', now())
  where profile.status = 'approved';

  return jsonb_build_object(
    'operatorAutoApproveHours', operator_hours,
    'environmentUserAutoApproveHours', environment_user_hours,
    'standaloneUserApprovalMode', standalone_mode,
    'standaloneUserAutoApproveHours', standalone_hours,
    'approvedOperators', approved_operators,
    'approvedUsers', approved_users,
    'processedAt', timezone('utc', now())
  );
end;
$$;
