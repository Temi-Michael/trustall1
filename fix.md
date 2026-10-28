# Fixes

How each fixed issue from [issues.md](issues.md) was solved. The numbers match that file. Database changes are in `supabase/migrations/`; apply them by pasting `supabase/all_migrations.sql` into the Supabase SQL Editor (see [update.md](update.md)).

---

## 1. Accounts and permissions

**1.1 & 1.2: Users could make themselves admin or edit their own balances and badges**
- **What changed:** users can now edit only their own name, business name, handle, location, bio and photo. Any other change to their own profile is refused by the database, whatever the app sends.
- **How:** a guard runs before every profile update and compares the old and new row. It works from a list of allowed fields, so columns added later are protected automatically. Admins and the database's own functions are unaffected.
- **Where:** `0028_security_lockdown.sql`, `guard_profile_self_update()`.

**1.4: Private profile fields were public**
- **Now hidden** (only the owner and admins can see them):

  | Field | Why it's private |
  |---|---|
  | `wallet_pending`, `wallet_cleared` | Money in the user's wallet |
  | `paystack_subaccount_code`, `paystack_recipient_code` | Payout account identifiers |
  | `warning_count` | Moderation history |
  | `referral_code`, `referred_by` | Who referred whom |
  | Any `wallet_*`, `paystack_*`, `bank_*`, `account_*`, `bvn` or `nin` column that exists only on the live database | Same reasons; caught by name pattern |

- **Still public, on purpose:** names, handle, location, bio, photo, badges, ratings and sales counts, which build buyer trust. `status` stays too, because the home page uses it to hide suspended sellers. So do `role` and `is_dispute_judge`, because the dispute page uses them to list judges.
- **How:** the database only lets the public read the allowed columns. You read your own full profile through `get_my_profile()`, and admins read anyone's through `admin_get_profiles()`. Checkout only needs to know whether a seller can be paid, so it now uses a yes/no field, `payout_connected`, instead of the seller's payout code.
- **Where:** `0033_private_profile_fields.sql`, `src/lib/profileFields.js`, `useProfile.js`, `SellerProfile.jsx`, `Messages.jsx`, `Admin.jsx`.

## 2. Personal data

**2.1: Phone numbers were public**
- **What changed:** phone numbers moved to a separate table, `profile_contacts`, that only the owner and admins can read. The old public column was removed after the numbers were copied across.
- **Where:** `0028_security_lockdown.sql`. The app reads and saves the number there (`useProfile.js`, `Sell.jsx`).

**2.2: ID numbers in plain text**
- **What changed:** NIN and CAC numbers are encrypted as soon as they're saved. Only the last four digits stay readable, for display. Admins see `••••8901` with a **Reveal** button, which only an admin can use.
- **How:** the encryption key is generated inside Supabase Vault (Supabase's store for secrets) and never appears in the code.
- **Where:** `0028_security_lockdown.sql`, `reveal_verification_id_number()`, `Admin.jsx`.

**2.3: Chat files were public**
- **What changed:** the chat attachments bucket is private. Only the two people in a conversation (and admins) can open, upload, replace or delete its files. The app shows them through short-lived signed links.
- **Where:** `0028_security_lockdown.sql`.

## 3. Orders and money

**3.1: Direct order edits**
- **What changed:** users can no longer edit orders at all. Each step goes through a database function that checks who is asking. For example, "mark as delivered" only works for that order's seller, and only on a paid order.
- **Where:** `0028_security_lockdown.sql`, `mark_order_fulfilled()`. The app calls it from `Orders.jsx` and `Sell.jsx`.

**3.2 & 3.3: Anyone could confirm delivery or credit a wallet**
- **What changed:** both functions now check that the caller is the order's buyer (or an admin).
- **Calling twice:** recording a payment only credits the seller once per order. Confirming an already-confirmed order changes nothing.
- **Where:** `0028_security_lockdown.sql`.

**3.4: Double wallet credit on confirmation**
- **What changed:** the extra credit inside the confirm function was removed. The payout is now moved once, by the trigger that runs when an order becomes "confirmed".

**3.6: One payment, several orders**
- **What changed:** every payment reference is issued for one buyer and one offer, and marked used once the order is created. The payment check refuses unknown, mismatched or already-used references.
- **Backstop:** the database also refuses two orders with the same Paystack reference.
- **Where:** `0029_transaction_references.sql`, `paystack-verify-payment`.

**3.7: Guessable references**
- **What changed:** references are created on the server with a secure random generator, e.g. `TRUST-ORD-2AEF47X9QP3W`. Details are in [update.md](update.md).

**3.8: Refunds not linked**
- **What changed:** a refund or reversal can't be created without the reference of the payment it undoes. The database rejects it otherwise.
- **Where:** `0030_reference_original_link.sql`.

**3.10: Negative or `NaN` amounts**
- **What changed:** listing prices, offer prices and delivery fees must be zero or more and a real number.
- **Where:** `0032_input_constraints.sql`.

## 4. Attacks through user input

**About parameterized queries:** all database access goes through the Supabase client or database functions. Both pass user input as separate values, never pasted into SQL text, so SQL injection isn't possible through them. The one place that builds SQL from text, a helper in `0032_input_constraints.sql`, only uses fixed text from the migration itself and quotes table names safely.

**4.1 & 4.2: Open email relay and unescaped email HTML**
- **What changed:** the email function only sends to the signed-in user's own address, taken from their verified session. The caller can no longer choose the recipient or supply HTML.
- **How:** the caller sends a short plain-text subject (max 150 characters) and body (max 2,000). The function escapes them and builds the email itself.
- **Where:** `supabase/functions/send-notification-email`, `src/lib/notifications.js`.

**4.3: Blog scripts**
- **What changed:** blog HTML is cleaned before it's shown, in both the reader and the editor. Scripts, event handlers such as `onerror=` and `javascript:` links are removed.
- **How:** DOMPurify, a widely used HTML-cleaning library.
- **Where:** `src/lib/sanitizeHtml.js`, `Blog.jsx`, `Admin.jsx`.

**4.4: Wildcards in search**
- **What changed:** search text and tag names are escaped so `%`, `_` and `*` are matched literally.
- **Where:** `escapeLikePattern()` in `src/lib/inputSafety.js`.

**4.5: Unsafe file names**
- **What changed:** every upload path now uses a cleaned file name: letters, digits, dot, dash and underscore only, with no leading dots, at most 100 characters, and the extension kept.
- **Where:** `safeFileName()` in `src/lib/inputSafety.js`, used on every upload in the app (avatars, listings, verification documents, chat, disputes and blog images).

**4.6 & 4.7: Unchecked function inputs**
- **What changed:** each server function checks its inputs before using them. Offer IDs must be valid IDs, bank codes 2–6 digits, account numbers 10 digits, and payment references must match the `TRUST-ORD-…` format. The reference is also encoded before it goes into the Paystack URL.
- **Where:** `supabase/functions/_shared/validate.ts` and the Paystack functions.

**4.8: Open push function**
- **What changed:** the push function now refuses every request unless it carries the correct secret. If the secret isn't set, it refuses everything rather than accepting anyone.
- **Where:** `send-push-notification`.

**4.9: Unlimited AI prompts**
- **What changed:** AI chat questions are cut to 500 characters.

**4.11: Upload proxy limits**
- **What changed:** it accepts images and videos up to 20 MB only, and cleans the file name.

**4.12 & 4.13: No size limits**
- **Text:** the database caps titles, descriptions, messages, reviews, dispute reasons, profile fields and phone numbers. The caps are generous, so normal use isn't affected.
- **Files:** each storage bucket now has a size limit and an allowed file type, e.g. avatars accept images up to 5 MB.
- **Old data:** existing rows aren't re-checked, so old data stays usable.
- **Where:** `0032_input_constraints.sql`.

## 5. Seller verification

**5.1: Self-approved requests**
- **What changed:** new requests must start as "pending" with no reviewer.
- **Where:** `0028_security_lockdown.sql`.

## 6. Database and migrations

**6.1 & 6.2: Migrations 0010 and 0018 failed**
- **What changed:** both now check whether a table is already set up for realtime before adding it. Both are safe to run again.

**6.3: Missing `disputes` table**
- **What changed:** `0020_disputes_table.sql` creates it, with access rules, on a database that doesn't have one. It was rebuilt from how the app uses disputes. On the live database, which already has the table, it does nothing.

**6.4: No migration history**
- **What changed:** `supabase/all_migrations.sql` records each migration as it runs and skips it next time. You can paste the whole file into the SQL Editor whenever there's something new. See [update.md](update.md).
