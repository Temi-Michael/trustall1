-- Server-issued transaction references: TRUST-<CODE>-<8 random chars>, e.g.
-- TRUST-TOP-T73XBA6S. Every reference is recorded once, bound to the user and
-- the thing it pays for, so it cannot be guessed or replayed.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 32 symbols without 0/O/1/I, so one random byte & 31 maps to a symbol without bias.
create or replace function private.random_reference_suffix()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := gen_random_bytes(8);
  v_suffix text := '';
begin
  for i in 0..7 loop
    v_suffix := v_suffix || substr(v_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);
  end loop;
  return v_suffix;
end;
$$;

create table if not exists public.transaction_references (
  reference text primary key check (reference ~ '^TRUST-[A-Z]{3}-[A-HJ-NP-Z2-9]{8}$'),
  kind text not null check (kind in ('top_up', 'withdrawal', 'order_payment', 'promotion_payment', 'refund', 'pro_vendor')),
  owner_id uuid references public.profiles(id) on delete set null,
  subject_id uuid,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_transaction_references_owner on public.transaction_references (owner_id, created_at desc);

alter table public.transaction_references enable row level security;
revoke all on public.transaction_references from anon, authenticated;
grant select on public.transaction_references to authenticated;

drop policy if exists "Users view own transaction references" on public.transaction_references;
create policy "Users view own transaction references" on public.transaction_references
  for select using (owner_id = auth.uid() or public.is_admin());

-- For edge functions (service role) and the issuing RPCs below.
create or replace function public.new_transaction_reference(
  p_kind text,
  p_owner_id uuid default null,
  p_subject_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := case p_kind
    when 'top_up' then 'TOP'
    when 'withdrawal' then 'PAY'
    when 'order_payment' then 'ORD'
    when 'promotion_payment' then 'PRM'
    when 'refund' then 'RFD'
    when 'pro_vendor' then 'VND'
  end;
  v_reference text;
begin
  if v_code is null then
    raise exception 'Unknown transaction kind: %', p_kind;
  end if;

  loop
    v_reference := 'TRUST-' || v_code || '-' || private.random_reference_suffix();
    insert into public.transaction_references (reference, kind, owner_id, subject_id)
    values (v_reference, p_kind, p_owner_id, p_subject_id)
    on conflict (reference) do nothing;
    exit when found;
  end loop;

  return v_reference;
end;
$$;

revoke execute on function public.new_transaction_reference(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.new_transaction_reference(text, uuid, uuid) to service_role;

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

  return public.new_transaction_reference('order_payment', v_buyer_id, p_offer_id);
end;
$$;

revoke execute on function public.issue_order_payment_reference(uuid) from public, anon;
grant execute on function public.issue_order_payment_reference(uuid) to authenticated;

-- Backstop against one Paystack payment creating two orders.
create unique index if not exists orders_paystack_reference_key
  on public.orders (paystack_reference)
  where paystack_reference is not null;
