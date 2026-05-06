drop policy if exists "open_select_commands" on public.commands;
drop policy if exists "commands_no_client_select" on public.commands;

create policy "commands_no_client_select" on public.commands
  for select
  using (false);
