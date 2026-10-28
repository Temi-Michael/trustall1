-- Refunds and reversals must point at the payment they undo (TRUST-ORD-..., or a
-- pre-ledger trustall_... Paystack reference), so every money movement can be
-- traced back to its original transaction.

alter table public.transaction_references
  add column if not exists original_reference text;

alter table public.transaction_references drop constraint if exists transaction_references_kind_check;
alter table public.transaction_references add constraint transaction_references_kind_check
  check (kind in ('top_up', 'withdrawal', 'order_payment', 'promotion_payment', 'refund', 'reversal', 'pro_vendor'));

alter table public.transaction_references drop constraint if exists transaction_references_original_required;
alter table public.transaction_references add constraint transaction_references_original_required
  check ((kind in ('refund', 'reversal')) = (original_reference is not null));

create index if not exists idx_transaction_references_original
  on public.transaction_references (original_reference)
  where original_reference is not null;

drop function if exists public.new_transaction_reference(text, uuid, uuid);

create or replace function public.new_transaction_reference(
  p_kind text,
  p_owner_id uuid default null,
  p_subject_id uuid default null,
  p_original_reference text default null
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
    when 'reversal' then 'REV'
    when 'pro_vendor' then 'VND'
  end;
  v_reference text;
begin
  if v_code is null then
    raise exception 'Unknown transaction kind: %', p_kind;
  end if;
  if p_kind in ('refund', 'reversal') and nullif(trim(p_original_reference), '') is null then
    raise exception 'A % must reference the original transaction', p_kind;
  end if;

  loop
    v_reference := 'TRUST-' || v_code || '-' || private.random_reference_suffix();
    insert into public.transaction_references (reference, kind, owner_id, subject_id, original_reference)
    values (
      v_reference, p_kind, p_owner_id, p_subject_id,
      case when p_kind in ('refund', 'reversal') then trim(p_original_reference) end
    )
    on conflict (reference) do nothing;
    exit when found;
  end loop;

  return v_reference;
end;
$$;

revoke execute on function public.new_transaction_reference(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.new_transaction_reference(text, uuid, uuid, text) to service_role;
