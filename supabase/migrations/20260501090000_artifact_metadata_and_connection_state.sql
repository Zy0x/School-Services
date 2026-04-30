alter table public.file_jobs
  add column if not exists artifact_file_name text,
  add column if not exists artifact_size bigint,
  add column if not exists artifact_content_type text,
  add column if not exists artifact_device_name text,
  add column if not exists artifact_source_label text,
  add column if not exists artifact_deleted_at timestamptz,
  add column if not exists artifact_deleted_by uuid references public.admin_profiles(user_id) on delete set null;

create index if not exists idx_file_jobs_artifact_bucket_created_at
  on public.file_jobs(artifact_bucket, created_at desc)
  where artifact_bucket is not null;

create index if not exists idx_file_jobs_artifact_deleted_at
  on public.file_jobs(artifact_deleted_at)
  where artifact_deleted_at is not null;

alter table public.devices
  add column if not exists connection_state text not null default 'unknown',
  add column if not exists connection_last_error text,
  add column if not exists last_connection_change_at timestamptz;

alter table public.services
  add column if not exists tunnel_state text,
  add column if not exists last_public_url text,
  add column if not exists tunnel_last_error text;
