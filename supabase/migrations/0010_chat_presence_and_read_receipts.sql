alter table public.messages
  add column if not exists is_read boolean not null default false,
  add column if not exists read_at timestamptz;

create index if not exists idx_messages_conversation_read
  on public.messages (conversation_id, sender_id, is_read, read_at);

-- 0001 already publishes messages; adding it twice is an error.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
