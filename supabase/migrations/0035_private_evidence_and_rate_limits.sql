-- Private dispute evidence, and a rate limiter for server functions and RPCs.

-- ---------------------------------------------------------------------------
-- 1. Dispute evidence: private bucket, visible only to the people in the case.
-- ---------------------------------------------------------------------------
-- Objects are stored as dispute-evidence/<dispute_id>/<file>.
create or replace function public.can_access_dispute(p_dispute_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return true;
  end if;
  return exists (
    select 1
    from public.disputes d
    join public.orders o on o.id = d.order_id
    where d.id::text = p_dispute_id
      and auth.uid() in (o.buyer_id, o.seller_id, d.filed_by, d.assigned_judge_id)
  );
end;
$$;

update storage.buckets set public = false where id = 'dispute-evidence';

-- Remove whatever policies already cover this bucket (some were made in the
-- dashboard, so their names aren't known), then add the participant-only ones.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%dispute-evidence%'
  loop
    execute format('drop policy %I on storage.objects', v_policy.policyname);
  end loop;
end $$;

create policy "Dispute parties read evidence" on storage.objects
  for select using (bucket_id = 'dispute-evidence' and public.can_access_dispute((storage.foldername(name))[2]));
create policy "Dispute parties upload evidence" on storage.objects
  for insert with check (bucket_id = 'dispute-evidence' and public.can_access_dispute((storage.foldername(name))[2]));
create policy "Dispute parties replace evidence" on storage.objects
  for update using (bucket_id = 'dispute-evidence' and public.can_access_dispute((storage.foldername(name))[2]))
  with check (bucket_id = 'dispute-evidence' and public.can_access_dispute((storage.foldername(name))[2]));
create policy "Admins delete evidence" on storage.objects
  for delete using (bucket_id = 'dispute-evidence' and public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Rate limiting: fixed windows counted in the database.
-- ---------------------------------------------------------------------------
create schema if not exists private;

create table if not exists private.rate_limit_hits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- Returns true while the caller is within p_limit calls per p_window_seconds.
create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := left(p_key, 200);
  v_window timestamptz;
  v_hits integer;
begin
  if nullif(v_key, '') is null or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  delete from private.rate_limit_hits where key = v_key and window_start < v_window;
  -- Occasionally sweep keys that never came back.
  if random() < 0.01 then
    delete from private.rate_limit_hits where window_start < now() - interval '1 day';
  end if;

  insert into private.rate_limit_hits as h (key, window_start, hits)
  values (v_key, v_window, 1)
  on conflict (key, window_start) do update set hits = h.hits + 1
  returning hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- Checkout references: at most 20 per buyer every 10 minutes.
create or replace function public.issue_order_payment_reference(p_offer_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid;
  v_status text;
begin
  select c.buyer_id, o.status
    into v_buyer_id, v_status
  from public.offers o
  join public.conversations c on c.id = o.conversation_id
  where o.id = p_offer_id;

  if v_buyer_id is null or v_buyer_id is distinct from auth.uid() then
    raise exception 'This is not your offer to pay' using errcode = '42501';
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
