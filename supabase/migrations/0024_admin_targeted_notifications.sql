-- Allow admins to send targeted marketing notifications from the admin dashboard.
create policy "Admins can insert marketing notifications" on public.notifications
  for insert
  with check (public.is_admin() and type = 'marketing');
