# Offer Enhancement & Online Status Features

## Overview

Enhanced the offer system with delivery management features (address, fast/normal delivery options, delivery dates) and added real-time online/offline status indicators in chat conversations.

## Features Implemented

### 1. Enhanced Offer Form with Delivery Options

#### New Offer Form Fields:

1. **Item Title** (required)
   - Name of the item being offered

2. **Description** (optional)
   - Detailed description of the item

3. **Price** (required)
   - Base price of the item in Naira (₦)

4. **Delivery Address** (required)
   - Full delivery address for the buyer
   - Example: "23 Lagos Road, Ikeja, Lagos"

5. **Delivery Type** (required)
   - **Fast Delivery:** Fixed price of ₦500
   - **Normal Delivery:** Variable price set by seller
   - Radio button selection for buyer clarity

6. **Normal Delivery Price** (conditionally required)
   - Only shown if "Normal Delivery" is selected
   - Seller sets the delivery fee
   - Minimum: ₦0

7. **Delivery Date** (required)
   - Date and time picker for expected delivery
   - Helps buyers plan for receiving the item

#### Total Price Display:

A summary box shows the buyer: `Total: ₦[Item Price] + ₦[Delivery Fee]`

---

### 2. Enhanced Offer Card Display

When an offer is sent, the buyer sees:

```
[Offer Title]
Description

Price breakdown:
- Item: ₦5,000
- Fast Delivery: ₦500
- Subtotal: ₦5,500 (+ ₦100 escrow fee)

📍 Address: 23 Lagos Road, Ikeja, Lagos
🚚 Delivery: ⚡ Fast (₦500)
📅 By: Aug 15, 2026

[Accept & Pay ₦5,600]
```

Display Elements:

- ✅ Delivery address with location icon
- ✅ Delivery type badge (⚡ for fast, regular for normal)
- ✅ Delivery price clearly shown
- ✅ Delivery date formatted nicely (e.g., "Aug 15, 2026")

---

### 3. Offer Notifications

#### When Offer is Created:

- A notification is automatically created for the buyer
- **Type:** "offer"
- **Title:** "New offer from seller"
- **Message:** Shows item name, price, and delivery fee
- **Example:** "iPhone 13 — ₦250,000 (Delivery: ₦500)"
- **Action:** Click navigates to the message thread

#### Notification in Database:

```sql
INSERT INTO notifications (
  user_id,           -- buyer's ID
  type,              -- 'offer'
  title,             -- "New offer from seller"
  message,           -- Item details
  related_id,        -- offer ID
  action_url         -- /messages/{conversationId}
)
```

#### Buyer Experience:

- 🔔 Notification bell badge updates
- Notification appears in the dropdown
- Click to view the offer immediately

---

### 4. Online/Offline Status Indicators

#### Real-Time Presence Tracking:

- Shows live online/offline status for the person you're chatting with
- Updates automatically every 30 seconds
- Respects tab visibility (pauses when tab is hidden)

#### Visual Indicator:

In the chat header next to the person's name:

```
Online Users:
🟢 John's Store
   Online

Offline Users:
🔴 Jane Doe
   5 minutes ago
   (or: 2 hours ago, Yesterday, etc.)
```

#### Status Display:

- Green dot (🟢) when user is online (< 60 seconds since last activity)
- Gray dot (🔴) when user is offline
- Shows formatted last seen time:
  - "Online" — Less than 60 seconds ago
  - "5m ago" — 5 minutes ago
  - "2h ago" — 2 hours ago
  - "1d ago" — 1 day ago

#### Implementation:

- Uses existing `profiles.last_seen_at` field
- Subscribes to profile updates for real-time changes
- No additional database queries needed

---

## Database Changes

### New Migration File: `0011_offer_delivery_fields.sql`

Adds the following columns to the `offers` table:

```sql
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS delivery_type TEXT DEFAULT 'normal'
    CHECK (delivery_type IN ('fast', 'normal')),
  ADD COLUMN IF NOT EXISTS delivery_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fast_delivery_price NUMERIC(12,2) DEFAULT 500,
  ADD COLUMN IF NOT EXISTS normal_delivery_price NUMERIC(12,2);
```

#### New Columns:

| Column                  | Type        | Default  | Notes                     |
| ----------------------- | ----------- | -------- | ------------------------- |
| `delivery_address`      | TEXT        | NULL     | Required for all offers   |
| `delivery_type`         | TEXT        | 'normal' | Either 'fast' or 'normal' |
| `delivery_date`         | TIMESTAMPTZ | NULL     | Expected delivery time    |
| `fast_delivery_price`   | NUMERIC     | 500      | Fixed at ₦500             |
| `normal_delivery_price` | NUMERIC     | NULL     | Variable, set by seller   |

---

## Code Changes

### File: `src/pages/Messages.jsx`

#### 1. **New Imports:**

```javascript
import {
  isOnline,
  formatLastSeen,
  subscribeToUserPresence,
} from "../lib/presenceUtils.js";
```

#### 2. **Updated OfferForm Component:**

- Added state for: `deliveryAddress`, `deliveryType`, `normalDeliveryPrice`, `deliveryDate`
- Added validation for required fields
- Calculates `displayDeliveryFee` based on delivery type
- Creates notification for buyer when offer is sent
- Improved form layout with radio buttons for delivery type
- Shows total price summary

#### 3. **Updated OfferCard Component:**

- Displays delivery address with 📍 icon
- Shows delivery type (⚡ for fast, text for normal) with 🚚 icon
- Shows delivery date with 📅 icon
- Better spacing and visual hierarchy

#### 4. **Updated Thread Component:**

- Added `otherUserLastSeen` state to track other user's presence
- Added presence subscription in useEffect
- Shows green/gray dot indicator next to user name
- Shows online status or formatted last seen time

---

## File: `supabase/migrations/0011_offer_delivery_fields.sql`

New migration that adds delivery-related columns to offers table.

**Run this migration on your Supabase database:**

```bash
# Or manually execute the SQL in your Supabase SQL editor
```

---

## User Experience Flow

### Seller Creating an Offer:

```
1. Click "+ Create offer"
2. Fill in item title and price
3. Enter delivery address
4. Choose delivery type:
   - Fast (₦500 fixed)
   - Normal (enter custom price)
5. Select delivery date/time
6. See total price preview
7. Click "Send offer"
8. ✅ Offer sent, buyer gets notification
```

### Buyer Receiving an Offer:

```
1. 🔔 See notification bell badge update
2. Open notifications or see message notification
3. Click notification → Opens chat
4. See offer card with:
   - Item details
   - Total price breakdown
   - Delivery address
   - Delivery type and fee
   - Delivery date
5. Click "Accept & Pay"
6. Proceed to Paystack payment
7. Order created with delivery details
```

### Order Management:

```
Seller View (Orders page):
- Can see delivery address and deadline
- Can mark as delivered before deadline
- Funds held until buyer confirms delivery

Buyer View (Orders page):
- Can see expected delivery date
- Can track order status
- Confirms delivery to release funds to seller
```

---

## Real-Time Features

### Presence Tracking:

- Tracks user activity via `last_seen_at` in profiles table
- Updates every 30 seconds when user is active
- Pauses when tab is hidden (saves battery)
- Shows human-readable time format

### Online Status:

- Green indicator = Online (active in last 60 seconds)
- Gray indicator = Offline (inactive for 60+ seconds)
- Updates in real-time when status changes

### Read Receipts (Existing):

- ⏱️ Message sent (not delivered yet)
- ✓ Message delivered (delivered but not read)
- ✓✓ Message read (seen by recipient)

---

## Technical Details

### Offer Notification Creation:

```javascript
const { data: offer } = await supabase
  .from("offers")
  .insert({
    /* offer data */
  })
  .select()
  .single();

const { data: conversation } = await supabase
  .from("conversations")
  .select("buyer_id")
  .eq("id", conversationId)
  .single();

// Create notification for buyer
await supabase.from("notifications").insert({
  user_id: conversation.buyer_id,
  type: "offer",
  title: "New offer from seller",
  message: `${itemTitle} — ₦${price} (Delivery: ₦${fee})`,
  related_id: offer.id,
  action_url: `/messages/${conversationId}`,
});
```

### Presence Subscription:

```javascript
const unsubscribePresence = subscribeToUserPresence(otherUserId, (profile) => {
  setOtherUserLastSeen(profile.last_seen_at);
});
```

---

## Validation & Error Handling

### Form Validation:

- ✅ Delivery address is required (non-empty string)
- ✅ Normal delivery price required if "Normal" is selected
- ✅ Delivery date must be selected
- ✅ All required fields checked before submission
- ✅ Try-catch wrapper for error handling
- ✅ User-friendly error messages displayed

### Error Messages:

- "Please enter a delivery address"
- "Please enter a normal delivery price"
- "Please select a delivery date"
- "Failed to create offer: [error message]"

---

## Testing Checklist

- [ ] **Offer Form**
  - [ ] All form fields render correctly
  - [ ] Delivery type radio buttons work
  - [ ] Normal delivery price field appears/hides based on selection
  - [ ] Delivery date picker works
  - [ ] Total price summary updates correctly
  - [ ] Form validation works (shows error messages)
  - [ ] Submit button disabled while sending
  - [ ] Success creates offer in database

- [ ] **Offer Display**
  - [ ] Offer card shows all delivery information
  - [ ] Delivery address displays correctly
  - [ ] Delivery type badge shows (⚡ or Normal)
  - [ ] Delivery date formats nicely
  - [ ] Total price calculation is correct
  - [ ] Accept & Pay button works

- [ ] **Offer Notifications**
  - [ ] Notification created for buyer
  - [ ] Notification bell badge updates
  - [ ] Notification message shows correct details
  - [ ] Clicking notification navigates to chat

- [ ] **Online Status**
  - [ ] Green dot shows when user is online
  - [ ] Gray dot shows when user is offline
  - [ ] Status updates in real-time (within 30 sec)
  - [ ] Last seen time formats correctly
  - [ ] Status persists in conversation list

- [ ] **Mobile Responsive**
  - [ ] Form fields stack properly
  - [ ] Offer card readable on small screens
  - [ ] Online indicator visible on mobile
  - [ ] Input datetime picker works on mobile

---

## Performance Considerations

- ✅ Presence tracking pauses when tab is hidden (saves battery)
- ✅ Presence updates every 30 seconds (not too frequent)
- ✅ Subscription cleanup prevents memory leaks
- ✅ Offers table queries efficient with indexed fields
- ✅ Notifications created asynchronously (doesn't block UI)

---

## Future Enhancements

1. **Delivery Tracking**
   - Add order number to notifications
   - Show countdown timer to delivery date
   - Send reminder notifications 24 hours before delivery

2. **Delivery Proof**
   - Add photo upload for delivery confirmation
   - Store delivery timestamp

3. **Cancel/Modify Offers**
   - Allow sellers to edit offers before buyer accepts
   - Show edit/cancel buttons on pending offers

4. **Delivery Tracking Map**
   - Show seller location on map
   - Show delivery route if applicable

5. **Typing Indicators**
   - Show "User is typing..." when other person is composing
   - Enhance real-time conversational feel

---

## Build Status

✅ **Zero Errors** — Build completed successfully in 1m 8s

```
vite v5.4.21 building for production...
✓ 1893 modules transformed
dist/index.html                   1.58 kB
dist/assets/index-C73qzvzy.css   29.80 kB
dist/assets/vendor-DYurj_pJ.js  162.52 kB
dist/assets/index-DcZgZnro.js   475.03 kB
✓ built in 1m 8s
```

---

## Deployment Steps

1. **Run Migration:**
   - Execute `0011_offer_delivery_fields.sql` in Supabase SQL editor
   - Verify columns were added to offers table

2. **Deploy Code:**
   - Push code changes to production
   - No additional environment variables needed

3. **Test in Production:**
   - Create test offer with new fields
   - Verify offer displays correctly
   - Test delivery address and date display
   - Verify notifications appear
   - Check online status updates

---

All changes maintain **backward compatibility** and use existing infrastructure! 🎉
