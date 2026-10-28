-- Add missing notifications for offer creation and order confirmation

-- Trigger for when a new offer is created (offer_received for seller)
create or replace function public.notify_offer_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid;
  v_buyer_id uuid;
  v_buyer_name text;
  v_title text;
  v_conversation_id uuid;
begin
  -- Get conversation details
  select c.seller_id, c.buyer_id, coalesce(p.business_name, p.full_name, 'User'), l.title, c.id
    into v_seller_id, v_buyer_id, v_buyer_name, v_title, v_conversation_id
  from public.conversations c
  join public.profiles p on p.id = c.buyer_id
  join public.listings l on l.id = c.listing_id
  where c.id = new.conversation_id;

  -- Insert notification for seller
  if v_seller_id is not null then
    insert into public.notifications (
      recipient_id,
      sender_id,
      type,
      title,
      message,
      related_conversation_id,
      related_offer_id,
      created_at
    ) values (
      v_seller_id,
      v_buyer_id,
      'offer_received',
      v_buyer_name || ' made an offer',
      v_buyer_name || ' sent an offer for ' || v_title,
      v_conversation_id,
      new.id,
      now()
    );
  end if;

  return new;
end;
$$;

-- Trigger for new offers
drop trigger if exists trg_on_new_offer on public.offers;
create trigger trg_on_new_offer
  after insert on public.offers
  for each row
  execute function public.notify_offer_received();

-- Improved order confirmation notification
create or replace function public.notify_order_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid;
  v_seller_id uuid;
  v_title text;
  v_conversation_id uuid;
begin
  if tg_op = 'UPDATE' and new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    select o.buyer_id, o.seller_id, ofr.item_title, ofr.conversation_id
      into v_buyer_id, v_seller_id, v_title, v_conversation_id
    from public.orders o
    join public.offers ofr on ofr.id = o.offer_id
    where o.id = new.id;

    if v_seller_id is not null then
      insert into public.notifications (
        recipient_id,
        sender_id,
        type,
        title,
        message,
        related_order_id,
        related_conversation_id,
        created_at
      )
      select
        v_seller_id,
        v_buyer_id,
        'order_confirmed',
        'Order confirmed',
        'Buyer confirmed receipt of ' || v_title || '. Payment released to your wallet.',
        new.id,
        v_conversation_id,
        now()
      where not exists (
        select 1 from public.notifications n
        where n.recipient_id = v_seller_id
          and n.related_order_id = new.id
          and n.type = 'order_confirmed'
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_order_confirmed on public.orders;
create trigger trg_notify_order_confirmed
  after update on public.orders
  for each row
  execute function public.notify_order_confirmed();

-- Ensure notifications table is published for real-time. Postgres has no
-- ADD TABLE IF NOT EXISTS, so check first.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
