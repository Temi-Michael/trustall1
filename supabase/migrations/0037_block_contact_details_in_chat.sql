-- Keep deals inside Trustall: chat messages and offers can't carry phone
-- numbers, emails, links, social handles or bank details, and chat images are
-- screened on the server before the other person can see them.

-- ---------------------------------------------------------------------------
-- 1. Text: refuse contact details in messages and offers.
-- ---------------------------------------------------------------------------
-- Returns why the text looks like contact details, or null when it's fine.
-- Phone and account numbers are 10+ digits, usually written in groups of up to
-- four ("0803 123 4567", "+234 803…", "0 8 0 3…", "zero eight zero…", "O8O3…").
-- Short groups joined by spaces, dashes or dots are counted together; a group
-- of five or more digits, or thousands written with commas ("1,500,000"), is
-- read as an amount, so prices and price ranges aren't blocked.
create or replace function public.chat_contact_violation(p_text text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := lower(coalesce(p_text, ''));
  v_words text[] := array['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  v_token text;
  v_run integer := 0;
  v_can_join boolean := false;
begin
  if v = '' then
    return null;
  end if;

  -- Emails, including "name at gmail dot com" and bare provider names.
  if v ~ '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+'
     or v ~ '[a-z0-9._%+-]+\s*(\(at\)|\[at\]|\sat\s)\s*[a-z0-9-]+\s*(\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}'
     or v ~ '\m(gmail|yahoo|ymail|hotmail|outlook|icloud|protonmail)\M' then
    return 'email';
  end if;

  -- Links and off-platform contact apps. Links to trustall.online are fine.
  if v ~ '(https?://|www\.)(?!(www\.)?trustall\.online)'
     or v ~ '\m(wa\.me|t\.me|fb\.me|m\.me|bit\.ly|linktr\.ee)\M'
     or v ~ '\m[a-z0-9-]+\.(com|net|org|ng|io|me|shop|store|link)\M'
     or v ~ '\m(whatsapp|whatsap|watsapp|watsap|wassap|wasap|telegram|instagram|insta|facebook|tiktok|snapchat|twitter)\M'
     or v ~ '(^|[^a-z0-9_.])@[a-z0-9_.]{3,}' then
    return 'external_contact';
  end if;

  -- Bank details by name.
  if v ~ '\m(acct|acc no|account (no|num|number|name|details)|bvn|nuban|sort code|routing number)\M'
     or v ~ '(^|[^a-z])a/c([^a-z]|$)' then
    return 'bank_details';
  end if;

  -- Phone and account numbers. Undo disguises first: spelled-out digits, the
  -- letter o next to a digit, and thousands commas (so "1,500,000" is one group).
  for i in 1 .. array_length(v_words, 1) loop
    v := regexp_replace(v, '\m' || v_words[i] || '\M', (i - 1)::text, 'g');
  end loop;
  v := regexp_replace(v, '(?<=\d)o|o(?=\d)', '0', 'g');
  v := regexp_replace(v, '(?<=\d)o|o(?=\d)', '0', 'g');
  v := regexp_replace(v, '(\d),(?=\d{3}(\D|$))', '\1', 'g');

  for v_token in select (regexp_matches(v, '\d+|\D+', 'g'))[1] loop
    if v_token ~ '^\d+$' then
      if length(v_token) >= 10 then
        return 'phone_or_account_number';
      elsif length(v_token) <= 4 then
        v_run := case when v_can_join then v_run else 0 end + length(v_token);
        if v_run >= 10 then
          return 'phone_or_account_number';
        end if;
        v_can_join := true;
      else
        v_run := 0;
        v_can_join := false;
      end if;
    else
      -- Short separators (spaces, dashes, dots, brackets, a leading +) keep a
      -- number going; words or anything longer end it.
      if not (v_can_join and v_token ~ '^[[:space:].\-_()/\\+*|:#~]{1,3}$') then
        v_run := 0;
        v_can_join := false;
      end if;
    end if;
  end loop;

  return null;
end;
$$;

-- Applied to text written by signed-in people (including through RPCs such as
-- edit_message). System writes with no signed-in user are not checked.
create or replace function public.block_contact_details()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_column text;
  v_reason text;
begin
  if auth.uid() is null then
    return new;
  end if;

  foreach v_column in array tg_argv loop
    v_reason := public.chat_contact_violation(to_jsonb(new) ->> v_column);
    if v_reason is not null then
      raise exception 'For your safety, phone numbers, emails, links and bank details can''t be shared in chat. Keep payments and contact inside Trustall.'
        using errcode = 'TC001', detail = v_reason;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_block_contact_details on public.messages;
create trigger trg_block_contact_details
  before insert or update of body on public.messages
  for each row execute function public.block_contact_details('body');

drop trigger if exists trg_block_contact_details on public.offers;
create trigger trg_block_contact_details
  before insert or update of item_title, item_description on public.offers
  for each row execute function public.block_contact_details('item_title', 'item_description');

-- ---------------------------------------------------------------------------
-- 2. Images: uploads wait in a holding folder only the sender can see.
-- ---------------------------------------------------------------------------
-- Uploads go to <conversation_id>/pending/<sender_id>/<file>. The
-- screen-chat-image server function checks each one and moves clean files to
-- <conversation_id>/<file>, where both people in the conversation can see them.
drop policy if exists "Participants read chat media" on storage.objects;
drop policy if exists "Participants upload chat media" on storage.objects;
drop policy if exists "Participants update chat media" on storage.objects;
drop policy if exists "Participants delete chat media" on storage.objects;

create policy "Participants read chat media" on storage.objects
  for select using (
    bucket_id = 'message-attachments'
    and (
      public.is_admin()
      or (
        public.is_conversation_participant((storage.foldername(name))[1])
        and ((storage.foldername(name))[2] is distinct from 'pending' or (storage.foldername(name))[3] = auth.uid()::text)
      )
    )
  );

create policy "Participants upload chat media" on storage.objects
  for insert with check (
    bucket_id = 'message-attachments'
    and public.is_conversation_participant((storage.foldername(name))[1])
    and (storage.foldername(name))[2] = 'pending'
    and (storage.foldername(name))[3] = auth.uid()::text
  );

create policy "Participants update chat media" on storage.objects
  for update using (
    bucket_id = 'message-attachments'
    and public.is_conversation_participant((storage.foldername(name))[1])
    and (storage.foldername(name))[2] = 'pending'
    and (storage.foldername(name))[3] = auth.uid()::text
  ) with check (
    bucket_id = 'message-attachments'
    and public.is_conversation_participant((storage.foldername(name))[1])
    and (storage.foldername(name))[2] = 'pending'
    and (storage.foldername(name))[3] = auth.uid()::text
  );

create policy "Participants delete chat media" on storage.objects
  for delete using (
    bucket_id = 'message-attachments'
    and (
      public.is_admin()
      or (
        public.is_conversation_participant((storage.foldername(name))[1])
        and ((storage.foldername(name))[2] is distinct from 'pending' or (storage.foldername(name))[3] = auth.uid()::text)
      )
    )
  );

-- Attachment records are written only by screen-chat-image, so a browser can't
-- attach an unscreened file.
drop policy if exists "Participants insert message attachments" on public.message_attachments;
