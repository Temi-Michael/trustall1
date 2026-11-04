-- Allow admins to send targeted marketing notifications from the admin dashboard.
drop policy if exists "Admins can insert marketing notifications" on public.notifications;
create policy "Admins can insert marketing notifications" on public.notifications
  for insert
  with check (public.is_admin() and type = 'marketing');
