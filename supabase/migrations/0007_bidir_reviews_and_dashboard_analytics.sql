-- Bi-directional review and seller analytics support

alter table public.profiles
  add column if not exists buyer_avg_rating numeric(3,2),
  add column if not exists buyer_review_count int not null default 0;

alter table public.reviews
  add column if not exists review_type text not null default 'buyer_to_seller' check (review_type in ('buyer_to_seller','seller_to_buyer')),
  add column if not exists reviewee_id uuid references public.profiles(id),
  add column if not exists buyer_id uuid references public.profiles(id),
  add column if not exists seller_id uuid references public.profiles(id);

alter table public.reviews drop constraint if exists reviews_order_id_key;
create unique index if not exists reviews_order_direction_unique
  on public.reviews(order_id, review_type);

update public.reviews set
  seller_id = coalesce(seller_id, (select seller_id from public.orders where id = order_id)),
  buyer_id = coalesce(buyer_id, (select buyer_id from public.orders where id = order_id)),
  reviewee_id = coalesce(reviewee_id, (select seller_id from public.orders where id = order_id)),
  review_type = 'buyer_to_seller'
where review_type is null;

create or replace function public.recalculate_buyer_stats(p_buyer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_buyer_reviews int;
  v_buyer_avg_rating numeric;
begin
  select count(*) into v_buyer_reviews from public.reviews where buyer_id = p_buyer_id and review_type = 'seller_to_buyer';
  select round(avg(rating), 2) into v_buyer_avg_rating from public.reviews where buyer_id = p_buyer_id and review_type = 'seller_to_buyer';

  update public.profiles
  set buyer_review_count = v_buyer_reviews,
      buyer_avg_rating = v_buyer_avg_rating
  where id = p_buyer_id;
end;
$$;

create or replace function public.recalculate_seller_stats(p_seller_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_review_count int;
  v_sales_volume numeric;
  v_verified boolean;
  v_new_level int;
begin
  select count(*) into v_review_count from public.reviews where seller_id = p_seller_id and review_type = 'buyer_to_seller';
  select coalesce(sum(amount), 0) into v_sales_volume from public.orders where seller_id = p_seller_id and status = 'confirmed';
  select verified_seller into v_verified from public.profiles where id = p_seller_id;

  v_new_level := case
    when not v_verified then 0
    when v_review_count >= 60 and v_sales_volume >= 500000 then 3
    when v_review_count >= 30 and v_sales_volume >= 200000 then 2
    else 1
  end;

  update public.profiles set
    completed_sales_count = (select count(*) from public.orders where seller_id = p_seller_id and status = 'confirmed'),
    total_sales_volume = v_sales_volume,
    avg_rating = (select round(avg(rating), 2) from public.reviews where seller_id = p_seller_id and review_type = 'buyer_to_seller'),
    seller_level = v_new_level
  where id = p_seller_id;
end;
$$;

create or replace function public.on_review_added()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.review_type = 'buyer_to_seller' then
    perform public.recalculate_seller_stats(new.seller_id);
  elsif new.review_type = 'seller_to_buyer' then
    perform public.recalculate_buyer_stats(new.buyer_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_on_review_added on public.reviews;
create trigger trg_on_review_added after insert on public.reviews for each row execute function public.on_review_added();

create or replace function public.on_review_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.review_type = 'buyer_to_seller' then
    perform public.recalculate_seller_stats(new.seller_id);
  elsif new.review_type = 'seller_to_buyer' then
    perform public.recalculate_buyer_stats(new.buyer_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_on_review_updated on public.reviews;
create trigger trg_on_review_updated after update on public.reviews for each row execute function public.on_review_updated();

alter table public.reviews enable row level security;

drop policy if exists "Buyers review only confirmed orders" on public.reviews;
drop policy if exists "Buyers review seller after confirmation" on public.reviews;
create policy "Buyers review seller after confirmation" on public.reviews for insert with check (
  reviewer_id = auth.uid()
  and review_type = 'buyer_to_seller'
  and exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid() and o.status = 'confirmed')
);

drop policy if exists "Sellers review buyer after confirmation" on public.reviews;
create policy "Sellers review buyer after confirmation" on public.reviews for insert with check (
  reviewer_id = auth.uid()
  and review_type = 'seller_to_buyer'
  and exists (select 1 from public.orders o where o.id = order_id and o.seller_id = auth.uid() and o.status = 'confirmed')
);

drop policy if exists "Users view their reviews" on public.reviews;
create policy "Users view their reviews" on public.reviews for select using (
  reviewer_id = auth.uid() or seller_id = auth.uid() or buyer_id = auth.uid() or public.is_admin() or true
);

drop policy if exists "Users update own reviews" on public.reviews;
create policy "Users update own reviews" on public.reviews for update using (reviewer_id = auth.uid() or public.is_admin()) with check (reviewer_id = auth.uid() or public.is_admin());
