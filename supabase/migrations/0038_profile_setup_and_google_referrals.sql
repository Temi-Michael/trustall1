-- "Complete your registration" for Google accounts, and referrals for them.
--
-- The email sign-up form collects the name, and passes the invite link's
-- referral code to handle_new_user(). Google sign-up does neither, so:
-- - profiles.setup_completed_at records whether an account has been set up.
--   Email sign-ups (and every existing account) start set up; new Google
--   accounts start with null, and the app shows the setup step until
--   complete_profile_setup() fills it in, whichever Google button was used.
-- - complete_profile_setup() also records the referral code the app kept
--   across the Google redirect. Only an account that is still being set up can
--   claim one, and only once.
--
-- setup_completed_at is private: like the wallet and referral columns it is
-- not granted to anon/authenticated (see 0033), so only get_my_profile() and
-- admins read it, and the 0033 self-update guard stops users changing it.

-- ---------------------------------------------------------------------------
-- 1. Column, with every existing account marked as set up.
-- ---------------------------------------------------------------------------
-- The backfill runs only when the column is first added, so running this file
-- again can't mark new, unfinished Google accounts as set up.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'setup_completed_at'
  ) then
    alter table public.profiles add column setup_completed_at timestamptz;
    update public.profiles set setup_completed_at = created_at;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. New accounts: set up already when created through the email form.
-- ---------------------------------------------------------------------------
-- Same as 0003, plus setup_completed_at. app_metadata.provider is 'email' for
-- the sign-up form and 'google' for Google.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
begin
  if new.raw_user_meta_data->>'ref_code' is not null then
    select id into v_referrer_id from public.profiles where referral_code = new.raw_user_meta_data->>'ref_code';
  end if;

  insert into public.profiles (id, full_name, referred_by, setup_completed_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    v_referrer_id,
    case when coalesce(new.raw_app_meta_data->>'provider', 'email') = 'email' then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Finishing setup from the app.
-- ---------------------------------------------------------------------------
-- Called by the app after saving the name and photo (which users may update
-- themselves). Marks the caller's profile as set up and, if it has no referrer
-- yet, records the one whose code was given; your own code is ignored.
-- Returns true when a referral was recorded. Does nothing for an account that
-- is already set up, so a referral can't be added to an established account.
create or replace function public.complete_profile_setup(p_ref_code text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_setup_completed_at timestamptz;
  v_referred_by uuid;
  v_referrer_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in to complete your profile' using errcode = '42501';
  end if;

  select setup_completed_at, referred_by
    into v_setup_completed_at, v_referred_by
  from public.profiles
  where id = v_user_id
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_setup_completed_at is not null then
    return false;
  end if;

  if v_referred_by is null and nullif(btrim(p_ref_code), '') is not null then
    select id into v_referrer_id
    from public.profiles
    where referral_code = btrim(p_ref_code) and id <> v_user_id;
  end if;

  update public.profiles
  set setup_completed_at = now(),
      referred_by = coalesce(referred_by, v_referrer_id)
  where id = v_user_id;

  return v_referrer_id is not null;
end;
$$;

revoke execute on function public.complete_profile_setup(text) from public, anon;
grant execute on function public.complete_profile_setup(text) to authenticated;
