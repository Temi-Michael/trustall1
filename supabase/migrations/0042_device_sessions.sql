-- Main device and sign-out after inactivity.
--
-- Supabase's free plan has one access-token lifetime for every device (set to
-- 15 minutes) and no inactivity timeout, so Trustall adds its own:
-- - each browser registers itself as a device (a random ID it keeps), and
--   reports activity while it's being used;
-- - one device per user can be the MAIN device. It may sit unused for 3 hours
--   before it's signed out; every other device for 15 minutes;
-- - a device can only be made the main device within 10 minutes of signing in
--   on it, so someone who finds an unlocked phone can't give it 3 hours;
-- - a scheduled job ends logins that have been unused for longer than their
--   device's limit, so it holds even if the browser is closed or the app is
--   tampered with. The app also signs out on its own, with a warning.

-- ---------------------------------------------------------------------------
-- 1. Devices
-- ---------------------------------------------------------------------------
create table if not exists public.user_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  label text check (label is null or char_length(label) <= 80),
  is_main boolean not null default false,
  session_id uuid,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

-- At most one main device per user.
create unique index if not exists user_devices_one_main_per_user
  on public.user_devices (user_id) where is_main;
create index if not exists user_devices_session_id_idx on public.user_devices (session_id);

alter table public.user_devices enable row level security;

drop policy if exists "Users see their own devices" on public.user_devices;
create policy "Users see their own devices" on public.user_devices
  for select to authenticated using (user_id = auth.uid());

-- Changes only through the functions below.
revoke all on public.user_devices from anon, authenticated;
grant select on public.user_devices to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- When the caller last signed in (any method), from the "amr" claim Supabase
-- puts in every access token. Renewing the token keeps the original time.
create or replace function private.signed_in_at()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select to_timestamp(max((entry->>'timestamp')::bigint))
  from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) as entry
  where (entry->>'timestamp') ~ '^[0-9]+$';
$$;

revoke execute on function private.signed_in_at() from public, anon, authenticated;

-- The caller's current login (Supabase session) ID, if the token has one.
create or replace function private.current_session_id()
returns uuid
language sql
stable
set search_path = public
as $$
  select case
    when (auth.jwt()->>'session_id') ~ '^[0-9a-fA-F-]{36}$' then (auth.jwt()->>'session_id')::uuid
  end;
$$;

revoke execute on function private.current_session_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reporting activity
-- ---------------------------------------------------------------------------
-- Called when the app opens and every couple of minutes while it's used.
-- Records this device and this login, and tells the app which limit applies.
-- Returns { is_main, has_main, can_set_main }.
create or replace function public.register_device_activity(p_device_id uuid, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_main boolean;
  v_has_main boolean;
  v_signed_in_at timestamptz := private.signed_in_at();
begin
  if v_user_id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_device_id is null then
    raise exception 'A device ID is required' using errcode = '22023';
  end if;

  insert into public.user_devices (user_id, device_id, label, session_id, last_active_at)
  values (v_user_id, p_device_id, left(nullif(btrim(p_label), ''), 80), private.current_session_id(), now())
  on conflict (user_id, device_id) do update
    set label = coalesce(excluded.label, public.user_devices.label),
        session_id = coalesce(excluded.session_id, public.user_devices.session_id),
        last_active_at = now()
  returning is_main into v_is_main;

  select exists (select 1 from public.user_devices where user_id = v_user_id and is_main) into v_has_main;

  return jsonb_build_object(
    'is_main', v_is_main,
    'has_main', v_has_main,
    'can_set_main', v_signed_in_at is not null and v_signed_in_at > now() - interval '10 minutes'
  );
end;
$$;

revoke execute on function public.register_device_activity(uuid, text) from public, anon;
grant execute on function public.register_device_activity(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Choosing the main device
-- ---------------------------------------------------------------------------
-- Only within 10 minutes of signing in on this device; any previous main
-- device becomes an ordinary one.
create or replace function public.set_main_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_signed_in_at timestamptz := private.signed_in_at();
begin
  if v_user_id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_device_id is null then
    raise exception 'A device ID is required' using errcode = '22023';
  end if;
  if v_signed_in_at is null or v_signed_in_at <= now() - interval '10 minutes' then
    raise exception 'Sign in again on this device, then make it your main device within 10 minutes.'
      using errcode = '42501', hint = 'recent_sign_in_required';
  end if;

  update public.user_devices set is_main = false where user_id = v_user_id and is_main;

  insert into public.user_devices (user_id, device_id, is_main, session_id, last_active_at)
  values (v_user_id, p_device_id, true, private.current_session_id(), now())
  on conflict (user_id, device_id) do update
    set is_main = true,
        session_id = coalesce(excluded.session_id, public.user_devices.session_id),
        last_active_at = now();
end;
$$;

revoke execute on function public.set_main_device(uuid) from public, anon;
grant execute on function public.set_main_device(uuid) to authenticated;

-- Removing the main device only shortens its limit, so any of the user's
-- devices may do it.
create or replace function public.clear_main_device()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  update public.user_devices set is_main = false where user_id = auth.uid() and is_main;
end;
$$;

revoke execute on function public.clear_main_device() from public, anon;
grant execute on function public.clear_main_device() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Ending unused logins on the server
-- ---------------------------------------------------------------------------
-- Deletes Supabase sessions unused for longer than their device's limit
-- (main 3 hours, other 15 minutes). The device is signed out at its next token
-- renewal, within 15 minutes. Logins that never reported activity (an old copy
-- of the app, or a direct API client) get 30 minutes since their last renewal.
create or replace function private.end_idle_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
  v_count integer;
begin
  delete from auth.sessions s
  using public.user_devices d
  where d.session_id = s.id
    and d.last_active_at < now() - case when d.is_main then interval '3 hours' else interval '15 minutes' end;
  get diagnostics v_count = row_count;
  v_deleted := v_deleted + v_count;

  delete from auth.sessions s
  where not exists (select 1 from public.user_devices d where d.session_id = s.id)
    and coalesce(s.refreshed_at, s.updated_at, s.created_at) < now() - interval '30 minutes';
  get diagnostics v_count = row_count;
  v_deleted := v_deleted + v_count;

  -- Forget devices whose login has ended and that haven't been used in 90 days.
  delete from public.user_devices
  where last_active_at < now() - interval '90 days' and not is_main;

  return v_deleted;
end;
$$;

revoke execute on function private.end_idle_sessions() from public, anon, authenticated;

-- Run every 5 minutes, if this database lets the job end Supabase sessions.
-- If it doesn't, the app's own sign-out still applies; the notice says so.
do $$
begin
  if has_table_privilege('auth.sessions', 'DELETE') then
    perform cron.schedule('end-idle-sessions', '*/5 * * * *', $job$select private.end_idle_sessions();$job$);
  else
    raise notice 'end-idle-sessions not scheduled: no permission to delete from auth.sessions. The app still signs out unused devices itself.';
  end if;
end $$;
