-- Security lockdown: protected profile columns, private phone numbers, RPC-only
-- order updates, encrypted verification ID numbers and private chat attachments.

-- ---------------------------------------------------------------------------
-- 1. Profiles: users may only edit their own public-facing fields.
-- ---------------------------------------------------------------------------
-- Allowlist, so columns added later (wallets, levels, flags) are protected by
-- default. Admins, security definer functions, triggers and the service role
-- are not restricted.
create or replace function public.guard_profile_self_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_editable text[] := array[
    'full_name', 'business_name', 'handle', 'state', 'bio',
    'avatar_url', 'business_logo_url', 'last_seen_at', 'updated_at'
  ];
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin() then
    return new;
  end if;

  if (to_jsonb(new) - v_editable) is distinct from (to_jsonb(old) - v_editable) then
    raise exception 'You can only update your own name, handle, location, bio and photo'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_profile_self_update on public.profiles;
create trigger trg_guard_profile_self_update
  before update on public.profiles
  for each row execute function public.guard_profile_self_update();

-- ---------------------------------------------------------------------------
-- 2. Phone numbers move out of the publicly readable profiles table.
-- ---------------------------------------------------------------------------
create table if not exists public.profile_contacts (
  id uuid primary key references public.profiles(id) on delete cascade,
  phone text,
  updated_at timestamptz not null default now()
);

alter table public.profile_contacts enable row level security;
revoke all on public.profile_contacts from anon;
grant select, insert, update on public.profile_contacts to authenticated;

drop policy if exists "Users view own contact details" on public.profile_contacts;
create policy "Users view own contact details" on public.profile_contacts
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "Users add own contact details" on public.profile_contacts;
create policy "Users add own contact details" on public.profile_contacts
  for insert with check (id = auth.uid());

drop policy if exists "Users update own contact details" on public.profile_contacts;
create policy "Users update own contact details" on public.profile_contacts
  for update using (id = auth.uid()) with check (id = auth.uid());

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone'
  ) then
    insert into public.profile_contacts (id, phone)
    select id, phone from public.profiles
    where phone is not null and trim(phone) <> ''
    on conflict (id) do update set phone = excluded.phone, updated_at = now();

    alter table public.profiles drop column phone;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Orders: no direct client updates; state changes go through RPCs.
-- ---------------------------------------------------------------------------
drop policy if exists "Sellers mark fulfilled" on public.orders;
drop policy if exists "Admins update orders" on public.orders;
create policy "Admins update orders" on public.orders
  for update using (public.is_admin()) with check (public.is_admin());

alter table public.orders add column if not exists wallet_pending_recorded_at timestamptz;

-- Every existing order has already been through record_payment_as_pending.
update public.orders
set wallet_pending_recorded_at = created_at
where wallet_pending_recorded_at is null;

create or replace function public.mark_order_fulfilled(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.id is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;
  if v_order.seller_id is distinct from auth.uid() and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'Only the seller can mark this order as delivered');
  end if;
  if v_order.status <> 'paid' then
    return jsonb_build_object('success', false, 'error', 'This order can no longer be marked as delivered');
  end if;

  -- trg_set_fulfillment_timestamps sets fulfilled_at and the release/dispute clocks.
  update public.orders set status = 'fulfilled' where id = p_order_id;

  return jsonb_build_object('success', true, 'order_id', p_order_id);
end;
$$;

revoke execute on function public.mark_order_fulfilled(uuid) from public, anon;
grant execute on function public.mark_order_fulfilled(uuid) to authenticated;

-- Was callable by anyone for any order, and added the payout to the seller's
-- pending wallet on every call.
create or replace function public.record_payment_as_pending(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_title text;
  v_conversation_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.id is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;
  if v_order.buyer_id is distinct from auth.uid() and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'Only the buyer can record this payment');
  end if;
  if v_order.wallet_pending_recorded_at is not null then
    return jsonb_build_object('success', true, 'order_id', p_order_id);
  end if;

  update public.orders
  set wallet_pending_recorded_at = now()
  where id = p_order_id;

  update public.profiles
  set wallet_pending = coalesce(wallet_pending, 0) + coalesce(v_order.seller_payout, 0)
  where id = v_order.seller_id;

  select ofr.item_title, ofr.conversation_id
    into v_title, v_conversation_id
  from public.offers ofr
  where ofr.id = v_order.offer_id;

  insert into public.notifications (
    recipient_id,
    sender_id,
    type,
    title,
    message,
    related_order_id,
    related_conversation_id
  )
  select
    v_order.seller_id,
    v_order.buyer_id,
    'offer_accepted',
    'Buyer payment secured',
    'Payment for ' || coalesce(v_title, 'your item') || ' has been secured and is pending delivery confirmation.',
    p_order_id,
    v_conversation_id
  where not exists (
    select 1 from public.notifications n
    where n.recipient_id = v_order.seller_id
      and n.related_order_id = p_order_id
      and n.type = 'offer_accepted'
  );

  return jsonb_build_object('success', true, 'order_id', p_order_id);
end;
$$;

revoke execute on function public.record_payment_as_pending(uuid) from public, anon;
grant execute on function public.record_payment_as_pending(uuid) to authenticated;

-- Was callable by anyone for any order, and moved the wallet a second time on
-- top of trg_on_order_confirmed (which already moves it once on confirmation).
create or replace function public.confirm_delivery_and_release_payment(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_title text;
  v_conversation_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.id is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;
  if v_order.buyer_id is distinct from auth.uid() and not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'Only the buyer can confirm delivery');
  end if;
  if v_order.status in ('confirmed', 'complete') then
    return jsonb_build_object('success', true, 'order_id', p_order_id);
  end if;
  if v_order.status not in ('paid', 'fulfilled') then
    return jsonb_build_object('success', false, 'error', 'This order cannot be confirmed while it is ' || v_order.status);
  end if;

  -- trg_on_order_confirmed moves wallet_pending to wallet_cleared and updates seller stats.
  update public.orders
  set status = 'confirmed',
      confirmed_at = coalesce(confirmed_at, now()),
      released_at = coalesce(released_at, now())
  where id = p_order_id;

  select ofr.item_title, ofr.conversation_id
    into v_title, v_conversation_id
  from public.offers ofr
  where ofr.id = v_order.offer_id;

  insert into public.notifications (
    recipient_id,
    sender_id,
    type,
    title,
    message,
    related_order_id,
    related_conversation_id
  )
  select * from (
    values
      (v_order.seller_id, v_order.buyer_id, 'payment_released', 'Payment released', 'Payment for ' || coalesce(v_title, 'your item') || ' has been released to your wallet.', p_order_id, v_conversation_id),
      (v_order.buyer_id, v_order.seller_id, 'order_confirmed', 'Order completed', 'You confirmed delivery for ' || coalesce(v_title, 'this order') || '. The seller has been paid.', p_order_id, v_conversation_id)
  ) as v(recipient_id, sender_id, type, title, message, related_order_id, related_conversation_id)
  where not exists (
    select 1 from public.notifications n
    where n.related_order_id = p_order_id
      and n.type = v.type
      and n.recipient_id = v.recipient_id
  );

  return jsonb_build_object('success', true, 'order_id', p_order_id);
end;
$$;

revoke execute on function public.confirm_delivery_and_release_payment(uuid) from public, anon;
grant execute on function public.confirm_delivery_and_release_payment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Verification ID numbers: encrypted at rest, key held in Supabase Vault.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'verification_id_number_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'verification_id_number_key',
      'Encrypts verification_requests.id_number'
    );
  end if;
end $$;

create or replace function private.verification_id_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'verification_id_number_key'
  limit 1;

  if v_key is null then
    raise exception 'verification_id_number_key is missing from Vault';
  end if;
  return v_key;
end;
$$;

revoke execute on function private.verification_id_key() from public, anon, authenticated;

alter table public.verification_requests
  add column if not exists id_number_encrypted bytea,
  add column if not exists id_number_last4 text,
  alter column id_number drop not null;

create or replace function public.encrypt_verification_id_number()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clean text;
begin
  if tg_op = 'INSERT' then
    new.id_number_encrypted := null;
    new.id_number_last4 := null;
  end if;

  v_clean := nullif(regexp_replace(coalesce(new.id_number, ''), '\s', '', 'g'), '');
  if v_clean is not null then
    new.id_number_encrypted := pgp_sym_encrypt(v_clean, private.verification_id_key());
    new.id_number_last4 := right(v_clean, 4);
  end if;

  -- The plain-text column is never stored.
  new.id_number := null;
  return new;
end;
$$;

drop trigger if exists trg_encrypt_verification_id_number on public.verification_requests;
create trigger trg_encrypt_verification_id_number
  before insert or update of id_number on public.verification_requests
  for each row execute function public.encrypt_verification_id_number();

-- Re-save existing rows so the trigger encrypts and clears them.
update public.verification_requests set id_number = id_number where id_number is not null;

create or replace function public.reveal_verification_id_number(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_encrypted bytea;
begin
  if not public.is_admin() then
    raise exception 'Only admins can view ID numbers' using errcode = '42501';
  end if;

  select id_number_encrypted into v_encrypted
  from public.verification_requests
  where id = p_request_id;

  if v_encrypted is null then
    return null;
  end if;
  return pgp_sym_decrypt(v_encrypted, private.verification_id_key());
end;
$$;

revoke execute on function public.reveal_verification_id_number(uuid) from public, anon;
grant execute on function public.reveal_verification_id_number(uuid) to authenticated;

-- Sellers could previously submit a request already marked approved.
drop policy if exists "Sellers submit verification" on public.verification_requests;
create policy "Sellers submit verification" on public.verification_requests
  for insert with check (seller_id = auth.uid() and status = 'pending' and reviewed_by is null);

-- ---------------------------------------------------------------------------
-- 5. Chat attachments: private bucket, conversation participants only.
-- ---------------------------------------------------------------------------
-- Objects are stored as <conversation_id>/<file>.
update storage.buckets set public = false where id = 'message-attachments';

create or replace function public.is_conversation_participant(p_conversation_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversations c
    where c.id::text = p_conversation_id
      and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
  );
$$;

drop policy if exists "Public read uploaded chat media" on storage.objects;
drop policy if exists "Authenticated users upload chat media" on storage.objects;
drop policy if exists "Authenticated users update their chat media" on storage.objects;
drop policy if exists "Authenticated users delete chat media" on storage.objects;
drop policy if exists "Participants read chat media" on storage.objects;
drop policy if exists "Participants upload chat media" on storage.objects;
drop policy if exists "Participants update chat media" on storage.objects;
drop policy if exists "Participants delete chat media" on storage.objects;

create policy "Participants read chat media" on storage.objects
  for select using (
    bucket_id = 'message-attachments'
    and (public.is_conversation_participant((storage.foldername(name))[1]) or public.is_admin())
  );

create policy "Participants upload chat media" on storage.objects
  for insert with check (
    bucket_id = 'message-attachments'
    and public.is_conversation_participant((storage.foldername(name))[1])
  );

create policy "Participants update chat media" on storage.objects
  for update using (
    bucket_id = 'message-attachments'
    and public.is_conversation_participant((storage.foldername(name))[1])
  ) with check (
    bucket_id = 'message-attachments'
    and public.is_conversation_participant((storage.foldername(name))[1])
  );

create policy "Participants delete chat media" on storage.objects
  for delete using (
    bucket_id = 'message-attachments'
    and (public.is_conversation_participant((storage.foldername(name))[1]) or public.is_admin())
  );
