drop policy if exists "file_audit_logs_open_insert" on public.file_audit_logs;
create policy "file_audit_logs_open_insert" on public.file_audit_logs
  for insert with check (true);
