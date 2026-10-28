# Trustall Notification System - Debugging Guide

## What Was Fixed ✅

### 1. Backend Fixes

- **Added missing notification trigger for offer creation** - When a seller receives a new offer, a notification is now inserted into the notifications table
- **Added order confirmation notification** - When a buyer confirms receipt, the seller now gets a notification
- **Ensured notifications table is published for real-time** - The notifications table is now exposed in the Supabase real-time publication

### 2. Frontend Fixes

- **Notification permission requested on app load** - Instead of only when visiting Messages page
- **Improved service worker registration** - Added fallback logic and dev mode support with `updateViaCache: 'none'`
- **Enhanced Firebase token registration** - Better error handling and logging
- **Added error tracking to NotificationBell** - Component now logs and handles subscription errors
- **Improved real-time subscription** - Added console logging to track subscription lifecycle

## Testing Notification System

### Step 1: Verify Notification Permission

1. Open browser DevTools (F12)
2. Go to Settings tab → Permissions
3. Check "Notifications" permission
4. Reload the page - you should see a permission prompt
5. Click "Allow" to grant permission
6. Verify in DevTools Console that you see: `"Notification permission not granted"` → then `"Service worker registered successfully"`

### Step 2: Test Message Notifications (Desktop Browser)

1. Open two browser windows/tabs
2. In Tab A: Login as Seller
3. In Tab B: Login as Buyer
4. In Tab B: Send a message to Tab A
5. **Expected Result**:
   - Tab A should show a browser notification popup at the top of the screen
   - NotificationBell badge should increase by 1
   - Supabase notifications table should have a new row with type='new_message'

### Step 3: Test Offer Notifications (Desktop Browser)

1. Open two browser windows/tabs
2. In Tab A: Login as Seller
3. In Tab B: Login as Buyer
4. In Tab B: Create a new offer
5. **Expected Result**:
   - Tab A should show a browser notification
   - NotificationBell badge should increase by 1
   - Supabase notifications table should have a new row with type='offer_received'

### Step 4: Verify Chrome DevTools

Open Tab A's DevTools:

**Console tab**:

- Should show: `"Service worker registered successfully"`
- Should show: `"FCM token retrieved: ..."`
- Should show: `"FCM token stored successfully"`
- When notification arrives: `"New notification received: {...}"`
- When subscription receives data: `"Subscription payload received: {...}"`

**Application tab → Service Workers**:

- Should list `/firebase-messaging-sw.js` with status "activated and running"

**Application tab → Storage → IndexedDB → idb-compat**:

- Check if you see firebase storage with FCM token

**Network tab**:

- After granting permission, should see POST to `fcm.googleapis.com`
- When new message created, should see POST to Supabase `realtime` endpoint

### Step 5: Test on Mobile Chrome

1. Open mobile Chrome browser
2. Navigate to your Trustall app
3. Permission prompt should appear (often at top of page)
4. Grant notification permission
5. Send a message/offer from another account
6. **Expected Result**:
   - Android: Notification appears in notification drawer (even if app closed)
   - iOS: Notification may appear only if app is in foreground (iOS FCM limitations)

### Step 6: Test Mobile App (if built with PWA)

If you've built a PWA:

1. Open in mobile app
2. Grant notification permission when prompted
3. Send message/offer from another account
4. **Expected Result**: Native-like notification appears

## Troubleshooting

### Notification Bell Shows Unread Count But No Notifications Popup?

1. Check DevTools Console for errors
2. Verify Supabase connection in Network tab
3. Check `subscribeToNotifications` logs
4. Run in Console: `Notification.permission` (should return "granted")

### Service Worker Not Registering?

1. Check browser address bar - if it's `localhost`, service workers work
2. If `127.0.0.1`, service workers may not work (use `localhost`)
3. Check DevTools → Application → Service Workers for errors
4. Try hard refresh (Ctrl+Shift+R) to clear service worker cache

### No Console Logs Appearing?

1. Ensure you're checking the right browser tab
2. DevTools must be open BEFORE page load for initial logs
3. Try opening DevTools, then reloading page

### FCM Token Not Stored?

1. Check DevTools Console for: `"Failed to store FCM token:"`
2. Verify Supabase connection working (test in Network tab)
3. Check device_tokens table permissions in Supabase
4. Run test query in Supabase: `SELECT * FROM device_tokens ORDER BY last_used_at DESC LIMIT 5`

### Supabase Real-time Not Firing?

1. Go to Supabase dashboard → Realtime
2. Check if `notifications` table is in the publication
3. Verify RLS policies allow the user to read their own notifications
4. Check in Supabase logs if triggers are executing
5. Test real-time by inserting notification manually:

```sql
INSERT INTO public.notifications (
  recipient_id, sender_id, type, title, message, created_at
)
SELECT auth.uid(), auth.uid(), 'test', 'Test Notification', 'This is a test', now()
WHERE auth.uid() IS NOT NULL;
```

## Database Verification

### Check Notification Triggers Exist

Run in Supabase SQL Editor:

```sql
-- Check message trigger
SELECT * FROM information_schema.triggers
WHERE trigger_name = 'trg_on_new_message';

-- Check offer creation trigger
SELECT * FROM information_schema.triggers
WHERE trigger_name = 'trg_on_new_offer';

-- Check all notifications
SELECT type, COUNT(*) FROM notifications
GROUP BY type
ORDER BY COUNT(*) DESC;
```

### Check Recent Notifications

```sql
SELECT id, recipient_id, type, title, created_at
FROM notifications
ORDER BY created_at DESC
LIMIT 20;
```

### Check Device Tokens Are Stored

```sql
SELECT user_id, fcm_token, device_info, last_used_at
FROM device_tokens
ORDER BY last_used_at DESC
LIMIT 10;
```

## Files Modified

1. **supabase/migrations/0018_fix_offer_and_order_notifications.sql** - NEW
   - Adds missing offer_received trigger
   - Improves order_confirmed trigger
   - Ensures notifications table is in real-time publication

2. **src/App.jsx**
   - Added early notification permission request in GlobalSetup

3. **src/lib/useRegisterPush.js**
   - Enhanced service worker registration for dev mode
   - Better error handling and logging
   - Proper Firebase token retrieval

4. **src/lib/notificationUtils.js**
   - Improved real-time subscription with error handling
   - Added logging for subscription lifecycle

5. **src/components/NotificationBell.jsx**
   - Added error state tracking
   - Better error handling in loadNotifications
   - Improved console logging for debugging

## Expected Browser Notification UI

When a notification arrives and the app is in the foreground:

- A browser notification appears at the top-right of the browser (on Windows)
- On mobile Chrome, it appears as a in-app notification or notification drawer item
- Clicking the notification should navigate to the relevant page (message thread, order, etc.)

## Next Steps If Still Not Working

1. **Check Supabase logs** - Go to Supabase dashboard → Logs → check if triggers are firing
2. **Test triggers manually** - Create a message in Supabase SQL editor and check if notification row is created
3. **Enable Firebase Debug Mode** - Add `localStorage.setItem('debug', '*')` in DevTools Console
4. **Check Firebase Console** - Go to Firebase project dashboard → Cloud Messaging to see send history
5. **Verify RLS Policies** - Ensure notifications table policies allow users to read their own notifications
6. **Check Network Throttling** - In DevTools, disable network throttling (sometimes helps with real-time)

## Performance Notes

- Service worker should be ~10KB and loads once
- FCM token registration is non-blocking (won't break app if it fails)
- Real-time subscription uses minimal bandwidth (~100 bytes per notification)
- Notifications are delivered to all logged-in tabs/windows of the same user
