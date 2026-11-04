import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { clientIp, TOO_MANY_REQUESTS, withinRateLimit } from "../_shared/rateLimit.ts";

// Shown to users instead of provider or configuration errors, which stay in the logs.
const UNAVAILABLE = 'The assistant is unavailable right now. Please try again later.'

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Open to signed-out visitors, so limit by address: 20 questions per 10 minutes.
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    if (!(await withinRateLimit(admin, `ai:${clientIp(req)}`, 20, 600))) {
      return new Response(JSON.stringify({ error: TOO_MANY_REQUESTS }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json().catch(() => ({}))
    // Cap the prompt so a single request can't run up the AI bill.
    const query = typeof body?.query === 'string' ? body.query.trim().slice(0, 500) : ''
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY')
    const openAiApiKey = Deno.env.get('OPENAI_API_KEY')

    const prompt = query || 'Hello, please tell me about Trustall and how it works.'

    if (geminiApiKey) {
      // Set GEMINI_MODEL in the project secrets to switch models without a deploy.
      const geminiModel = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash'
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': geminiApiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text:
                      'You are Trustall AI, a marketplace assistant for a verified peer-to-peer buying and selling platform in Nigeria. Give concise, friendly, and secure advice about finding verified sellers, how escrow payments work, and how Trustall protects both buyers and sellers.\n\nUser question: ' + prompt,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 250,
            },
          }),
        }
      )

      const geminiData = await geminiResponse.json()

      if (!geminiResponse.ok) {
        console.error('Gemini request failed:', geminiData)
        return new Response(JSON.stringify({ error: UNAVAILABLE }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const reply =
        geminiData.candidates?.[0]?.content?.parts
          ?.map((part: any) => part.text)
          .join('')
          ?.trim() ||
        'Sorry, I could not generate a response right now. Please try again.'

      return new Response(JSON.stringify({ reply }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!openAiApiKey) {
      console.error('ai-matchmaker: no AI API key configured. Add GEMINI_API_KEY or OPENAI_API_KEY in the project secrets.')
      return new Response(JSON.stringify({ error: UNAVAILABLE }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const promptMessages = [
      {
        role: 'system',
        content:
          'You are Trustall AI, a marketplace assistant for a verified peer-to-peer buying and selling platform in Nigeria. Give concise, friendly, and secure advice about finding verified sellers, how escrow payments work, and how Trustall protects both buyers and sellers.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ]

    const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiApiKey}`,
      },
      // Set OPENAI_MODEL in the project secrets to switch models without a deploy.
      // Newer models take max_completion_tokens and only their default temperature.
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini',
        messages: promptMessages,
        max_completion_tokens: 2000,
      }),
    })

    const openAiData = await openAiResponse.json()

    if (!openAiResponse.ok) {
      console.error('OpenAI request failed:', openAiData)
      return new Response(JSON.stringify({ error: UNAVAILABLE }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const reply =openAiData.choices?.[0]?.message?.content?.trim() ||
      'Sorry, I could not generate a response right now. Please try again.'

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('ai-matchmaker error', err)
    return new Response(JSON.stringify({ error: UNAVAILABLE }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
