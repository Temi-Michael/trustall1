-- Chat messages can't be edited or deleted once sent.
--
-- Buyers and sellers agree prices and terms in chat. Being able to edit or
-- delete a message afterwards (the live-only edit_message and delete_message
-- functions, within 5 minutes) let either side change what was agreed, which
-- causes disputes nobody can settle. Offers are already fixed once sent (0036
-- removed their update rule; a seller who wants a different price sends a new
-- offer), so after this the whole conversation is a reliable record.
--
-- Not affected: sending messages, read receipts (mark_conversation_read runs
-- with elevated rights), image screening (screen-chat-image uses the service
-- role) and admins, who can still remove messages for moderation.

-- ---------------------------------------------------------------------------
-- 1. No direct edits or deletes through the API
-- ---------------------------------------------------------------------------
revoke update, delete on public.messages from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The live-only edit/delete functions stop working
-- ---------------------------------------------------------------------------
-- They exist only on the live database (issue 6.5), so their exact arguments
-- aren't known here: revoke every version of them that exists.
do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('edit_message', 'delete_message')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_function);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Safety net: refuse changes even if a rule or grant is added later
-- ---------------------------------------------------------------------------
-- Ordinary users (anon/authenticated) can't change a message's text or delete
-- it. Functions with elevated rights, the service role and admins can.
create or replace function public.keep_sent_messages_unchanged()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin() then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Messages can''t be deleted once sent' using errcode = '42501';
  end if;
  if new.body is distinct from old.body then
    raise exception 'Messages can''t be edited once sent' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_keep_sent_messages_unchanged on public.messages;
create trigger trg_keep_sent_messages_unchanged
  before update or delete on public.messages
  for each row execute function public.keep_sent_messages_unchanged();
