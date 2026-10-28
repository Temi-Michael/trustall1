# Trustall Order Lifecycle & Wallet Fixes Summary

## Issues Resolved

### 1. **Notification Bell Not Displaying Notifications**

- **Root Cause**: The notification bell was reading `notification.body` but the database stores text in `notification.message`
- **Fix**: Updated [NotificationBell.jsx](src/components/NotificationBell.jsx#L144) to fallback to `notification.message || notification.body`
- **Result**: Notifications now display correctly in the bell

### 2. **Notifications Table Not in Supabase Realtime**

- **Root Cause**: The `notifications` table was not published to Realtime, so new notifications didn't trigger realtime updates
- **Fix**: Added `alter publication supabase_realtime add table public.notifications;` in migration 0016
- **Result**: New notifications push to clients in real-time

### 3. **Missing Lifecycle Event Notifications**

- **Root Cause**: No database triggers were creating notifications when orders progressed through statuses
- **Fixes**:
  - Created `notify_offer_accepted()` trigger: inserts notification when offer status → 'accepted'
  - Created `notify_fulfilled_order()` trigger: inserts notification when order status → 'fulfilled'
  - Enhanced `on_order_confirmed()` trigger: inserts both seller and buyer notifications when order → 'confirmed'
- **Result**: All lifecycle events now automatically create notifications for relevant parties

### 4. **Wallet Funds Not Releasing After Confirmation**

- **Root Cause**: The `wallet_pending` and `wallet_cleared` columns existed but no triggers were updating them during the order lifecycle
- **Fixes**:
  - Implemented `record_payment_as_pending(p_order_id)` RPC:
    - Moves `seller_payout` amount from profile into `wallet_pending`
    - Creates notification for seller: "Buyer payment secured"
  - Implemented `confirm_delivery_and_release_payment(p_order_id)` RPC:
    - Moves funds from `wallet_pending` → `wallet_cleared` (now available for withdrawal)
    - Creates notifications for both seller and buyer
  - Updated trigger `on_order_confirmed()`:
    - Runs same wallet transfer logic as fallback if status changed to 'confirmed' directly
- **Result**: Seller wallet now updates correctly through the order lifecycle

### 5. **Inconsistent Order Status Values**

- **Root Cause**: Code checked for `status === 'completed'` but database allows 'confirmed', 'completed', and 'complete'
- **Fixes**:
  - Updated [Orders.jsx](src/pages/Orders.jsx) to check `['confirmed', 'completed', 'complete'].includes(order.status)`
  - Updated [Sell.jsx](src/pages/Sell.jsx) seller dashboard status styling
  - Normalized all order completion checks
- **Result**: UI now consistently treats all completed statuses as final

## Full Order Lifecycle Flow (After Fixes)

```
1. OFFER_SENT
   ├─ Seller creates offer
   └─ Buyer receives notification: "New offer from seller"

2. PAYMENT_INITIATED
   ├─ Buyer clicks "Accept & Pay"
   └─ Paystack checkout opens

3. PAYMENT_VERIFIED (paystack-verify-payment Edge Function)
   ├─ Offer status → 'accepted'
   ├─ Order created with status 'paid'
   ├─ Seller's wallet_pending += seller_payout
   └─ Seller receives notification: "Offer accepted"

4. DELIVERY_SENT (when seller marks delivered)
   ├─ Order status → 'fulfilled'
   ├─ Buyer receives notification: "Delivery sent - please confirm receipt"
   └─ Wallet remains in pending state

5. DELIVERY_CONFIRMED (when buyer confirms receipt)
   ├─ confirm_delivery_and_release_payment() RPC called
   ├─ Order status → 'confirmed'
   ├─ Seller's wallet: pending → cleared (now withdrawable)
   ├─ Seller receives notification: "Payment released to wallet"
   ├─ Buyer receives notification: "Order completed"
   └─ Seller dashboard updates: wallet_cleared increases, wallet_pending decreases
```

## Database Changes (Migration 0016)

**New Realtime Publication:**

```sql
alter publication supabase_realtime add table public.notifications;
```

**New/Updated Functions:**

- `notify_offer_accepted()`: Trigger on offers table UPDATE
- `notify_fulfilled_order()`: Trigger on orders table UPDATE
- `record_payment_as_pending(p_order_id)`: RPC called after payment verification
- `confirm_delivery_and_release_payment(p_order_id)`: RPC called when buyer confirms
- `on_order_confirmed()`: Enhanced trigger on orders table UPDATE

## UI Changes

### NotificationBell.jsx

- Line 144: Fixed message field rendering to handle both `message` and `body` fields

### Orders.jsx

- Order status checks now include 'confirmed', 'completed', 'complete'
- Seller review buttons visible for all completed statuses
- Status progress indicators accurate across all completion states

### Sell.jsx

- Seller dashboard color coding for 'confirmed' and 'completed' statuses
- Consistent status display across seller order management

## Testing Checklist

- [ ] Deploy migration 0016 to Supabase
- [ ] Test offer acceptance flow: seller creates offer → buyer pays → notification appears in bell
- [ ] Test delivery confirmation: seller marks delivered → buyer gets notification → confirms → seller wallet updates
- [ ] Verify seller dashboard shows updated wallet_cleared after order confirmation
- [ ] Verify both seller and buyer receive appropriate notifications at each step
- [ ] Check that notifications appear in browser as popup notifications (via sendBrowserNotification)
- [ ] Verify old completed orders in db with status='confirmed' show correctly in UI
