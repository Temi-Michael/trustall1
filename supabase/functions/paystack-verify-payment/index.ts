import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isUuid } from "../_shared/validate.ts";
import { TOO_MANY_REQUESTS, withinRateLimit } from "../_shared/rateLimit.ts";

// Issued order references: 12-character suffix now, 8 for ones issued earlier.
const ORDER_REFERENCE = /^TRUST-ORD-(?:[A-HJ-NP-Z2-9]{8}|[A-HJ-NP-Z2-9]{12})$/;

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
    const reference = payload?.reference;
    const offer_id = payload?.offer_id;
    if (typeof reference !== 'string' || !ORDER_REFERENCE.test(reference) || !isUuid(offer_id)) {
      return new Response(JSON.stringify({ error: 'A valid payment reference and offer_id are required' }), { status: 400, headers: corsHeaders });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // Generous: a real buyer verifies once per payment.
    if (!(await withinRateLimit(admin, `verify:${user.id}`, 20, 600))) {
      return new Response(JSON.stringify({ error: TOO_MANY_REQUESTS }), { status: 429, headers: corsHeaders });
    }

    // The reference must have been issued to this buyer for this offer and not used yet.
    const { data: issued } = await admin
      .from('transaction_references')
      .select('reference')
      .eq('reference', reference)
      .eq('kind', 'order_payment')
      .eq('owner_id', user.id)
      .eq('subject_id', offer_id)
      .is('consumed_at', null)
      .maybeSingle();
    if (!issued) {
      return new Response(JSON.stringify({ error: 'Unknown or already used payment reference' }), { status: 400, headers: corsHeaders });
    }

    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!paystackSecret) {
      return new Response(JSON.stringify({ error: 'Paystack is not configured yet on the server.' }), { status: 500, headers: corsHeaders });
    }

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { 'Authorization': `Bearer ${paystackSecret}` },
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.status || verifyData.data.status !== 'success') {
      return new Response(JSON.stringify({ error: 'Payment could not be verified' }), { status: 400, headers: corsHeaders });
    }

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
    if (offer.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'This offer is no longer payable' }), { status: 400, headers: corsHeaders });
    }

    const itemTotal = Number(offer.price) + Number(offer.delivery_fee);
    const sellerFee = Math.min(Math.round(itemTotal * 0.05 * 100) / 100, 5000);
    const buyerFee = 100;
    const expectedTotal = itemTotal + buyerFee;
    const sellerPayout = itemTotal - sellerFee;

    const amountPaidNaira = verifyData.data.amount / 100;
    if (Math.abs(amountPaidNaira - expectedTotal) > 1) {
      return new Response(JSON.stringify({ error: 'Amount paid does not match the offer' }), { status: 400, headers: corsHeaders });
    }

    const { data: order, error: orderError } = await admin.from('orders').insert({
      offer_id: offer.id,
      buyer_id: offer.conversation.buyer_id,
      seller_id: offer.conversation.seller_id,
      amount: offer.price,
      delivery_fee: offer.delivery_fee,
      seller_fee: sellerFee,
      buyer_fee: buyerFee,
      platform_commission: sellerFee + buyerFee,
      seller_payout: sellerPayout,
      paystack_reference: reference,
      status: 'paid',
      delivery_speed: offer.delivery_speed || 'standard',
      delivery_address: offer.delivery_address || null,
      delivery_date: offer.delivery_date || null,
      delivery_time: offer.delivery_time || null,
      delivery_deadline: offer.delivery_deadline || null,
    }).select().single();

    if (orderError) {
      console.error('Order insert failed', orderError);
      // 23505: unique index on paystack_reference, i.e. this payment already has an order.
      const message = orderError.code === '23505'
        ? 'This payment has already been recorded.'
        : 'Payment received, but the order could not be created. Please contact support with your reference.';
      return new Response(JSON.stringify({ error: message }), { status: orderError.code === '23505' ? 409 : 500, headers: corsHeaders });
    }

    await admin.from('offers').update({ status: 'accepted' }).eq('id', offer.id);
    await admin.from('transaction_references').update({ consumed_at: new Date().toISOString() }).eq('reference', reference);

    return new Response(JSON.stringify({ success: true, order }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('paystack-verify-payment failed', err);
    return new Response(JSON.stringify({ error: 'Something went wrong while confirming your payment.' }), { status: 500, headers: corsHeaders });
  }
});
