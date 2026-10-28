# Updates

New features and tools added in October 2026. Bug and security fixes are in [fix.md](fix.md); open problems are in [issues.md](issues.md).

---

## 1. Transaction references

Every money movement gets a readable, unique reference:

```
TRUST-PAY-YBENA62B67JS
│     │   └─ 12 random characters (always at least one letter and one digit)
│     └─ transaction type
└─ always TRUST
```

| Type | Code | Example |
|---|---|---|
| Account top-up | `TOP` | `TRUST-TOP-K7ZHNYB6X8RM` |
| Withdrawal / payout | `PAY` | `TRUST-PAY-MDAPUEQEJM3L` |
| Order payment | `ORD` | `TRUST-ORD-2AEF47X9QP3W` |
| Promotion payment | `PRM` | `TRUST-PRM-…` |
| Refund | `RFD` | `TRUST-RFD-…` |
| Reversal | `REV` | `TRUST-REV-…` |
| Pro Vendor upgrade | `VND` | `TRUST-VND-…` |

**How references work**
- **Hard to guess:** they're made on the server from a secure random source, never from the time or the amount, which could be worked out. With 12 characters there are about a quintillion possibilities.
- **Easy to read aloud:** `0`, `O`, `1` and `I` are left out, so references don't get mixed up over the phone or in support chats.
- **Recorded and tied to one purpose:** every reference is stored in the `transaction_references` table with who it belongs to and what it pays for. An order reference only works for that buyer and that offer, and only once.
- **Refunds and reversals point back:** each one must record the original payment's reference, so any refund can be traced to its payment.
- **Older references:** 8-character references issued before the switch stay valid.
- **In use now:** order checkout. Withdrawals, refunds and promotions will switch over once their server functions are added to this repository (issue 3.9). Top-ups don't exist yet; `TOP` is reserved for them.

**For developers**
- **Server functions:** create a reference with `new_transaction_reference(kind, owner_id, subject_id, original_reference)`, using the service role.
- **Checkout in the browser:** get a reference with the `issue_order_payment_reference(offer_id)` RPC.

## 2. One migration file for the SQL Editor

`supabase/all_migrations.sql` contains every migration in the right order, as a single script.

- **Safe to run again:** each migration records itself in `private.applied_migrations` when it runs and is skipped next time, so you can paste the whole file as often as you like.
- **All or nothing:** if anything fails, the error names the migration and nothing is changed.
- **First run on the existing live database:** it detects that the database was set up before history was tracked, records migrations 0001–0027 as already applied, and runs only what's new.

**Adding a migration**
1. Create the next numbered file in `supabase/migrations/`, e.g. `0033_something.sql`.
2. Run `npm run db:bundle` to add it to the end of `all_migrations.sql`.
3. Paste `all_migrations.sql` into the Supabase SQL Editor and click **Run**.

`npm run db:bundle:check` reports if `all_migrations.sql` is out of date.

## 3. Hide balances

Users can hide their money amounts, like in a banking app. An eye button next to the balances switches them to `₦ ••••••`. The mask is always the same length, so it doesn't hint at the size of the real number.

- **Where:** the seller dashboard (Revenue and Available) and the Refer page (Cleared and Pending).
- **Remembered per device:** the choice survives reloads and applies to every balance on screen and in other tabs.
- **For developers:** use `useBalanceVisibility()` with `formatBalance(amount, hidden)` and `<BalanceToggle />` to add it anywhere else.

## 4. Other additions

| What | Where | What it does |
|---|---|---|
| Private profile fields | `0033_private_profile_fields.sql` | Hides wallets, payout codes, warnings and referral data from the public (see [fix.md](fix.md) 1.4). |
| `get_my_profile()` / `admin_get_profiles()` | Database functions | How the owner and admins read the hidden fields. |
| `payout_connected` | `profiles` column | Public yes/no showing whether a seller can be paid, without revealing the payout code. |
| Public column list | `src/lib/profileFields.js` | Use `select(PUBLIC_PROFILE_COLUMNS)` for other people's profiles. `select('*')` on `profiles` no longer works, because it asks for hidden columns. |
| **Reveal ID** button | Admin → Seller verification | Shows a seller's full ID number on request. Only admins can use it. |
| Private contact details | `profile_contacts` table | Holds phone numbers away from the public profile. |
| Mark as delivered | `mark_order_fulfilled()` | The safe way for a seller to mark an order delivered. |
| Input helpers | `src/lib/inputSafety.js` | `escapeLikePattern()` for searches and `safeFileName()` for uploads, with tests. |
| HTML cleaner | `src/lib/sanitizeHtml.js` | Cleans blog HTML before display, using DOMPurify (new dependency). |
| Server input checks | `supabase/functions/_shared/validate.ts` | Shared checks for IDs, text length, HTML escaping and secrets. |
| `disputes` migration | `0020_disputes_table.sql` | Lets a fresh database be built from migrations alone. |
| Storage limits | `0032_input_constraints.sql` | File size and type limits for each upload bucket. |

**Adding a new public profile column:** add a grant to its migration, or nobody will be able to read it:

```sql
grant select (new_column) on public.profiles to anon, authenticated;
```

## 5. Rolling this out

1. **Database:** paste `supabase/all_migrations.sql` into the Supabase SQL Editor and click **Run**.
2. **Server functions:** deploy the changed ones:
   ```bash
   supabase functions deploy paystack-verify-payment paystack-prepare-checkout paystack-create-subaccount send-notification-email send-push-notification ai-matchmaker upload-proxy
   ```
3. **Push secret:** set the push secret and send it from the database webhook. Push notifications stop until both are done.
   - In Supabase → Edge Functions → Secrets, add `PUSH_WEBHOOK_SECRET` with a long random value.
   - In the database webhook that calls `send-push-notification`, add the header `x-push-secret` with the same value.
4. **Frontend:** deploy it straight after step 2. The old frontend still writes phone numbers to the old place and builds its own payment references, so it stops working once the database is updated.
5. **Check:**
   - In the admin dashboard, confirm analytics loads. If it says "not deployed", migration 0021 was recorded as applied but never actually ran. Run this in the SQL Editor, then paste `all_migrations.sql` again:
     ```sql
     delete from private.applied_migrations where name = '0021_admin_dashboard_audit.sql';
     ```
   - Try filing a dispute end to end (issue 6.7).
