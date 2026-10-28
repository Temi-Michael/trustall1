import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { TOO_MANY_REQUESTS, withinRateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !paystackSecret) {
      console.error("Recipient setup requires Supabase URL, anon/service role keys, and PAYSTACK_SECRET_KEY.");
      return jsonResponse({ error: "Payout setup is not configured. Please contact Trustall support." }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Your session has expired. Please sign in again." }, 401);

    let requestBody: { bank_code?: unknown; account_number?: unknown };
    try {
      requestBody = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid request body." }, 400);
    }

    const bankCode = String(requestBody.bank_code || "").trim();
    const accountNumber = String(requestBody.account_number || "").replace(/\s+/g, "");
    if (!/^\d{2,6}$/.test(bankCode) || !/^\d{10}$/.test(accountNumber)) {
      return jsonResponse({ error: "Select a valid bank and enter a 10-digit account number." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    if (!(await withinRateLimit(admin, `recipient:${user.id}`, 5, 3600))) {
      return jsonResponse({ error: TOO_MANY_REQUESTS }, 429);
    }
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("business_name, full_name, paystack_recipient_code")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Could not load seller profile for Paystack recipient:", profileError);
      return jsonResponse({ error: "Could not load your seller profile. Please try again." }, 500);
    }
    if (!profile) return jsonResponse({ error: "Complete your seller profile before connecting a payout account." }, 400);
    if (profile.paystack_recipient_code) {
      return jsonResponse({ success: true, recipient_code: profile.paystack_recipient_code });
    }

    const paystackResponse = await fetch("https://api.paystack.co/transferrecipient", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "nuban",
        name: profile.business_name || profile.full_name || "Trustall Seller",
        account_number: accountNumber,
        bank_code: bankCode,
        currency: "NGN",
      }),
    });
    const paystackResult = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackResult.status || !paystackResult.data?.recipient_code) {
      console.error("Paystack recipient creation failed:", paystackResult.message || paystackResponse.status);
      return jsonResponse({ error: paystackResult.message || "Paystack could not verify this bank account." }, 400);
    }

    const recipientCode = paystackResult.data.recipient_code as string;
    const { error: updateError } = await admin
      .from("profiles")
      .update({ paystack_recipient_code: recipientCode })
      .eq("id", user.id);

    if (updateError) {
      console.error("Could not save Paystack recipient code:", updateError);
      return jsonResponse({ error: "Paystack verified the account, but Trustall could not save it. Please contact support before retrying." }, 500);
    }

    return jsonResponse({ success: true, recipient_code: recipientCode });
  } catch (error) {
    console.error("Paystack recipient setup failed:", error);
    return jsonResponse({ error: "Payout setup could not be completed. Please try again." }, 500);
  }
});
