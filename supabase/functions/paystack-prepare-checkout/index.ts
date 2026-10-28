import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isUuid } from "../_shared/validate.ts";

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
    const offer_id = payload?.offer_id;
    if (!isUuid(offer_id)) {
      return new Response(JSON.stringify({ error: 'A valid offer_id is required' }), { status: 400, headers: corsHeaders });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: offer } = await admin
      .from('offers')
      .select('*, conversation:conversation_id(buyer_id, seller_id)')
      .eq('id', offer_id)
      .single();

    if (!offer) {
      return new Response(JSON.stringify({ error: 'Offer not found' }), { status: 404, headers: corsHeaders });
    }
    if (offer.conversation.buyer_id !== user.id) {
      return new Response(JSON.stringify({ error: 'This is not your offer to pay' }), { status: 403, headers: corsHeaders });
    }

    const { data: seller } = await admin.from('profiles').select('paystack_subaccount_code').eq('id', offer.conversation.seller_id).single();
    if (!seller?.paystack_subaccount_code) {
      return new Response(JSON.stringify({ error: "This seller hasn't finished connecting their payout account yet." }), { status: 400, headers: corsHeaders });
    }

    const itemTotal = Number(offer.price) + Number(offer.delivery_fee);
    const sellerFee = Math.min(Math.round(itemTotal * 0.05 * 100) / 100, 5000);
    const buyerFee = 100;
    const totalCharged = itemTotal + buyerFee;
    const transactionChargeKobo = Math.round((sellerFee + buyerFee) * 100);

    return new Response(JSON.stringify({
      success: true,
      subaccount_code: seller.paystack_subaccount_code,
      amount_kobo: Math.round(totalCharged * 100),
      transaction_charge_kobo: transactionChargeKobo,
      seller_fee: sellerFee,
      buyer_fee: buyerFee,
      total_charged: totalCharged,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
