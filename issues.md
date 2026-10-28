# Issues

Every problem found in the Trustall codebase during the October 2026 review, fixed or not. This file only describes the problems; [fix.md](fix.md) explains how the fixed ones were solved.

**How serious each one is**

| Level | Meaning |
|---|---|
| 🔴 Critical | Someone could steal money, take over accounts or read private data today. |
| 🟠 High | Real damage is possible, but it takes more effort or affects fewer people. |
| 🟡 Medium | Could cause wrong data, abuse or a broken feature. |
| ⚪ Low | Housekeeping or a small risk. |

**Status:** ✅ Fixed · ⏳ Open

---

## 1. Accounts and permissions

| # | Issue | Level | Status |
|---|---|---|---|
| 1.1 | **Anyone could make themselves an admin.** Users could edit every column of their own profile, including `role`, so one browser-console command gave full admin access. | 🔴 | ✅ |
| 1.2 | **Users could edit their own wallet balance, verified badge, seller level and warning count** through the same open profile update. | 🔴 | ✅ |
| 1.3 | **The admin page is only hidden in the browser.** The check in `Admin.jsx` is a screen-level guard, so real protection depends entirely on database rules, including for tables that only exist on the live database and can't be checked from the code. | 🟡 | ⏳ |
| 1.4 | **The profiles table was readable by anyone**, including wallet balances, warning counts, Paystack codes and referral data. | 🟠 | ✅ |

## 2. Personal data

| # | Issue | Level | Status |
|---|---|---|---|
| 2.1 | **Every user's phone number was public.** Anyone with the site's public key could download them all. | 🔴 | ✅ |
| 2.2 | **Government ID numbers (NIN/CAC) were stored in plain text.** | 🟠 | ✅ |
| 2.3 | **Chat photos and videos were in a public folder.** Anyone with a link could open them, and any signed-in user could overwrite or delete other people's files. | 🟠 | ✅ |
| 2.4 | **Dispute evidence is in a public folder**, saved with permanent public links. | 🟠 | ⏳ |

## 3. Orders and money

| # | Issue | Level | Status |
|---|---|---|---|
| 3.1 | **Buyers and sellers could change any order directly**, for example a seller marking their own order "confirmed" to skip the buyer. | 🔴 | ✅ |
| 3.2 | **Anyone could confirm delivery on any order**, releasing the payout without being the buyer. | 🔴 | ✅ |
| 3.3 | **Anyone could add to any seller's pending balance**, and calling the same function again kept adding to it. | 🔴 | ✅ |
| 3.4 | **Confirming delivery paid the seller's wallet twice**, once in the function and once in a database trigger. | 🟠 | ✅ |
| 3.5 | **Wallet balances already doubled by issue 3.4 have not been corrected.** | 🟡 | ⏳ |
| 3.6 | **One payment could create several orders.** The payment check never recorded that a reference had been used, so it could be replayed against another offer with the same price. | 🔴 | ✅ |
| 3.7 | **Payment references were guessable**: built in the browser from the offer ID plus the time. | 🟡 | ✅ |
| 3.8 | **Refunds and reversals weren't linked to the payment they undo.** | 🟡 | ✅ |
| 3.9 | **Withdrawals, refunds and promotion payments don't use the new `TRUST-…` references yet.** The code that runs them is only on Supabase, not in this repository. | 🟡 | ⏳ |
| 3.10 | **The database accepted negative prices and `NaN` ("not a number") amounts** for listings and offers. | 🟡 | ✅ |

## 4. Attacks through user input

| # | Issue | Level | Status |
|---|---|---|---|
| 4.1 | **The email function could be used to send any email to anyone.** It didn't check who was calling, so anyone could send phishing emails from Trustall's address. | 🔴 | ✅ |
| 4.2 | **Notification emails mixed text straight into HTML**, so text with HTML tags would be rendered as HTML. | 🟡 | ✅ |
| 4.3 | **Blog posts were shown as raw HTML**, so a post containing a script would run in every visitor's browser. | 🟠 | ✅ |
| 4.4 | **Search text and tag names were treated as wildcard patterns** (`%`, `_`, `*`), so searches could match the wrong things. | ⚪ | ✅ |
| 4.5 | **Uploaded file names were used as-is in storage paths**, including slashes, `../` and odd characters. | 🟡 | ✅ |
| 4.6 | **Server functions didn't check their inputs**: offer IDs, bank details and payment references weren't validated before use. | 🟡 | ✅ |
| 4.7 | **A payment reference was inserted into a Paystack URL without encoding.** | 🟡 | ✅ |
| 4.8 | **The push notification function accepted calls from anyone** if its secret wasn't set. | 🟠 | ✅ |
| 4.9 | **The AI chat accepted prompts of any length**, so one request could run up the AI bill. | 🟡 | ✅ |
| 4.10 | **The AI chat, email and checkout functions have no rate limiting**, so they can be called in a tight loop. | 🟡 | ⏳ |
| 4.11 | **The upload proxy had no size or file-type limit.** It isn't used by the app at all. | 🟡 | ✅ (limits added; still worth deleting) |
| 4.12 | **There were no text-length limits in the database**, so a single message or listing could hold megabytes of text. | ⚪ | ✅ |
| 4.13 | **There were no file size or type limits on storage buckets.** | 🟡 | ✅ |
| 4.14 | **Some server functions send internal error messages back to the browser**, revealing details about how the system works. | ⚪ | ⏳ |

## 5. Seller verification

| # | Issue | Level | Status |
|---|---|---|---|
| 5.1 | **Sellers could submit a verification request already marked "approved".** | 🟠 | ✅ |
| 5.2 | **Verification is manual only.** ID numbers aren't checked against NIMC or CAC, there's no selfie or liveness check, and someone else's ID photo would pass. | 🟠 | ⏳ |
| 5.3 | **`phone_verified` is never set**, so phone numbers are never confirmed. | ⚪ | ⏳ |

## 6. Database and migrations

| # | Issue | Level | Status |
|---|---|---|---|
| 6.1 | **Migration 0010 always failed** because it added `messages` to realtime a second time, which undid the whole migration, including the read-receipt columns. | 🟡 | ✅ |
| 6.2 | **Migration 0018 had invalid SQL** (`ADD TABLE IF NOT EXISTS`), so none of its notification fixes could apply. | 🟡 | ✅ |
| 6.3 | **The `disputes` table was never created by any migration**, so a fresh database couldn't be built. | 🟡 | ✅ |
| 6.4 | **There was no record of which migrations had been applied**, so pasting them into the SQL Editor was guesswork. | 🟡 | ✅ |
| 6.5 | **Many live tables and functions aren't in the repository**: `promotions`, `payout_transfers`, `device_tokens`, `tags`, `update_last_seen`, `search_listings_ranked`, `resolve_dispute_favor_seller` and others. Their security rules can't be reviewed, and a fresh database can't run the full app. | 🟠 | ⏳ |
| 6.6 | **Six server functions exist only on Supabase**, not in this repository, so they are unreviewed: `paystack-process-payout`, `paystack-verify-promotion-payment`, `resolve-dispute-refund-buyer`, `paystack-create-platform-recipient`, `paystack-withdraw-platform-earnings` and `moderate-chat-image`. | 🟠 | ⏳ |
| 6.7 | **Live-only code may now be blocked.** Any of it that changes orders or profiles without elevated rights will be refused by the new rules, and so will any that reads profiles with `select('*')` or reads a hidden field such as `wallet_cleared`. Filing a dispute and withdrawing from the wallet should be tested in particular. | 🟡 | ⏳ |

## 8. Admin dashboard

| # | Issue | Level | Status |
|---|---|---|---|
| 8.1 | **Leaving the tab reset the dashboard to the overview.** Supabase refreshes the login on tab focus, and the admin page blanked and reloaded itself each time. | 🟡 | ✅ |
| 8.2 | **The open section wasn't kept in the URL**, so any reload lost your place. | ⚪ | ✅ |
| 8.3 | **Sellers could publish their own listings** by setting the status to "published" directly, skipping admin approval. | 🟠 | ✅ |
| 8.4 | **There was no audit log** of admin actions. | 🟡 | ✅ |
| 8.5 | **Verification approvals were two separate saves with no error checks**, so a request could show "approved" while the seller never got the badge. Rejections had no reason. | 🟡 | ✅ |
| 8.6 | **Rejected ID documents were kept forever.** | 🟡 | ✅ |
| 8.7 | **The verification queue reloaded every 3.5 seconds**, and on every profile change, regenerating document links each time. | ⚪ | ✅ |
| 8.8 | **Issuing a warning was three separate saves with no error checks.** | 🟡 | ✅ |
| 8.9 | **There was no user detail view.** The people directory only showed name cards, searched only the 500 newest profiles, and couldn't search by email. | 🟡 | ✅ |
| 8.10 | **Admins can't create promotions.** Sellers create them on the Marketing page; admins can only approve, pause or stop them. | ⚪ | ⏳ |
| 8.11 | **The promotions screen loads every profile and listing** just to show names. | ⚪ | ⏳ |
| 8.12 | **The verification queue only lists pending requests.** Past approvals and rejections can only be seen one user at a time, in that user's details panel. | ⚪ | ⏳ |
| 8.14 | **Sellers weren't told why their verification was rejected.** | ⚪ | ✅ |
| 8.13 | **Some admin actions still save without checking for errors**, such as listing removal and judge toggles. | ⚪ | ⏳ |

## 7. Housekeeping

| # | Issue | Level | Status |
|---|---|---|---|
| 7.1 | **The `notificationUtils.test.js` test fails** on the original code. | ⚪ | ⏳ |
| 7.2 | **`dist.zip` is committed, and about ten loose notes sit in the project root.** | ⚪ | ⏳ |

---

### Check for tables without row-level security

Row-level security (RLS) is the database's per-row access rules; a table without it can be read by anyone with the public key. Run this in the Supabase SQL Editor to list any public table that has it turned off (for issue 6.5):

```sql
select tablename from pg_tables
where schemaname = 'public' and not rowsecurity
order by tablename;
```

An empty result is what you want.
