create table if not exists public.admin_profiles (
  user_id uuid primary key,
  email text not null,
  role text not null default 'super_admin' check (role in ('super_admin')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.file_jobs (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices(device_id) on delete cascade,
  requested_by uuid,
  job_type text not null check (
    job_type in (
      'discover_roots',
      'list_directory',
      'stat_path',
      'preview_file',
      'download_file',
      'archive_paths',
      'upload_place',
      'discover_app_paths'
    )
  ),
  status text not null default 'pending' check (
    status in ('pending', 'running', 'completed', 'failed', 'cancelled', 'expired')
  ),
  delivery_mode text not null default 'temp' check (
    delivery_mode in ('temp', 'persistent')
  ),
  source_path text,
  destination_path text,
  selection jsonb not null default '[]'::jsonb,
  options jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  progress_current bigint not null default 0,
  progress_total bigint not null default 0,
  artifact_bucket text,
  artifact_object_key text,
  artifact_expires_at timestamptz,
  locked_by_device text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.file_roots (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices(device_id) on delete cascade,
  root_key text not null,
  label text not null,
  path text not null,
  root_type text not null check (root_type in ('drive', 'quick_access', 'application')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (device_id, root_key)
);

create table if not exists public.file_audit_logs (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices(device_id) on delete cascade,
  requested_by uuid,
  job_id bigint references public.file_jobs(id) on delete set null,
  action text not null,
  target_path text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_file_jobs_device_status_created_at
  on public.file_jobs(device_id, status, created_at desc);
create index if not exists idx_file_jobs_requested_by_created_at
  on public.file_jobs(requested_by, created_at desc);
create index if not exists idx_file_roots_device_type
  on public.file_roots(device_id, root_type);
create index if not exists idx_file_audit_logs_device_created_at
  on public.file_audit_logs(device_id, created_at desc);

alter table public.admin_profiles enable row level security;
alter table public.file_jobs enable row level security;
alter table public.file_roots enable row level security;
alter table public.file_audit_logs enable row level security;

drop policy if exists "admin_profiles_self_select" on public.admin_profiles;
create policy "admin_profiles_self_select" on public.admin_profiles
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "file_jobs_admin_select" on public.file_jobs;
create policy "file_jobs_admin_select" on public.file_jobs
  for select to authenticated
  using (
    exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
    )
  );

drop policy if exists "file_jobs_admin_insert" on public.file_jobs;
create policy "file_jobs_admin_insert" on public.file_jobs
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
    )
  );

drop policy if exists "file_jobs_open_update" on public.file_jobs;
create policy "file_jobs_open_update" on public.file_jobs
  for update using (true) with check (true);

drop policy if exists "file_roots_admin_select" on public.file_roots;
create policy "file_roots_admin_select" on public.file_roots
  for select to authenticated
  using (
    exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
    )
  );

drop policy if exists "file_roots_open_insert" on public.file_roots;
create policy "file_roots_open_insert" on public.file_roots
  for insert with check (true);

drop policy if exists "file_roots_open_update" on public.file_roots;
create policy "file_roots_open_update" on public.file_roots
  for update using (true) with check (true);

drop policy if exists "file_audit_logs_admin_select" on public.file_audit_logs;
create policy "file_audit_logs_admin_select" on public.file_audit_logs
  for select to authenticated
  using (
    exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
    )
  );

drop policy if exists "file_audit_logs_admin_insert" on public.file_audit_logs;
create policy "file_audit_logs_admin_insert" on public.file_audit_logs
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
    )
  );

alter table public.file_jobs replica identity full;
alter table public.file_roots replica identity full;
alter table public.file_audit_logs replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'file_jobs'
  ) then
    alter publication supabase_realtime add table public.file_jobs;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'file_roots'
  ) then
    alter publication supabase_realtime add table public.file_roots;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'file_audit_logs'
  ) then
    alter publication supabase_realtime add table public.file_audit_logs;
  end if;
end
$$;

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('agent-temp-artifacts', 'agent-temp-artifacts', false, null),
  ('agent-archives', 'agent-archives', false, null),
  ('agent-preview-cache', 'agent-preview-cache', false, null),
  ('admin-upload-staging', 'admin-upload-staging', false, null)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "super_admin_read_temp_artifacts" on storage.objects;
create policy "super_admin_read_temp_artifacts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'agent-temp-artifacts'
    and exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
    )
  );

drop policy if exists "open_write_temp_artifacts" on storage.objects;
create policy "open_write_temp_artifacts" on storage.objects
  for insert with check (bucket_id = 'agent-temp-artifacts');

drop policy if exists "open_update_temp_artifacts" on storage.objects;
create policy "open_update_temp_artifacts" on storage.objects
  for update using (bucket_id = 'agent-temp-artifacts')
  with check (bucket_id = 'agent-temp-artifacts');

drop policy if exists "super_admin_read_archives" on storage.objects;
create policy "super_admin_read_archives" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'agent-archives'
    and exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
    )
  );

drop policy if exists "open_write_archives" on storage.objects;
create policy "open_write_archives" on storage.objects
  for insert with check (bucket_id = 'agent-archives');

drop policy if exists "open_update_archives" on storage.objects;
create policy "open_update_archives" on storage.objects
  for update using (bucket_id = 'agent-archives')
  with check (bucket_id = 'agent-archives');

drop policy if exists "super_admin_read_preview_cache" on storage.objects;
create policy "super_admin_read_preview_cache" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'agent-preview-cache'
    and exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
    )
  );

drop policy if exists "open_write_preview_cache" on storage.objects;
create policy "open_write_preview_cache" on storage.objects
  for insert with check (bucket_id = 'agent-preview-cache');

drop policy if exists "open_update_preview_cache" on storage.objects;
create policy "open_update_preview_cache" on storage.objects
  for update using (bucket_id = 'agent-preview-cache')
  with check (bucket_id = 'agent-preview-cache');

drop policy if exists "super_admin_upload_staging_write" on storage.objects;
create policy "super_admin_upload_staging_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'admin-upload-staging'
    and exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
    )
  );

drop policy if exists "super_admin_upload_staging_read" on storage.objects;
create policy "super_admin_upload_staging_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'admin-upload-staging'
    and exists (
      select 1
      from public.admin_profiles profile
      where profile.user_id = auth.uid()
        and profile.role = 'super_admin'
    )
  );

drop policy if exists "open_upload_staging_read_for_agent" on storage.objects;
create policy "open_upload_staging_read_for_agent" on storage.objects
  for select using (bucket_id = 'admin-upload-staging');
