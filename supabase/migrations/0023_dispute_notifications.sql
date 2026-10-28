-- Notify both order parties when a dispute is filed and carry a direct case link.

alter table public.notifications
  add column if not exists related_dispute_id uuid references public.disputes(id) on delete cascade;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'new_message', 'offer_received', 'offer_accepted', 'order_confirmed', 'delivery_confirmed',
  'payment_released', 'review_received', 'verification_decided', 'marketing', 'dispute_filed'
));

create or replace function public.notify_dispute_filed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_buyer_id uuid;
  v_seller_id uuid;
begin
  select buyer_id, seller_id into v_buyer_id, v_seller_id
  from public.orders where id = new.order_id;

  insert into public.notifications (recipient_id, type, title, message, related_order_id, related_dispute_id)
  select recipient_id, 'dispute_filed', 'Dispute filed',
    'A dispute has been filed for your order. Open the case to review and respond.', new.order_id, new.id
  from (values (v_buyer_id), (v_seller_id)) parties(recipient_id)
  where recipient_id is not null;
  return new;
end;
$$;

drop trigger if exists trg_notify_dispute_filed on public.disputes;
create trigger trg_notify_dispute_filed after insert on public.disputes
for each row execute function public.notify_dispute_filed();