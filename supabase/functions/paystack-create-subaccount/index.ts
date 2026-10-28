import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization')!;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const payload = await req.json().catch(() => null);
    const bank_code = String(payload?.bank_code ?? '').trim();
    const account_number = String(payload?.account_number ?? '').replace(/\s+/g, '');
    if (!/^\d{2,6}$/.test(bank_code) || !/^\d{10}$/.test(account_number)) {
      return new Response(JSON.stringify({ error: 'Select a valid bank and enter a 10-digit account number.' }), { status: 400, headers: corsHeaders });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: profile } = await admin.from('profiles').select('business_name, full_name').eq('id', user.id).single();

    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!paystackSecret) {
      return new Response(JSON.stringify({ error: 'Paystack is not configured yet on the server.' }), { status: 500, headers: corsHeaders });
    }

    const paystackRes = await fetch('https://api.paystack.co/subaccount', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        business_name: profile?.business_name || profile?.full_name || 'Trustall Seller',
        settlement_bank: bank_code,
        account_number,
        percentage_charge: 5,
      }),
    });
    const result = await paystackRes.json();

    if (!result.status) {
      return new Response(JSON.stringify({ error: result.message || 'Could not create subaccount' }), { status: 400, headers: corsHeaders });
    }

    const { data: updatedProfile, error: profileUpdateError } = await admin
      .from('profiles')
      .update({ paystack_subaccount_code: result.data.subaccount_code })
      .eq('id', user.id)
      .select('id')
      .maybeSingle();

    if (profileUpdateError || !updatedProfile) {
      console.error('Failed to save Paystack subaccount code:', profileUpdateError);
      return new Response(JSON.stringify({ error: 'Paystack created the subaccount, but Trustall could not save it. Please contact support before trying again.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, subaccount_code: result.data.subaccount_code }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
