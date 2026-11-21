-- Chat photos and videos appear for the other person without reopening the chat.
--
-- A photo message is saved first (with no text), and its photo is attached a
-- few seconds later, once screen-chat-image has checked it. The other person's
-- open chat refreshed for the message but heard nothing about the photo, so it
-- showed "Photo or video unavailable" until they reopened the chat.
--
-- Publishing message_attachments lets the open chat hear about new photos.
-- Realtime applies the existing "Participants view message attachments" rule
-- to each listener, so people only hear about photos in their own chats.
-- Postgres has no ADD TABLE IF NOT EXISTS, so check first.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_attachments'
  ) then
    alter publication supabase_realtime add table public.message_attachments;
  end if;
end $$;
