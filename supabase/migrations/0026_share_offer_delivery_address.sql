alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'new_message', 'offer_received', 'offer_accepted', 'order_confirmed', 'delivery_confirmed',
  'payment_released', 'review_received', 'verification_decided', 'marketing', 'dispute_filed',
  'delivery_address_shared'
));

create or replace function public.share_offer_delivery_address(
  p_offer_id uuid,
  p_delivery_address text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid;
  v_seller_id uuid;
  v_conversation_id uuid;
  v_item_title text;
  v_offer_status text;
  v_delivery_address text := nullif(trim(p_delivery_address), '');
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to share delivery details.';
  end if;

  if v_delivery_address is null or char_length(v_delivery_address) > 500 then
    raise exception 'Enter a delivery address of no more than 500 characters.';
  end if;

  select c.buyer_id, c.seller_id, c.id, o.item_title, o.status
    into v_buyer_id, v_seller_id, v_conversation_id, v_item_title, v_offer_status
  from public.offers o
  join public.conversations c on c.id = o.conversation_id
  where o.id = p_offer_id
  for update of o;

  if not found or v_buyer_id <> auth.uid() then
    raise exception 'This offer is not available to your account.';
  end if;

  if v_offer_status <> 'pending' then
    raise exception 'Delivery details can only be changed for a pending offer.';
  end if;

  update public.offers
  set delivery_address = v_delivery_address
  where id = p_offer_id;

  insert into public.notifications (
    recipient_id,
    sender_id,
    type,
    title,
    message,
    related_conversation_id,
    related_offer_id
  ) values (
    v_seller_id,
    v_buyer_id,
    'delivery_address_shared',
    'Delivery address shared',
    'The buyer shared delivery details for ' || v_item_title || '. Open the conversation to view them.',
    v_conversation_id,
    p_offer_id
  );
end;
$$;

revoke all on function public.share_offer_delivery_address(uuid, text) from public;
grant execute on function public.share_offer_delivery_address(uuid, text) to authenticated;