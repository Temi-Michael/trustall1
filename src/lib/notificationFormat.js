// Pure notification helpers, kept free of the Supabase client so they can be
// unit-tested in Node (the client needs Vite's import.meta.env).

export function getNotificationDisplayTitle(notification, senderName) {
  if (!notification) return 'Notification';

  if (notification.type === 'new_message') {
    const resolvedSenderName = String(senderName || notification.sender_name || 'someone').trim();
    return resolvedSenderName ? `New message from ${resolvedSenderName}` : 'New message';
  }

  return notification.title || 'New update';
}

export function getNotificationBadgeSummary(notifications = []) {
  return (notifications || []).reduce((summary, notification) => {
    if (!notification) return summary;

    if (notification.type === 'new_message') {
      summary.message += 1;
    } else if (
      ['payment_pending', 'payment_released', 'delivered', 'order_confirmed', 'delivery_confirmed', 'order_status_updated', 'payout_initiated', 'payout_completed'].includes(notification.type)
      || notification.type.startsWith('order')
    ) {
      summary.order += 1;
    } else {
      summary.other += 1;
    }

    return summary;
  }, { message: 0, order: 0, other: 0 });
}
