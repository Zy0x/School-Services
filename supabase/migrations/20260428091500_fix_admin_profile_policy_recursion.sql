create or replace function public.is_super_admin()
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
      and role = 'super_admin'
      and status = 'approved'
  );
$$;

drop policy if exists "admin_profiles_super_admin_select" on public.admin_profiles;
drop policy if exists "admin_profiles_super_admin_update" on public.admin_profiles;

drop policy if exists "file_jobs_admin_select" on public.file_jobs;
create policy "file_jobs_admin_select" on public.file_jobs
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists "file_jobs_admin_insert" on public.file_jobs;
create policy "file_jobs_admin_insert" on public.file_jobs
  for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists "file_roots_admin_select" on public.file_roots;
create policy "file_roots_admin_select" on public.file_roots
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists "file_audit_logs_admin_select" on public.file_audit_logs;
create policy "file_audit_logs_admin_select" on public.file_audit_logs
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists "file_audit_logs_admin_insert" on public.file_audit_logs;
create policy "file_audit_logs_admin_insert" on public.file_audit_logs
  for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists "app_settings_super_admin_select" on public.app_settings;
create policy "app_settings_super_admin_select" on public.app_settings
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists "app_settings_super_admin_update" on public.app_settings;
create policy "app_settings_super_admin_update" on public.app_settings
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists "guest_shortcuts_super_admin_select" on public.guest_shortcuts;
create policy "guest_shortcuts_super_admin_select" on public.guest_shortcuts
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists "super_admin_read_temp_artifacts" on storage.objects;
create policy "super_admin_read_temp_artifacts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'agent-temp-artifacts'
    and public.is_super_admin()
  );

drop policy if exists "super_admin_read_archives" on storage.objects;
create policy "super_admin_read_archives" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'agent-archives'
    and public.is_super_admin()
  );

drop policy if exists "super_admin_read_preview_cache" on storage.objects;
create policy "super_admin_read_preview_cache" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'agent-preview-cache'
    and public.is_super_admin()
  );

drop policy if exists "super_admin_upload_staging_write" on storage.objects;
create policy "super_admin_upload_staging_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'admin-upload-staging'
    and public.is_super_admin()
  );

drop policy if exists "super_admin_upload_staging_read" on storage.objects;
create policy "super_admin_upload_staging_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'admin-upload-staging'
    and public.is_super_admin()
  );
