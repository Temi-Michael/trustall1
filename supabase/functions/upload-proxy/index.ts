import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const form = await req.formData();
    const f = form.get('file') as File | null;
    if (!f) return new Response(JSON.stringify({ error: 'file is required' }), { status: 400, headers: corsHeaders });

    const filenameRaw = form.get('filename') || f.name;
    const filename = `${user.id}/${Date.now()}_${filenameRaw}`;

    const arrayBuffer = await f.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error: uploadError } = await admin.storage.from('message-attachments').upload(filename, uint8, { contentType: f.type });
    if (uploadError) {
      console.error('upload error', uploadError);
      return new Response(JSON.stringify({ error: uploadError.message || String(uploadError) }), { status: 500, headers: corsHeaders });
    }

    // The bucket is private, so callers get the storage path plus a short-lived signed URL.
    const { data } = await admin.storage.from('message-attachments').createSignedUrl(filename, 60 * 60);
    return new Response(JSON.stringify({ path: filename, signedUrl: data?.signedUrl || null }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('upload-proxy error', err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), { status: 500, headers: corsHeaders });
  }
});
