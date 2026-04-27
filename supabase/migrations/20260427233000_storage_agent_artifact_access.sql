drop policy if exists "open_select_file_buckets" on storage.buckets;
create policy "open_select_file_buckets" on storage.buckets
  for select
  using (
    id in (
      'agent-temp-artifacts',
      'agent-archives',
      'agent-preview-cache',
      'admin-upload-staging'
    )
  );

drop policy if exists "open_select_temp_artifacts_objects" on storage.objects;
create policy "open_select_temp_artifacts_objects" on storage.objects
  for select
  using (bucket_id = 'agent-temp-artifacts');

drop policy if exists "open_select_archive_objects" on storage.objects;
create policy "open_select_archive_objects" on storage.objects
  for select
  using (bucket_id = 'agent-archives');

drop policy if exists "open_select_preview_objects" on storage.objects;
create policy "open_select_preview_objects" on storage.objects
  for select
  using (bucket_id = 'agent-preview-cache');

drop policy if exists "open_delete_temp_artifacts" on storage.objects;
create policy "open_delete_temp_artifacts" on storage.objects
  for delete
  using (bucket_id = 'agent-temp-artifacts');

drop policy if exists "open_delete_preview_cache" on storage.objects;
create policy "open_delete_preview_cache" on storage.objects
  for delete
  using (bucket_id = 'agent-preview-cache');
