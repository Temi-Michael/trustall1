-- Push notification tokens (device_tokens) in the migrations, with known rules.
--
-- The table was created by hand on the live database (issue 6.5), so its
-- security rules couldn't be reviewed, and sign-out couldn't rely on users
-- being allowed to delete their own token row. This migration:
-- - creates the table on a fresh database (the live one keeps its table and
--   rows unchanged);
-- - replaces whatever policies the table has with "your own rows only":
--   read, add, update and delete. send-push-notification uses the service
--   role, which ignores these rules, so sending is unaffected;
-- - adds an index for the per-user lookup that function makes.
--
-- Columns the app uses: user_id, fcm_token (unique, the upsert key),
-- device_info, last_used_at. send-push-notification reads id and fcm_token.

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fcm_token text not null unique,
  device_info text,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists device_tokens_user_id_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

-- Start from a known state: drop every existing policy on the table, whatever
-- it was called when it was made by hand (a broad "anyone can read" policy
-- would otherwise stay active alongside the ones below).
do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'device_tokens'
  loop
    execute format('drop policy %I on public.device_tokens', v_policy.policyname);
  end loop;
end $$;

-- An upsert (insert ... on conflict update) needs select, insert and update.
create policy "Users read own device tokens" on public.device_tokens
  for select to authenticated using (user_id = auth.uid());

create policy "Users add own device tokens" on public.device_tokens
  for insert to authenticated with check (user_id = auth.uid());

create policy "Users update own device tokens" on public.device_tokens
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Sign-out deletes this device's row while the user is still signed in.
create policy "Users delete own device tokens" on public.device_tokens
  for delete to authenticated using (user_id = auth.uid());

-- Signed-out visitors have no tokens.
revoke all on public.device_tokens from anon;
grant select, insert, update, delete on public.device_tokens to authenticated;
