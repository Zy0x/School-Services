drop policy if exists "file_roots_open_select" on public.file_roots;
create policy "file_roots_open_select" on public.file_roots
  for select using (true);
