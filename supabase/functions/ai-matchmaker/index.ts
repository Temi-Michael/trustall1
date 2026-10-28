import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
    const body = await req.json().catch(() => ({}))
    // Cap the prompt so a single request can't run up the AI bill.
    const query = typeof body?.query === 'string' ? body.query.trim().slice(0, 500) : ''
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY')
    const openAiApiKey = Deno.env.get('OPENAI_API_KEY')

    const prompt = query || 'Hello, please tell me about Trustall and how it works.'

    if (geminiApiKey) {
      const geminiResponse = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(geminiApiKey),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
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
        return new Response(JSON.stringify({ error: geminiData?.error?.message || 'Gemini request failed.' }), {
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
      return new Response(JSON.stringify({ error: 'No AI API key configured. Add GEMINI_API_KEY or OPENAI_API_KEY in your Supabase project secrets.' }), {
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
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: promptMessages,
        max_tokens: 250,
        temperature: 0.7,
      }),
    })

    const openAiData = await openAiResponse.json()

    if (!openAiResponse.ok) {
      console.error('OpenAI request failed:', openAiData)
      return new Response(JSON.stringify({ error: openAiData.error?.message || 'OpenAI request failed.' }), {
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
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
