drop policy if exists "file_jobs_open_select" on public.file_jobs;
create policy "file_jobs_open_select" on public.file_jobs
  for select using (true);

drop policy if exists "file_roots_open_delete" on public.file_roots;
create policy "file_roots_open_delete" on public.file_roots
  for delete using (true);
