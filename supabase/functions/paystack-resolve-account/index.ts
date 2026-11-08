// Looks up the name on a Nigerian bank account (Paystack "resolve account
// number"), so a seller can check it's really their account before connecting
// it for payouts. Read-only: nothing is saved, and the account number is
// never logged.
//
// A name lookup can be misused to collect strangers' names, so it is limited
// to signed-in, verified accounts (migration 0040) and to 5 lookups an hour.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { TOO_MANY_REQUESTS, withinRateLimit } from "../_shared/rateLimit.ts";
import { corsHeadersFor, rejectOtherOrigins } from "../_shared/cors.js";
import { missingPaymentRequirements, VERIFICATION_REQUIRED_MESSAGE } from "../_shared/paymentReadiness.ts";

const LOOKUPS_PER_HOUR = 5;
const NOT_FOUND_MESSAGE = "We couldn't find that account. Check the bank and the 10-digit account number.";

Deno.serve(async (request) => {
  const corsHeaders = { ...corsHeadersFor(request), "Content-Type": "application/json" };
  const jsonResponse = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: corsHeaders });

  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const otherSite = rejectOtherOrigins(request, corsHeaders);
  if (otherSite) return otherSite;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !paystackSecret) {
      console.error("Account lookup requires Supabase URL, anon/service role keys, and PAYSTACK_SECRET_KEY.");
      return jsonResponse({ error: "Account lookup is not configured. Please contact Trustall support." }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Your session has expired. Please sign in again." }, 401);

    const missing = await missingPaymentRequirements(userClient);
    if (missing?.length) return jsonResponse({ error: VERIFICATION_REQUIRED_MESSAGE, missing }, 403);

    let requestBody: { bank_code?: unknown; account_number?: unknown };
    try {
      requestBody = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid request body." }, 400);
    }

    // Same checks as the payout functions, so a name shown here always
    // matches what they will accept.
    const bankCode = String(requestBody.bank_code || "").trim();
    const accountNumber = String(requestBody.account_number || "").replace(/\s+/g, "");
    if (!/^\d{2,6}$/.test(bankCode) || !/^\d{10}$/.test(accountNumber)) {
      return jsonResponse({ error: "Select a valid bank and enter a 10-digit account number." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    if (!(await withinRateLimit(admin, `resolve-account:${user.id}`, LOOKUPS_PER_HOUR, 3600))) {
      return jsonResponse({ error: TOO_MANY_REQUESTS }, 429);
    }

    const query = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
    const paystackResponse = await fetch(`https://api.paystack.co/bank/resolve?${query}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` },
    });
    const paystackResult = await paystackResponse.json().catch(() => null);
    const accountName = paystackResult?.data?.account_name;

    if (!paystackResponse.ok || !paystackResult?.status || typeof accountName !== "string" || !accountName.trim()) {
      // 4xx: Paystack couldn't match the account. Anything else is on their side.
      const notFound = paystackResponse.status >= 400 && paystackResponse.status < 500;
      console.warn("Account lookup failed:", paystackResponse.status);
      return notFound
        ? jsonResponse({ error: NOT_FOUND_MESSAGE }, 404)
        : jsonResponse({ error: "The bank couldn't be reached. Please try again in a moment." }, 502);
    }

    return jsonResponse({ success: true, account_name: accountName.trim() });
  } catch (error) {
    console.error("Account lookup failed:", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: "Account lookup could not be completed. Please try again." }, 500);
  }
});
