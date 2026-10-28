# Quick Reference: Real-Time Features API

## 🎯 Quick Copy-Paste Examples

### Show User Online Status

```jsx
import {
  isOnline,
  formatLastSeen,
  subscribeToUserPresence,
} from "../lib/presenceUtils";

export function UserStatus({ userId, userProfile }) {
  const [profile, setProfile] = useState(userProfile);

  useEffect(() => {
    const unsubscribe = subscribeToUserPresence(userId, (updatedProfile) => {
      setProfile(updatedProfile);
    });
    return unsubscribe;
  }, [userId]);

  return (
    <div>
      {isOnline(profile.last_seen_at) ? (
        <span className="text-green-500">🟢 Online</span>
      ) : (
        <span className="text-gray-400">
          Last seen {formatLastSeen(profile.last_seen_at)}
        </span>
      )}
    </div>
  );
}
```

### Display Read Receipt Status

```jsx
import { getMessageReadStatus } from "../lib/readReceiptUtils";

function MessageBubble({ message, isMine }) {
  const { icon, status } = getMessageReadStatus(message);

  return (
    <div>
      <p>{message.body}</p>
      {isMine && <span className="text-xs">{icon}</span>}
    </div>
  );
}
```

### Fetch Notifications Programmatically

```jsx
import {
  fetchNotifications,
  getUnreadNotificationCount,
} from "../lib/notificationUtils";

async function loadNotifications() {
  const count = await getUnreadNotificationCount(userId);
  const notifications = await fetchNotifications(userId, 50); // 50 most recent

  console.log(`${count} unread of ${notifications.length} total`);
  return { count, notifications };
}
```

### Format Notification Time

```jsx
import { formatRelativeTime } from "../lib/notificationUtils";

export function NotificationItem({ notification }) {
  return (
    <div>
      <h4>{notification.title}</h4>
      <p className="text-xs text-gray-500">
        {formatRelativeTime(notification.created_at)}
      </p>
    </div>
  );
}
```

### Subscribe to New Notifications

```jsx
import { subscribeToNotifications } from "../lib/notificationUtils";

export function NotificationListener() {
  useEffect(() => {
    const unsubscribe = subscribeToNotifications(userId, (newNotification) => {
      console.log("New notification:", newNotification);
      // Show toast, play sound, etc.
    });
    return unsubscribe;
  }, [userId]);

  return null;
}
```

### Mark Notification as Read

```jsx
import {
  markNotificationRead,
  markAllNotificationsRead,
} from "../lib/notificationUtils";

async function handleNotificationClick(notificationId) {
  await markNotificationRead(notificationId);
}

async function handleMarkAllRead() {
  await markAllNotificationsRead(userId);
}
```

---

## 📁 New Files Location

```
src/
├── lib/
│   ├── firebaseConfig.js              ← Firebase setup (VAPID key, messaging)
│   ├── useRegisterPush.js             ← Push token registration
│   ├── presenceUtils.js               ← Online status tracking
│   ├── readReceiptUtils.js            ← Message read status
│   └── notificationUtils.js           ← Notification fetching & formatting
├── components/
│   └── NotificationBell.jsx           ← Notification bell UI component
└── App.jsx                            ← Global setup (presence + push + foreground)

public/
└── firebase-messaging-sw.js           ← Service worker for background notifications
```

---

## 🔌 Available Functions

### presenceUtils.js

```javascript
export async function startPresenceTracking(userId)
// Start 30-sec interval to update last_seen_at, respects page visibility

export async function updateLastSeen()
// Manually call update_last_seen() RPC

export function stopPresenceTracking()
// Stop the tracking interval

export function formatLastSeen(lastSeenAt)
// Returns: "Online" | "5m ago" | "2h ago" | "3d ago"

export function isOnline(lastSeenAt)
// Returns: boolean (true if < 60 seconds ago)

export function subscribeToUserPresence(userId, callback)
// Returns: unsubscribe function
```

### readReceiptUtils.js

```javascript
export async function markConversationRead(conversationId)
// Marks all messages from other user as read

export function getMessageReadStatus(message)
// Returns: { status, icon } → "sending"/"delivered"/"seen"

export function subscribeToMessageReadUpdates(conversationId, callback)
// Real-time updates when messages are read
// Returns: unsubscribe function

export function subscribeToNewMessages(conversationId, callback)
// Real-time updates when new messages inserted
// Returns: unsubscribe function
```

### notificationUtils.js

```javascript
export async function getUnreadNotificationCount(userId)
// Returns: number of unread notifications

export async function fetchNotifications(userId, limit = 20)
// Returns: array of notification objects, newest first

export async function markNotificationRead(notificationId)
// Sets read_at to now()

export async function markAllNotificationsRead(userId)
// Sets read_at for all unread notifications

export function subscribeToNotifications(userId, callback)
// Real-time INSERT events for new notifications
// Returns: unsubscribe function

export function formatRelativeTime(dateString)
// Returns: "just now" | "5m ago" | "2h ago" | "3d ago"

export function getNotificationRoute(notification)
// Returns: route string based on notification type

export function getNotificationIcon(type)
// Returns: emoji icon for notification type
```

### useRegisterPush.js

```javascript
export async function registerPushToken(userId)
// Called automatically in App.jsx on login
// Requests notification permission, registers service worker, stores FCM token
```

### NotificationBell.jsx

```jsx
<NotificationBell userId={session.user.id} />
// Self-contained component, renders bell icon + dropdown
// Pass current userId, handles everything else
```

---

## 🎨 Styling Classes Used

NotificationBell uses Tailwind classes matching your design system:

- Colors: `seal`, `marigold-deep`, `text-ink`, `text-muted`, `bg-surfacealt`
- Sizing: `h-5 w-5` (icon), `max-h-96` (dropdown), `w-80` (dropdown width)
- Radius: `rounded-full`, `rounded-xl`, `rounded-lg`

Customize in `src/components/NotificationBell.jsx` if needed.

---

## 💾 Local Storage & Caching

No local storage is used. All data is:

- Fetched fresh from Supabase on component mount
- Updated in real-time via subscriptions
- Cached in React state only

Optional: Implement local caching if notifications frequently timeout.

---

## 🔐 Permission Handling

### Notification Permission

- Requested once per user (browser remembers choice)
- User can change in browser settings anytime
- App continues normally if denied

Check permission status:

```javascript
const permission = await Notification.requestPermission();
if (permission === "granted") {
  // Can show notifications
}
```

---

## 🧪 Development Testing

### Test Push Notifications

1. Open DevTools → Application → Service Workers
2. Verify `firebase-messaging-sw.js` is registered
3. Send from Firestore Admin SDK or curl:

```bash
curl -X POST https://fcm.googleapis.com/v1/projects/trustall-technology-limited/messages:send \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "token": "FCM_TOKEN_HERE",
      "notification": {
        "title": "Test",
        "body": "Test message"
      }
    }
  }'
```

### Test Presence

1. Query: `SELECT id, last_seen_at FROM profiles WHERE id = current_user_id`
2. Refresh page, wait 30 seconds
3. `last_seen_at` should update

### Test Read Receipts

1. Send message
2. Query: `SELECT id, delivered_at, read_at FROM messages WHERE id = message_id`
3. `delivered_at` should be set
4. Open conversation on other account
5. Query again – `read_at` should now be set

---

## ⚡ Performance Notes

- **Presence tracking:** 1 RPC call every 30 seconds per logged-in user (minimal)
- **Subscriptions:** 4 total per app (presence, messages, notifications, read updates)
- **Badge count:** Fetched on mount only, not re-fetched (updates via subscription)
- **Notification dropdown:** Max 20 most recent fetched (limit adjustable in NotificationBell)

All efficient and production-ready for typical usage.

---

## 🚀 Next Steps

1. **Test each feature** using the examples above
2. **Customize routing** in `getNotificationRoute()` if needed
3. **Integrate with toast system** in foreground message handler
4. **Add sound/vibration** to push notifications
5. **Add notification history** persistence if needed

---

## 📞 Common Issues & Solutions

| Issue               | Solution                                                |
| ------------------- | ------------------------------------------------------- |
| Bell not showing    | Check if `session` exists (only renders when logged in) |
| No unread count     | Verify notifications table exists and RLS allows reads  |
| Status not updating | Check subscriptions are active in DevTools              |
| Push not showing    | Check service worker registration in DevTools           |
| Read receipts stuck | Verify backend is setting `read_at` column              |
