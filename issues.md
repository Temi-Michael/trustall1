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
| 2.4 | **Dispute evidence was in a public folder**, saved with permanent public links. | 🟠 | ✅ |

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
| 4.10 | **The AI chat, email and checkout functions had no rate limiting**, so they could be called in a tight loop. | 🟡 | ✅ |
| 4.11 | **The upload proxy had no size or file-type limit.** It isn't used by the app at all. | 🟡 | ✅ (limits added; still worth deleting) |
| 4.12 | **There were no text-length limits in the database**, so a single message or listing could hold megabytes of text. | ⚪ | ✅ |
| 4.13 | **There were no file size or type limits on storage buckets.** | 🟡 | ✅ |
| 4.14 | **Some server functions sent internal error messages back to the browser**, revealing details about how the system works. | ⚪ | ✅ |

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

## 7. Housekeeping

| # | Issue | Level | Status |
|---|---|---|---|
| 7.1 | **The `notificationUtils.test.js` test failed** on the original code. | ⚪ | ✅ |
| 7.2 | **`dist.zip` was committed, and 13 loose notes sat in the project root.** | ⚪ | ✅ |

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
| 8.11 | **The promotions screen loaded every profile and listing** just to show names. | ⚪ | ✅ |
| 8.12 | **The verification queue only listed pending requests**, so past approvals and rejections weren't visible there. | ⚪ | ✅ |
| 8.13 | **Some admin actions saved without checking for errors**: dismissing a report, reactivating an account, and recording a deleted document. | ⚪ | ✅ |
| 8.14 | **Sellers weren't told why their verification was rejected.** | ⚪ | ✅ |

## 9. November 2026 review

| # | Issue | Level | Status |
|---|---|---|---|
| 9.1 | **The live database is behind the code.** Features on `dev` rely on migrations 0028–0035, but the live database doesn't have them. The "Fix profile loading compatibility" commit works around the missing `get_my_profile` function. Until they're applied, checkout references, "mark as delivered", saving phone numbers and every new admin tool fail on the live site. | 🔴 | ⏳ |
| 9.2 | **The live database may be missing columns from older migrations too.** A recent commit stopped asking for `business_logo_url` (migration 0005) and `buyer_avg_rating` / `buyer_review_count` (0007), which suggests those columns aren't live either. `all_migrations.sql` assumes 0001–0027 are all applied on a database with no history, so it would skip them without saying so. | 🟠 | ⏳ |
| 9.3 | **Chat broke on a database without migration 0033.** The conversation query asked for the seller's `payout_connected` field. Where that column doesn't exist, the whole query failed, so the thread and checkout didn't load. | 🔴 | ✅ |
| 9.4 | **The profile fallback dropped private fields.** When `get_my_profile` was missing, the app loaded only public profile fields. The Refer page then showed a link ending in `?ref=undefined`, wallets showed ₦0, and connected sellers were asked to connect a payout account again. | 🟠 | ✅ |
| 9.5 | **The sign-in redirect wasn't checked.** After signing in, the app went to whatever address was in `?redirectTo=` or browser storage. With the React Router flaw in 9.6, a crafted link could send people to an outside site (an "open redirect"). | 🟠 | ✅ |
| 9.6 | **Dependencies have known vulnerabilities.** `dompurify` 3.2.6 had cross-site scripting bypasses; that's fixed. `react-router-dom` 6.x still has open-redirect flaws that are only fixed in version 7; the redirect check in 9.5 closes the way this app was exposed. `npm audit` also flags Firebase's server-side libraries, which don't run in the browser. | 🟡 | ⏳ |
| 9.7 | **No security headers on any host.** Vercel, Netlify and Hostinger served the site without headers such as `X-Frame-Options` / `frame-ancestors`, `X-Content-Type-Options` or `Referrer-Policy`. Another site could embed the admin dashboard in a hidden frame (clickjacking). | 🟡 | ✅ |
| 9.8 | **Deploys to Hostinger used plain FTP.** The FTP password and every file travelled unencrypted. The workflow also used Node 20, which is past end-of-life, and deployed without running the tests. | 🟡 | ✅ |
| 9.9 | **Sellers could edit their offers without limits.** The offer update rule had no `WITH CHECK`, so a seller could move an offer into someone else's conversation or change the price while a buyer was paying. The payment was then taken but rejected for not matching. | 🟡 | ✅ |
| 9.10 | **The service worker cached too much, forever.** Any request whose address contained `.js` (including `.json` and third-party scripts such as Paystack's) was cached on first use and never refreshed. Error pages could also be saved as the offline home page. | 🟡 | ✅ |
| 9.11 | **Avatar files could be moved into another user's folder.** The avatar storage update rule had no `WITH CHECK`. | ⚪ | ✅ |
| 9.12 | **The account page showed raw database errors** when the profile failed to load. | ⚪ | ✅ |
| 9.13 | **`dev` and `main` had drifted.** `main` had two merge commits that `dev` didn't, though the files were identical. (Earlier versions of this file also said three commits on `dev` weren't pushed; they already were.) | ⚪ | ✅ |
| 9.14 | **Leftover duplicate service worker.** `public/firebase-messaging-sw.js` was never registered (the app uses `sw.js`), and both loaded Firebase 10.7 while the app uses Firebase 12. | ⚪ | ✅ |
| 9.15 | **Commits could carry AI attribution** (`Co-authored-by: Copilot`), against this repo's no-attribution rule. Three commits from 31 October already do. | ⚪ | ✅ |
| 9.16 | **Signing out didn't stop push notifications.** The sign-out cleanup unregistered the app's main service worker instead of the push token, and the token stayed linked to the account. After the next page load the device could get the previous user's notifications again. | 🟡 | ✅ |

---

## What the open issues need

These can't be finished from the code alone:

| # | What's needed |
|---|---|
| 1.3, 6.5, 6.7 | **A copy of the live database schema** (the structure only, no data), so the live-only tables and functions can be reviewed and added to the migrations. With the Supabase CLI: `supabase db dump --schema public -f supabase/live_schema.sql`. |
| 3.5 | **A manual review of seller wallets.** Old confirmations can't be told apart from new ones, so there's no safe automatic correction. The query below lists sellers to check. |
| 3.9, 6.6 | **The source of the six live-only server functions** in this repository, e.g. `supabase functions download paystack-process-payout`. |
| 5.2 | **A choice of ID verification provider** (Didit or Dojah) and its API keys. |
| 5.3 | **An SMS provider** (e.g. Termii, or Supabase phone sign-in) to send verification codes. |
| 8.10 | **The `promotions` table definition** (part of the schema copy above), so an admin "create promotion" form saves exactly what that table expects. |
| 9.1, 9.2 | **The result of the migration status check below**, run on the live database. It shows which migrations are really there, so the missing ones can be applied safely instead of guessed. |
| 9.6 | **A way to run the app in a browser** (a local `.env` with the Supabase URL and public key), so the React Router 7 upgrade can be tested before it ships. |

### Check which migrations the live database has (issues 9.1 and 9.2)

Run this in the Supabase SQL Editor; it only reads. Each row checks for one thing a migration creates, and `applied` shows `true` or `false`. A fully up-to-date database shows `true` on every row.

```sql
select m.migration, m.kind || ' ' || m.name as checks_for,
  case m.kind
    when 'table' then to_regclass('public.' || m.name) is not null
    when 'column' then exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = split_part(m.name, '.', 1) and column_name = split_part(m.name, '.', 2))
    when 'function' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = m.name)
    when 'constraint' then exists (select 1 from pg_constraint where conname = m.name)
    when 'policy' then exists (select 1 from pg_policies where policyname = m.name)
    when 'realtime' then exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = m.name)
    when 'bucket' then exists (select 1 from storage.buckets where id = m.name)
  end as applied
from (values
  ('0001', 'table', 'profiles'), ('0002', 'column', 'profiles.handle'),
  ('0003', 'function', 'generate_referral_code'), ('0004', 'column', 'profiles.last_seen_at'),
  ('0005', 'column', 'profiles.business_logo_url'), ('0006', 'column', 'conversations.seller_last_read_at'),
  ('0007', 'column', 'profiles.buyer_avg_rating'), ('0008', 'column', 'offers.delivery_speed'),
  ('0009', 'realtime', 'verification_requests'), ('0010', 'column', 'messages.is_read'),
  ('0011', 'column', 'offers.delivery_type'), ('0012', 'column', 'offers.variants'),
  ('0013', 'column', 'listings.services_included'), ('0014', 'table', 'notifications'),
  ('0016', 'function', 'record_payment_as_pending'), ('0017', 'table', 'message_attachments'),
  ('0018', 'function', 'notify_order_confirmed'), ('0019', 'bucket', 'message-attachments'),
  ('0020', 'table', 'disputes'), ('0021', 'function', 'get_admin_dashboard'),
  ('0022', 'function', 'mark_profile_as_seller_on_listing'), ('0023', 'column', 'notifications.related_dispute_id'),
  ('0024', 'policy', 'Admins can insert marketing notifications'), ('0025', 'function', 'mark_conversation_read'),
  ('0026', 'function', 'share_offer_delivery_address'), ('0027', 'column', 'profiles.paystack_recipient_code'),
  ('0028', 'table', 'profile_contacts'), ('0029', 'table', 'transaction_references'),
  ('0030', 'column', 'transaction_references.original_reference'),
  ('0031', 'constraint', 'transaction_references_reference_format'),
  ('0032', 'constraint', 'listings_price_valid'), ('0033', 'column', 'profiles.payout_connected'),
  ('0034', 'table', 'admin_audit_log'), ('0035', 'function', 'consume_rate_limit')
) as m(migration, kind, name)
order by m.migration;
```

(0015 isn't listed: it only re-adds columns from 0011.)

### Find wallets that may have been double-credited (issue 3.5)

Lists sellers whose cleared wallet is larger than everything they've earned. Withdrawals only lower a wallet, so anyone listed needs a closer look. Run it in the Supabase SQL Editor; it only reads data.

```sql
select p.id, p.business_name, p.wallet_cleared,
       coalesce(o.payouts, 0) as confirmed_payouts,
       coalesce(r.bonuses, 0) as referral_bonuses
from public.profiles p
left join (select seller_id, sum(seller_payout) as payouts from public.orders
           where status in ('confirmed', 'complete') group by seller_id) o on o.seller_id = p.id
left join (select referrer_id, sum(amount) as bonuses from public.referral_bonuses
           where status in ('cleared', 'paid') group by referrer_id) r on r.referrer_id = p.id
where p.wallet_cleared > coalesce(o.payouts, 0) + coalesce(r.bonuses, 0)
order by p.wallet_cleared - coalesce(o.payouts, 0) - coalesce(r.bonuses, 0) desc;
```

### Check for tables without row-level security

Row-level security (RLS) is the database's per-row access rules; a table without it can be read by anyone with the public key. Run this in the Supabase SQL Editor to list any public table that has it turned off (for issue 6.5):

```sql
select tablename from pg_tables
where schemaname = 'public' and not rowsecurity
order by tablename;
```

An empty result is what you want.
