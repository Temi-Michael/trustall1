import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { TOO_MANY_REQUESTS, withinRateLimit } from "../_shared/rateLimit.ts";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (!(await withinRateLimit(admin, `upload:${user.id}`, 30, 600))) {
      return new Response(JSON.stringify({ error: TOO_MANY_REQUESTS }), { status: 429, headers: corsHeaders });
    }

    const form = await req.formData();
    const f = form.get('file');
    if (!(f instanceof File)) return new Response(JSON.stringify({ error: 'file is required' }), { status: 400, headers: corsHeaders });
    if (f.size > MAX_UPLOAD_BYTES) return new Response(JSON.stringify({ error: 'File is larger than 20 MB' }), { status: 413, headers: corsHeaders });
    if (!/^(image|video)\//.test(f.type)) return new Response(JSON.stringify({ error: 'Only images and videos can be uploaded' }), { status: 415, headers: corsHeaders });

    // Keep only safe characters so the name can't add folders or break the path.
    const filenameRaw = String(form.get('filename') || f.name);
    const safeName = filenameRaw.replace(/[^\w.-]+/g, '_').replace(/^[._-]+/, '').slice(-100) || 'file';
    const filename = `${user.id}/${Date.now()}_${safeName}`;

    const arrayBuffer = await f.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await admin.storage.from('message-attachments').upload(filename, uint8, { contentType: f.type });
    if (uploadError) {
      console.error('upload error', uploadError);
      return new Response(JSON.stringify({ error: 'The file could not be uploaded. Please try again.' }), { status: 500, headers: corsHeaders });
    }

    // The bucket is private, so callers get the storage path plus a short-lived signed URL.
    const { data } = await admin.storage.from('message-attachments').createSignedUrl(filename, 60 * 60);
    return new Response(JSON.stringify({ path: filename, signedUrl: data?.signedUrl || null }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('upload-proxy error', err?.message || err);
    return new Response(JSON.stringify({ error: 'The file could not be uploaded. Please try again.' }), { status: 500, headers: corsHeaders });
  }
});
