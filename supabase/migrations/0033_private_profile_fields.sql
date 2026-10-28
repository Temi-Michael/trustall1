-- Profiles stay publicly readable for names, badges and stats, but these
-- columns are hidden from everyone except the owner and admins:
--   wallet_pending, wallet_cleared      money in the user's wallet
--   paystack_subaccount_code,
--   paystack_recipient_code             payout account identifiers
--   warning_count                       moderation history
--   referral_code, referred_by          who referred whom
-- plus any wallet_*, paystack_*, bank_* or account_* column, and bvn/nin, that
-- exists only on the live database. Owners read them through get_my_profile(),
-- admins through admin_get_profiles().
--
-- New public profile columns must be granted explicitly in their migration:
--   grant select (new_column) on public.profiles to anon, authenticated;

-- Others only need to know whether a seller can be paid, not the account code.
alter table public.profiles
  add column if not exists payout_connected boolean
  generated always as (paystack_recipient_code is not null) stored;

-- The self-update guard must ignore generated columns: Postgres fills them in
-- after BEFORE triggers run, so NEW does not hold their final value yet.
create or replace function public.guard_profile_self_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ignored text[] := array[
    'full_name', 'business_name', 'handle', 'state', 'bio',
    'avatar_url', 'business_logo_url', 'last_seen_at', 'updated_at',
    'payout_connected'
  ];
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin() then
    return new;
  end if;

  if (to_jsonb(new) - v_ignored) is distinct from (to_jsonb(old) - v_ignored) then
    raise exception 'You can only update your own name, handle, location, bio and photo'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

do $$
declare
  v_public_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_public_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name not in ('wallet_pending', 'wallet_cleared', 'paystack_subaccount_code',
                            'paystack_recipient_code', 'warning_count', 'referral_code',
                            'referred_by', 'bvn', 'nin')
    and column_name !~ '^(wallet_|paystack_|bank_|account_)';

  revoke select on public.profiles from anon, authenticated;
  execute format('grant select (%s) on public.profiles to anon, authenticated', v_public_columns);
end $$;

create or replace function public.get_my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

revoke execute on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

create or replace function public.admin_get_profiles(p_ids uuid[])
returns setof public.profiles
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can view private profile fields' using errcode = '42501';
  end if;
  return query select * from public.profiles where id = any(p_ids);
end;
$$;

revoke execute on function public.admin_get_profiles(uuid[]) from public, anon;
grant execute on function public.admin_get_profiles(uuid[]) to authenticated;
