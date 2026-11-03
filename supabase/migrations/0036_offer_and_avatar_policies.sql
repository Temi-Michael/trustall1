-- Close two over-broad update rules.

-- Offers: sellers could edit any column of their own offers, with no check on
-- the result, so they could move an offer into someone else's conversation or
-- change the price while a buyer was paying. The app never edits offers
-- directly: delivery details go through share_offer_delivery_address and
-- acceptance through the payment server, both of which bypass this rule. A
-- seller who wants a different price sends a new offer.
drop policy if exists "Sellers update own offers" on public.offers;

-- Avatars: the update rule checked the old path only, so a file could be
-- renamed into another user's folder.
drop policy if exists "Users update own avatars" on storage.objects;
create policy "Users update own avatars" on storage.objects
  for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
