-- A listing is the first seller opt-in in the current onboarding flow.
-- Keep the profile flag consistent for every listing insert, regardless of client.

create or replace function public.mark_profile_as_seller_on_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set is_seller = true
  where id = new.seller_id
    and is_seller is distinct from true;

  return new;
end;
$$;

drop trigger if exists trg_mark_profile_as_seller_on_listing on public.listings;
create trigger trg_mark_profile_as_seller_on_listing
  after insert on public.listings
  for each row
  execute function public.mark_profile_as_seller_on_listing();