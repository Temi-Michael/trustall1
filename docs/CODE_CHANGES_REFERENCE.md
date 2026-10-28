# Code Changes Reference

## File: src/pages/Messages.jsx

### Updated: OfferCard Payment Callback

**Location:** Lines 299-332 (the `callback` function inside Paystack setup)

**What Changed:**

- Added `record_payment_as_pending` RPC call after successful payment verification
- Updated success message to reflect pending payment state
- Added proper error handling with try-catch
- Now captures order_id from payment verification response

**Before:**

```javascript
callback: (response) => {
  ;(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(...)
    const result = await res.json()
    setPaying(false)
    if (result.error) {
      alert(`Payment received but couldn't be confirmed: ${result.error}...`)
    } else {
      alert('Payment confirmed! The seller has been notified to fulfill your order.')
    }
  })()
}
```

**After:**

```javascript
callback: (response) => {
  ;(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(...)
      const result = await res.json()

      if (result.error) {
        setPaying(false)
        alert(`Payment received but couldn't be confirmed: ${result.error}...`)
        return
      }

      // Payment verified, now record it as pending
      if (result.order_id) {
        const { error: pendingError } = await supabase.rpc('record_payment_as_pending', {
          p_order_id: result.order_id,
        })

        if (pendingError) {
          setPaying(false)
          alert(`Payment confirmed but couldn't be recorded: ${pendingError.message}...`)
          return
        }
      }

      setPaying(false)
      alert('Payment secured. Funds will be released to the seller once you confirm delivery.')
    } catch (err) {
      setPaying(false)
      console.error('Payment callback error:', err)
      alert(`Payment processing error: ${err.message}`)
    }
  })()
}
```

**Key Differences:**

1. Added `record_payment_as_pending` RPC call after verification succeeds
2. Check `result.order_id` exists before calling RPC
3. If RPC fails, show specific error message
4. Success message changed to "Payment secured. Funds will be released..."
5. Wrapped in try-catch for robustness

---

## File: src/pages/Orders.jsx

### No Changes Required! ✅

All the following are already correctly implemented:

**1. OrderDetails Component (lines 175-286)**

- ✅ Status message for 'paid': "Payment secured. Funds will be released to the seller once you confirm delivery."
- ✅ Status message for 'fulfilled': "Delivered — Awaiting buyer confirmation"
- ✅ Seller can click "Mark as Delivered" when status === 'paid'
- ✅ Buyer can click "Confirm Receipt & Leave Review" when status === 'fulfilled' && fulfilled_at exists

**2. markAsDelivered Function (lines 229-243)**

```javascript
async function markAsDelivered() {
  if (!order?.id) return
  setSellerDelivering(true)
  try {
    const { error } = await supabase
      .from('orders')
      .update({
        fulfilled_at: new Date().toISOString(),
        status: 'fulfilled',
      })
      .eq('id', order.id)
      .eq('seller_id', session.user.id)
    // ...
  }
}
```

- ✅ Sets `fulfilled_at` to current timestamp
- ✅ Sets `status` to 'fulfilled'
- ✅ Only updates if seller_id matches

**3. LeaveReview Component (lines 343-439)**

- ✅ Handles both `buyerReviewMode` (true) and seller review mode (false)
- ✅ When buyerReviewMode = true:
  - Inserts review with `review_type: 'buyer_to_seller'`, `reviewee_id: order.seller_id`
  - Calls `confirm_delivery_and_release_payment` RPC
  - Shows actual error message if `data.success === false`
  - Shows success message on completion
- ✅ When buyerReviewMode = false:
  - Inserts review with `review_type: 'seller_to_buyer'`, `reviewee_id: order.buyer_id`
  - Does NOT call any payment function
  - Just closes modal on success

---

## File: src/pages/Sell.jsx

### No Changes Required! ✅

All the following are already correctly implemented:

**1. SellerSalesOverview Component (lines 96-139)**

```javascript
<div className="rounded-2xl border border-hairline bg-white p-5">
  <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Wallet pending</p>
  <p className="mt-3 font-display text-2xl font-bold text-marigold-deep">
    ₦{Number(profile?.wallet_pending || 0).toLocaleString()}
  </p>
  <p className="mt-1 text-[10px] text-muted">Orders waiting buyer confirmation</p>
</div>

<div className="rounded-2xl border border-hairline bg-white p-5">
  <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Wallet available</p>
  <p className="mt-3 font-display text-2xl font-bold text-seal">
    ₦{Number(profile?.wallet_cleared || 0).toLocaleString()}
  </p>
  <p className="mt-1 text-[10px] text-muted">Release-ready / withdrawable</p>
</div>
```

- ✅ Shows `wallet_pending` in marigold color with explanation
- ✅ Shows `wallet_cleared` in seal color with explanation
- ✅ Clearly separated in 5-column grid

**2. SellerOrderManager Component (lines 161-203)**

```javascript
async function markAsDelivered(orderId) {
  // ... updates order with fulfilled_at and status='fulfilled'
}

{order.status === 'paid' && (
  <button onClick={() => markAsDelivered(order.id)} ...>
    Mark as Delivered
  </button>
)}
```

- ✅ "Mark as Delivered" button only shows when status === 'paid'
- ✅ Button disabled while updating
- ✅ Status badge changes to "Delivered — Awaiting buyer confirmation" after click

---

## File: src/pages/SellerProfile.jsx

### No Changes Required! ✅

**BuyerProfile Component (lines 16-89)**

```javascript
const { data: reviewData } = await supabase
  .from("reviews")
  .select("*, reviewer:reviewer_id(business_name, full_name)")
  .eq("reviewee_id", profile.id)
  .eq("review_type", "seller_to_buyer")
  .order("created_at", { ascending: false });
```

- ✅ Fetches seller-to-buyer reviews
- ✅ Displays with reviewer name, stars, comment, date
- ✅ Shows "No reviews yet" if empty

---

## Summary of Changes

**Total files modified:** 1

- `src/pages/Messages.jsx` — Updated payment callback only

**Total files reviewed (all correct):** 3

- `src/pages/Orders.jsx` — All review and order logic already implemented
- `src/pages/Sell.jsx` — Seller dashboard and order manager already implemented
- `src/pages/SellerProfile.jsx` — Buyer profile and reviews already implemented

**Build Status:** ✅ No errors, no warnings

---

## Testing the Integration

### Test Payment Flow

1. Login as buyer
2. Go to Messages, find an offer
3. Click "Accept & Pay ₦X"
4. Complete Paystack payment
5. Should see: "Payment secured. Funds will be released to the seller once you confirm delivery."
6. Check seller dashboard: `wallet_pending` should increase

### Test Seller Fulfillment

1. Login as seller
2. Go to seller dashboard or Orders
3. See "Mark as Delivered" button on paid order
4. Click it
5. Should see status change to "Delivered — Awaiting buyer confirmation"
6. Check buyer's view: "Confirm Receipt & Leave Review" button should appear

### Test Buyer Review & Release

1. Login as buyer
2. Go to Orders, find order with "Delivered" status
3. Click "Confirm Receipt & Leave Review"
4. Fill in rating (1-5 stars) and comment (min 8 chars)
5. Click "Submit review"
6. Should see: "Delivery confirmed. Payment released to seller. Thank you for your review!"
7. Check seller dashboard: `wallet_pending` should decrease, `wallet_cleared` should increase

### Test Seller Review Buyer

1. Login as seller
2. Go to Orders, find completed order
3. Click "Review this buyer"
4. Fill in rating and comment
5. Click "Submit review"
6. Modal closes (no success message, just closes)
7. Navigate to buyer's profile: should see the review

---

## Debugging Tips

### Payment callback not firing?

- Check browser console for errors
- Verify Paystack configuration in env
- Check network tab for paystack-verify-payment response
- Ensure order_id is in the response

### Wallet not updating?

- Check that `wallet_pending` and `wallet_cleared` exist in profiles table
- Verify RPC functions are callable
- Check Supabase realtime subscription (profiles table)
- Try refreshing page to see updates

### Review not saving?

- Check minLength validation (min 8 chars for comment)
- Verify reviews table has correct columns
- Check RLS policies allow inserts
- Look for error message in browser console

### Button states wrong?

- Check order status value (should be lowercase: 'paid', 'fulfilled', 'completed')
- Verify fulfilled_at timestamp exists
- Try refreshing to see latest order state from DB

---

## Important Notes

1. **Don't modify `seller_id` column behavior** — keep it for backward compatibility
2. **RPC functions must exist** — ensure backend has both `record_payment_as_pending` and `confirm_delivery_and_release_payment`
3. **Error messages from RPC are user-facing** — backend error messages should be helpful
4. **Wallet updates are from RPC** — frontend doesn't calculate wallet amounts
5. **Order state is source of truth** — UI derives from order.status and order.fulfilled_at

---

All changes are backward compatible and don't break existing functionality! 🎉
