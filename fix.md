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

**2.4: Dispute evidence was public**
- **What changed:** the dispute evidence bucket is private. Only the buyer, the seller, whoever filed the dispute, the assigned judge and admins can open or add files for that case; admins alone can delete them. Any older rules on this bucket, including ones made in the dashboard, are removed first.
- **How the page shows files:** new uploads store the file's path instead of a public link, and the dispute page shows files through links that expire after an hour. Evidence uploaded before the change still displays, because its old public link is turned back into a path.
- **Where:** `0035_private_evidence_and_rate_limits.sql`, `Dispute.jsx`, `src/lib/storagePaths.js`.

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

**4.10: No rate limiting**
- **What changed:** the database now counts calls and refuses extras with "Too many requests. Please wait a few minutes and try again."

  | What | Limit |
  |---|---|
  | AI chat (by internet address, since signed-out visitors can use it) | 20 per 10 minutes |
  | Notification emails | 10 per hour per user |
  | Checkout references | 20 per 10 minutes per buyer |
  | Checkout setup | 30 per 10 minutes per user |
  | Payment confirmation | 20 per 10 minutes per user |
  | Connecting a payout account | 5 per hour per user, for each of the two setup functions |
  | Uploads through the upload proxy | 30 per 10 minutes per user |

- **If the counter itself fails**, requests are allowed rather than blocked, so a fault can never stop someone paying.
- **Where:** `consume_rate_limit()` in `0035_private_evidence_and_rate_limits.sql`, `supabase/functions/_shared/rateLimit.ts`.

**4.14: Internal error messages**
- **What changed:** when something breaks unexpectedly, server functions now reply with a plain message such as "Something went wrong. Please try again." The real error goes to the function logs in Supabase, where you can still see it.
- **Kept as-is:** messages that help the user, such as Paystack's "Account number is invalid", are still shown.
- **Small improvement:** paying twice for the same payment now says "This payment has already been recorded" instead of a database error.

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

## 7. Housekeeping

**7.1: Failing test**
- **What was wrong:** the test loaded `notificationUtils.js`, which pulls in the Supabase client, and that client only works inside the Vite build.
- **What changed:** the two functions under test moved to `notificationFormat.js`, which has no Supabase dependency. `notificationUtils.js` re-exports them, so the rest of the app is unchanged. All tests pass now.

**7.2: Repo clutter**
- **What changed:** the 13 loose notes moved into `docs/`. `dist.zip`, a build output, was removed from the repository and added to `.gitignore`. Only README, issues, fix and update stay in the project root.

## 8. Admin dashboard

**8.1 & 8.2: Dashboard reset when leaving the tab**
- **What changed:** the admin page only reloads your profile when a different user signs in. The open section is saved in the address (`?section=…`), so a reload keeps your place.
- **Where:** `Admin.jsx`.

**8.3: Self-published listings**
- **What changed:** a database guard blocks non-admins from publishing or rejecting listings, setting moderation notes or restoring a listing Trustall removed. New listings always start hidden until approved.
- **Where:** `0034_admin_tools.sql`, `guard_listing_moderation()`.

**8.4: No audit log**
- **What changed:** every change an admin makes to profiles, verification, listings, orders, disputes, reports, warnings, promotions, payouts or blog posts is recorded automatically, with who, when and what changed. Nobody can edit the log. It's shown under **Audit log** in the dashboard.

**8.5 & 8.6: Verification reviews**
- **What changed:** approving or rejecting is one database action (`admin_review_verification`). Rejecting asks for a reason, then deletes the ID document and records when it was deleted.

**8.7: Constant queue reloads**
- **What changed:** the queue now updates only when a verification request changes.

**8.8: Warnings**
- **What changed:** issuing a warning is one database action (`admin_issue_warning`), with errors shown to the admin.

**8.9: No user detail view**
- **What changed:** **Users, sellers & buyers** now searches every user in the database by name, business name, handle, email or user ID, page by page. Typed `%` and `_` are matched literally. A new **Suspended** filter lists suspended accounts.
- **Details panel:** selecting a person opens their full details:
  - **Account:** email, whether it's confirmed, phone, sign-up date, last sign-in and last seen.
  - **Standing:** role, status, seller level, badges, warnings and reports against them.
  - **Money:** wallet balances (with the show/hide button), confirmed payouts and whether a payout account is connected.
  - **Activity:** listings and orders.
  - **History:** every verification request, with rejection reasons, and every warning.
- **Admins only:** both lookups refuse anyone who isn't an admin.
- **Where:** `Admin.jsx` (`ProfileDirectory`, `UserDetailsPanel`), `0034_admin_tools.sql`.

**8.14: Rejection reason hidden from sellers**
- **What changed:** the seller's verification panel now shows the reason the admin gave.
- **Where:** `Sell.jsx`.

**8.11: Promotions screen loaded everything**
- **What changed:** it now looks up only the sellers and listings that the promotions on screen point at.

**8.12: Verification history hidden**
- **What changed:** the verification queue has **Pending**, **Approved** and **Rejected** tabs. Past requests show when they were reviewed, the rejection reason and whether the document was deleted. Only pending requests have Approve and Reject buttons.

**8.13: Admin actions without error checks**
- **What changed:** dismissing a report, reactivating an account and recording a deleted document now show or log an error if the save fails, instead of failing silently.
- **Where:** `Admin.jsx`.
