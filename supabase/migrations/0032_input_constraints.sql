-- Database-side input limits, so bad or hostile values are refused no matter
-- which client sends them. Constraints are NOT VALID: they apply to new and
-- edited rows without failing on old data. Tables or columns that only exist on
-- some databases are skipped when missing.

create schema if not exists private;

create or replace function private.add_check(p_table text, p_name text, p_check text, p_columns text[])
returns void
language plpgsql
set search_path = public
as $$
begin
  if to_regclass('public.' || p_table) is null
     or exists (select 1 from pg_constraint where conname = p_name and conrelid = ('public.' || p_table)::regclass)
     or exists (
       select 1 from unnest(p_columns) as c(name)
       where not exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = p_table and column_name = c.name
       )
     ) then
    return;
  end if;
  -- %I quotes identifiers; p_check comes from this file only, never from users.
  execute format('alter table public.%I add constraint %I check (%s) not valid', p_table, p_name, p_check);
end;
$$;

-- Money: no negative amounts, and no NaN (Postgres sorts NaN above every number).
select private.add_check('listings', 'listings_price_valid', 'price >= 0 and price <> ''NaN''', array['price']);
select private.add_check('offers', 'offers_price_valid', 'price >= 0 and price <> ''NaN''', array['price']);
select private.add_check('offers', 'offers_delivery_fee_valid', 'delivery_fee >= 0 and delivery_fee <> ''NaN''', array['delivery_fee']);

-- Text length caps (generous; they stop oversized payloads, not normal use).
select private.add_check('listings', 'listings_title_length', 'char_length(title) between 1 and 200', array['title']);
select private.add_check('listings', 'listings_description_length', 'char_length(description) <= 20000', array['description']);
select private.add_check('offers', 'offers_item_title_length', 'char_length(item_title) between 1 and 200', array['item_title']);
select private.add_check('offers', 'offers_item_description_length', 'char_length(item_description) <= 5000', array['item_description']);
select private.add_check('messages', 'messages_body_length', 'char_length(body) <= 5000', array['body']);
select private.add_check('reviews', 'reviews_comment_length', 'char_length(comment) <= 2000', array['comment']);
select private.add_check('disputes', 'disputes_reason_length', 'char_length(reason) between 1 and 5000', array['reason']);
select private.add_check('blog_posts', 'blog_posts_title_length', 'char_length(title) between 1 and 300', array['title']);
select private.add_check('verification_requests', 'verification_legal_name_length', 'char_length(legal_name) between 1 and 200', array['legal_name']);
select private.add_check('profiles', 'profiles_full_name_length', 'char_length(full_name) <= 120', array['full_name']);
select private.add_check('profiles', 'profiles_business_name_length', 'char_length(business_name) <= 120', array['business_name']);
select private.add_check('profiles', 'profiles_bio_length', 'char_length(bio) <= 1000', array['bio']);
select private.add_check('profiles', 'profiles_handle_length', 'char_length(handle) <= 60', array['handle']);
select private.add_check('profiles', 'profiles_state_length', 'char_length(state) <= 60', array['state']);

-- Phone numbers: digits with optional +, spaces, dashes and brackets.
select private.add_check('profile_contacts', 'profile_contacts_phone_format', 'phone ~ ''^\+?[0-9 ()-]{7,20}$''', array['phone']);

drop function private.add_check(text, text, text, text[]);

-- Storage: size and type limits enforced by Supabase on upload.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/*'] where id = 'avatars';
    update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['image/*'] where id in ('listing-images', 'blog-images');
    update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['image/*', 'application/pdf'] where id = 'verification-docs';
    update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array['image/*', 'video/*'] where id = 'message-attachments';
    update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array['image/*', 'video/*', 'application/pdf'] where id = 'dispute-evidence';
  end if;
end $$;
