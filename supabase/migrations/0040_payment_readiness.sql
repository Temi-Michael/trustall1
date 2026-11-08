-- Verified accounts before money moves, and referrals that survive an
-- unfinished Google sign-up.
--
-- 1. private.payment_blockers(): the one place that decides whether an account
--    may start a payment. Today ("level 1") that means: email confirmed,
--    profile finished (setup done and a name), a phone number on file, and
--    not suspended. Tightening it later (e.g. an SMS-confirmed phone once an
--    SMS provider is set up, issue 5.3) is a change here only; the checkout
--    block, the payout-connect check and the app's checklist all read it.
-- 2. get_my_payment_readiness(): the same answer for the signed-in user, for
--    the app's Verification page and for server functions (they call it with
--    the user's own token).
-- 3. issue_order_payment_reference(): checkout can only start once the buyer
--    is ready. Blocking happens here, BEFORE Paystack charges anything; the
--    payment check afterwards (paystack-verify-payment) is never blocked,
--    because refusing there would leave a taken payment stuck.
-- 4. claim_referral(): records an invite code as soon as a new Google user
--    returns, instead of only when they finish setup.

-- ---------------------------------------------------------------------------
-- 1. What stops an account from paying
-- ---------------------------------------------------------------------------
-- Returns the unmet requirements as codes, in the order the app lists them:
--   email_unconfirmed  the account's email hasn't been confirmed
--   profile_setup      setup unfinished (0038) or no name
--   phone_missing      no phone number in profile_contacts
--   account_suspended  suspended after repeated warnings (0034)
-- An empty array means the account may pay.
create or replace function private.payment_blockers(p_user_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_blockers text[] := array[]::text[];
  v_email_confirmed_at timestamptz;
  v_full_name text;
  v_status text;
  v_setup_completed_at timestamptz;
  v_phone text;
begin
  if p_user_id is null then
    return array['sign_in'];
  end if;

  select email_confirmed_at into v_email_confirmed_at from auth.users where id = p_user_id;

  select full_name, status, setup_completed_at
    into v_full_name, v_status, v_setup_completed_at
  from public.profiles
  where id = p_user_id;

  select phone into v_phone from public.profile_contacts where id = p_user_id;

  if v_email_confirmed_at is null then
    v_blockers := v_blockers || 'email_unconfirmed';
  end if;
  if v_setup_completed_at is null or nullif(btrim(v_full_name), '') is null then
    v_blockers := v_blockers || 'profile_setup';
  end if;
  if nullif(btrim(v_phone), '') is null then
    v_blockers := v_blockers || 'phone_missing';
  end if;
  if v_status = 'suspended' then
    v_blockers := v_blockers || 'account_suspended';
  end if;

  return v_blockers;
end;
$$;

revoke execute on function private.payment_blockers(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The signed-in user's readiness, for the app and server functions
-- ---------------------------------------------------------------------------
-- { "ready": true|false, "missing": ["phone_missing", ...] }
create or replace function public.get_my_payment_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_missing text[] := private.payment_blockers(auth.uid());
begin
  return jsonb_build_object('ready', cardinality(v_missing) = 0, 'missing', to_jsonb(v_missing));
end;
$$;

revoke execute on function public.get_my_payment_readiness() from public, anon;
grant execute on function public.get_my_payment_readiness() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Checkout starts only for ready buyers
-- ---------------------------------------------------------------------------
-- Same as 0035, plus the readiness check after the ownership check (so other
-- people's offers still get "not your offer"). The hint lets the app show the
-- checklist; the message alone is readable in older versions of the app.
create or replace function public.issue_order_payment_reference(p_offer_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid;
  v_status text;
  v_missing text[];
begin
  select c.buyer_id, o.status
    into v_buyer_id, v_status
  from public.offers o
  join public.conversations c on c.id = o.conversation_id
  where o.id = p_offer_id;

  if v_buyer_id is null or v_buyer_id is distinct from auth.uid() then
    raise exception 'This is not your offer to pay' using errcode = '42501';
  end if;

  v_missing := private.payment_blockers(v_buyer_id);
  if cardinality(v_missing) > 0 then
    raise exception 'Verify your account before paying: open Verification in your account menu.'
      using errcode = '42501',
            detail = array_to_string(v_missing, ','),
            hint = 'payment_verification_required';
  end if;

  if v_status <> 'pending' then
    raise exception 'This offer is no longer payable';
  end if;
  if not public.consume_rate_limit('order_reference:' || v_buyer_id, 20, 600) then
    raise exception 'Too many checkout attempts. Please wait a few minutes and try again.';
  end if;

  return public.new_transaction_reference('order_payment', v_buyer_id, p_offer_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Referral recorded as soon as a new Google user returns
-- ---------------------------------------------------------------------------
-- Like the referral part of complete_profile_setup() (0038): only for an
-- account still being set up, only if it has no referrer yet, never your own
-- code. Returns true when the referral was recorded.
create or replace function public.claim_referral(p_ref_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_referrer_id uuid;
begin
  if v_user_id is null or nullif(btrim(p_ref_code), '') is null then
    return false;
  end if;

  select id into v_referrer_id
  from public.profiles
  where referral_code = btrim(p_ref_code) and id <> v_user_id;

  if v_referrer_id is null then
    return false;
  end if;

  update public.profiles
  set referred_by = v_referrer_id
  where id = v_user_id
    and referred_by is null
    and setup_completed_at is null;

  return found;
end;
$$;

revoke execute on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;
