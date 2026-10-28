import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { boundedText, escapeHtml } from "../_shared/validate.ts";
import { TOO_MANY_REQUESTS, withinRateLimit } from "../_shared/rateLimit.ts";

// Sends a notification email to the signed-in caller only. The recipient comes
// from the verified session and the HTML is built here from escaped plain text,
// so this cannot be used to email arbitrary addresses or arbitrary HTML.
Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user?.email) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (!(await withinRateLimit(admin, `email:${user.id}`, 10, 3600))) return json({ error: TOO_MANY_REQUESTS }, 429);

    const payload = await req.json().catch(() => null);
    const subject = boundedText(payload?.subject, 150);
    const body = boundedText(payload?.body, 2000);
    if (!subject || !body) return json({ error: 'subject (max 150 chars) and body (max 2000 chars) are required' }, 400);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY') || ''}`,
      },
      body: JSON.stringify({
        from: Deno.env.get('EMAIL_FROM') || 'Trustall <onboarding@resend.dev>',
        to: [user.email],
        subject: subject.replace(/[\r\n]+/g, ' '),
        html: `<p>${escapeHtml(body)}</p><p>Open your Trustall inbox to view it.</p>`,
      }),
    });

    if (!response.ok) return json({ error: 'Email could not be sent' }, 502);
    return json({ success: true });
  } catch (error) {
    console.error('send-notification-email failed', error);
    return json({ error: 'Email could not be sent' }, 500);
  }
});
