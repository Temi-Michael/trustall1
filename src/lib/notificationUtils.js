import { supabase } from "./supabaseClient.js";

export { getNotificationDisplayTitle, getNotificationBadgeSummary } from "./notificationFormat.js";

/**
 * Get unread notification count for a user
 */
export async function getUnreadNotificationCount(userId) {
  try {
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", userId)
      .is("read_at", null);
    
    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error("Failed to get unread notification count:", error);
    return 0;
  }
}

/**
 * Fetch unread notifications for a user
 */
export async function fetchNotifications(userId, limit = 20) {
  try {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("recipient_id", userId)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Failed to fetch notifications:", error);
    return [];
  }
}

/**
 * Mark a single notification as read
 */
export async function markNotificationRead(notificationId) {
  try {
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId);
    
    if (error) throw error;
  } catch (err) {
    console.error("Failed to mark notification as read:", err);
  }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsRead(userId) {
  try {
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", userId)
      .is("read_at", null);
    
    if (error) throw error;
  } catch (err) {
    console.error("Failed to mark all notifications as read:", err);
  }
}

export async function markConversationNotificationsRead(userId, conversationId) {
  if (!userId || !conversationId) return;

  try {
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", userId)
      .eq("related_conversation_id", conversationId)
      .is("read_at", null);

    if (error) throw error;
  } catch (err) {
    console.error("Failed to mark conversation notifications as read:", err);
  }
}

/**
 * Subscribe to new notifications in real-time
 * Returns an unsubscribe function
 */
export function subscribeToNotifications(userId, callback) {
  if (!userId) {
    console.warn("subscribeToNotifications called with no userId");
    return () => {};
  }

  try {
    const channel = supabase.channel(`notifications-${userId}`);
    
    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `recipient_id=eq.${userId}`,
      },
      (payload) => {
        console.log("New notification received:", payload);
        
        // Only process unread notifications
        if (!payload.new || payload.new.read_at) return;
        
        // Call the callback with the new notification
        callback(payload.new);
      }
    );

    channel.subscribe((status) => {
      console.log("Notification subscription status:", status);
      if (status === "SUBSCRIBED") {
        console.log("Connected to notifications channel");
      } else if (status === "CLOSED") {
        console.log("Notifications channel closed");
      } else if (status === "CHANNEL_ERROR") {
        console.error("Notification channel error");
      }
    });

    return () => {
      console.log("Unsubscribing from notifications channel");
      supabase.removeChannel(channel);
    };
  } catch (err) {
    console.error("Failed to subscribe to notifications:", err);
    return () => {};
  }
}

/**
 * Format relative time for notification display
 * e.g., "just now", "5m ago", "2h ago", "1d ago"
 */
export function formatRelativeTime(dateString) {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
  } catch (error) {
    console.error("Failed to format time:", error);
    return dateString;
  }
}

/**
 * Get the appropriate route/URL for a notification based on its type
 * This is used for deep linking when notifications are clicked
 */
export function getNotificationRoute(notification) {
  if (!notification) return "/";

  const { type, related_conversation_id, related_order_id, related_offer_id, related_dispute_id } = notification;

  switch (type) {
    // Message notifications
    case "new_message":
    case "offer_received":
    case "offer_accepted":
    case "delivery_address_shared":
      return related_conversation_id ? `/messages/${related_conversation_id}` : "/messages";

    // Order notifications
    case "payment_pending":
    case "payment_released":
    case "delivered":
    case "order_confirmed":
    case "delivery_confirmed":
    case "order_status_updated":
      return related_order_id ? `/orders/${related_order_id}` : "/orders";

    // Review notifications
    case "review_received":
      return related_order_id ? `/orders/${related_order_id}` : "/orders";

    // Verification notifications
    case "verification_decided":
      return "/sell";

    // Dispute notifications
    case "dispute_filed":
    case "dispute_created":
    case "dispute_message":
    case "dispute_resolved":
      return related_dispute_id ? `/disputes/${related_dispute_id}` : "/disputes";

    // Payout notifications
    case "payout_initiated":
    case "payout_completed":
      return "/orders";

    // Default to home
    default:
      return "/";
  }
}

/**
 * Send a push notification via Firebase Cloud Messaging
 * This is typically done server-side, but can be used for testing
 */
export async function sendPushNotification(title, body, options = {}) {
  try {
    // This would typically be done server-side via Supabase Functions
    // For now, just show a browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: '/icon.svg',
        ...options,
      });
    }
  } catch (error) {
    console.error("Failed to send push notification:", error);
  }
}

/**
 * Get notification icon based on type
 * Used for displaying appropriate emoji/icon in notification list
 */
export function getNotificationIcon(type) {
  const icons = {
    new_message: "💬",
    offer_received: "🏷️",
    offer_accepted: "✅",
    payment_pending: "⏳",
    payment_released: "💰",
    delivered: "📦",
    order_confirmed: "✓",
    delivery_confirmed: "🚚",
    review_received: "⭐",
    verification_decided: "✅",
    dispute_created: "⚠️",
    dispute_message: "💬",
    dispute_resolved: "✅",
    payout_initiated: "💸",
    payout_completed: "💰",
  };
  
  return icons[type] || "🔔";
}
