import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { isUuid } from "../_shared/validate.ts";
import { TOO_MANY_REQUESTS, withinRateLimit } from "../_shared/rateLimit.ts";
import { BLOCKED_MESSAGE, parseScreeningReply, SCREENING_PROMPT, UNAVAILABLE_MESSAGE } from "../_shared/mediaScreening.js";

// Screens a chat photo or video before the other person can see it.
// The browser uploads to <conversation>/pending/<sender>/<file>, which only the
// sender can read (migration 0037), then calls this with the message it belongs
// to. Clean files are moved into <conversation>/<file> and attached to the
// message; files showing contact or bank details, or that can't be checked,
// are deleted. Only this function can create attachment records.

const BUCKET = "message-attachments";
// AI providers accept inline files up to about 20 MB.
const MAX_SCREEN_BYTES = 20 * 1024 * 1024;
const PENDING_PATH = /^([0-9a-f-]{36})\/pending\/([0-9a-f-]{36})\/([\w.-]{1,150})$/i;

type Verdict = { status: "clean" | "blocked" | "unavailable"; reason?: string };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function screenWithGemini(key: string, mimeType: string, data: string): Promise<Verdict> {
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: SCREENING_PROMPT }, { inline_data: { mime_type: mimeType, data } }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("Gemini screening failed", response.status, result?.error?.message);
    return { status: "unavailable", reason: "provider_error" };
  }
  const text = result?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("");
  return toVerdict(text);
}

async function screenWithOpenAi(key: string, mimeType: string, data: string): Promise<Verdict> {
  const model = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: SCREENING_PROMPT },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } },
        ],
      }],
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("OpenAI screening failed", response.status, result?.error?.message);
    return { status: "unavailable", reason: "provider_error" };
  }
  return toVerdict(result?.choices?.[0]?.message?.content);
}

function toVerdict(text: unknown): Verdict {
  const reply = parseScreeningReply(text);
  if (!reply.valid) return { status: "unavailable", reason: "unclear_reply" };
  return reply.containsContactDetails ? { status: "blocked", reason: reply.reason ?? undefined } : { status: "clean" };
}

// Gemini can check photos and videos; OpenAI only photos. With neither key set,
// nothing can be checked, so nothing is sent.
async function screen(file: Blob, mimeType: string, isVideo: boolean): Promise<Verdict> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!geminiKey && (!openAiKey || isVideo)) {
    console.error("screen-chat-image: no AI key that can check this file", { isVideo });
    return { status: "unavailable", reason: "no_ai_key" };
  }
  const data = encodeBase64(new Uint8Array(await file.arrayBuffer()));
  try {
    return geminiKey ? await screenWithGemini(geminiKey, mimeType, data) : await screenWithOpenAi(openAiKey!, mimeType, data);
  } catch (error) {
    console.error("screen-chat-image: screening request failed", error);
    return { status: "unavailable", reason: "provider_error" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const payload = await req.json().catch(() => null);
    const messageId = payload?.message_id;
    const path = typeof payload?.path === "string" ? payload.path : "";
    const final = payload?.final === true;
    const match = path.match(PENDING_PATH);
    if (!isUuid(messageId) || !match || match[2].toLowerCase() !== user.id.toLowerCase()) {
      return json({ error: "A valid message_id and your own pending upload path are required" }, 400);
    }
    const [, conversationId, , fileName] = match;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (!(await withinRateLimit(admin, `chat-media:${user.id}`, 40, 600))) return json({ error: TOO_MANY_REQUESTS }, 429);

    const { data: message } = await admin
      .from("messages")
      .select("id, conversation_id, sender_id, body")
      .eq("id", messageId)
      .maybeSingle();
    if (!message || message.sender_id !== user.id || message.conversation_id !== conversationId) {
      return json({ error: "Message not found" }, 404);
    }

    // When this is the last file and nothing got through, drop the empty message.
    async function finishBlocked(notice: string) {
      await admin.storage.from(BUCKET).remove([path]);
      let messageRemoved = false;
      if (final && !String(message!.body || "").trim()) {
        const { count } = await admin
          .from("message_attachments")
          .select("id", { count: "exact", head: true })
          .eq("message_id", message!.id);
        if (!count) {
          await admin.from("messages").delete().eq("id", message!.id);
          messageRemoved = true;
        }
      }
      return json({ blocked: true, message: notice, message_removed: messageRemoved });
    }

    const { data: file, error: downloadError } = await admin.storage.from(BUCKET).download(path);
    if (downloadError || !file) return json({ error: "Upload not found" }, 404);

    const mimeType = file.type || "application/octet-stream";
    const isVideo = mimeType.startsWith("video/");
    if (!isVideo && !mimeType.startsWith("image/")) return finishBlocked("Only photos and videos can be sent in chat.");
    if (file.size > MAX_SCREEN_BYTES) return finishBlocked("This file is too large to check. Please send one under 20 MB.");

    const verdict = await screen(file, mimeType, isVideo);
    if (verdict.status === "blocked") {
      console.log("screen-chat-image: blocked", { messageId, reason: verdict.reason });
      return finishBlocked(BLOCKED_MESSAGE);
    }
    if (verdict.status !== "clean") return finishBlocked(UNAVAILABLE_MESSAGE);

    const finalPath = `${conversationId}/${fileName}`;
    const { error: moveError } = await admin.storage.from(BUCKET).move(path, finalPath);
    if (moveError) {
      console.error("screen-chat-image: move failed", moveError);
      return json({ error: "The file could not be sent. Please try again." }, 500);
    }

    const { data: attachment, error: insertError } = await admin
      .from("message_attachments")
      .insert({ message_id: message.id, file_url: finalPath, file_type: isVideo ? "video" : "image" })
      .select("id, message_id, file_url, file_type")
      .single();
    if (insertError) {
      console.error("screen-chat-image: attachment insert failed", insertError);
      await admin.storage.from(BUCKET).remove([finalPath]);
      return json({ error: "The file could not be sent. Please try again." }, 500);
    }

    return json({ blocked: false, attachment });
  } catch (error) {
    console.error("screen-chat-image failed", error);
    return json({ error: "The file could not be sent. Please try again." }, 500);
  }
});
