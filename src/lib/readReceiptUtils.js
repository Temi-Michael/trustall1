import { supabase } from "./supabaseClient";

export async function markConversationRead(conversationId) {
  try {
    const { error } = await supabase.rpc("mark_conversation_read", {
      p_conversation_id: conversationId,
    });
    if (error) throw error;
    window.dispatchEvent(new CustomEvent('trustall:conversation-read', { detail: { conversationId } }));
  } catch (err) {
    console.error("Failed to mark conversation as read:", err);
  }
}

export function subscribeToMessageReadUpdates(conversationId, callback) {
  const channel = supabase
    .channel(`messages-read-${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        callback(payload.new);
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

export function subscribeToNewMessages(conversationId, callback) {
  const channel = supabase
    .channel(`messages-insert-${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        callback(payload.new);
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}
