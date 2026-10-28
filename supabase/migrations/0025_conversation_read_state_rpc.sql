create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  update public.conversations
  set buyer_last_read_at = case
        when buyer_id = current_user_id then now()
        else buyer_last_read_at
      end,
      seller_last_read_at = case
        when seller_id = current_user_id then now()
        else seller_last_read_at
      end
  where id = p_conversation_id
    and (buyer_id = current_user_id or seller_id = current_user_id);

  update public.messages
  set is_read = true,
      read_at = coalesce(read_at, now())
  where conversation_id = p_conversation_id
    and sender_id <> current_user_id
    and exists (
      select 1
      from public.conversations
      where id = p_conversation_id
        and (buyer_id = current_user_id or seller_id = current_user_id)
    );
end;
$$;

grant execute on function public.mark_conversation_read(uuid) to authenticated;
