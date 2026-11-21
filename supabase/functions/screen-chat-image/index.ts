import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { isUuid } from "../_shared/validate.ts";
import { TOO_MANY_REQUESTS, withinRateLimit } from "../_shared/rateLimit.ts";
import { BLOCKED_MESSAGE, parseScreeningReply, SCREENING_PROMPT, UNAVAILABLE_MESSAGE } from "../_shared/mediaScreening.js";
import { corsHeadersFor, rejectOtherOrigins } from "../_shared/cors.js";
import {
  checkedPathFor,
  CONTACT_DETAILS_MESSAGE,
  finalPathFor,
  isColumnPermissionError,
  parsePendingPath,
  readSendRequest,
  SEND_FAILED_MESSAGE,
} from "../_shared/chatMedia.js";

// Screens chat photos and videos before the other person can see them, and
// sends messages that have them. Only this function can create attachment
// records. Paths and the order of steps: _shared/chatMedia.js.
//
// The website sends a message with photos in two steps, so nothing half-sent
// reaches the other person if the sender leaves part way through:
//   { action: "check", path }  once per uploaded file: screens it and moves a
//     clean one to checked/…; files showing contact or bank details, or that
//     can't be checked, are deleted.
//   { action: "send", conversation_id, message_id, body, paths }  saves the
//     message and attaches its checked files together.
// A request without "action" is the older one-step form ({ message_id, path,
// final }: the message was saved first, then each file checked and attached).
// It's kept for copies of the old website still open during an update.

const BUCKET = "message-attachments";
// AI providers accept inline files up to about 20 MB.
const MAX_SCREEN_BYTES = 20 * 1024 * 1024;
// Older one-step form only; the check and send steps use _shared/chatMedia.js.
const PENDING_PATH = /^([0-9a-f-]{36})\/pending\/([0-9a-f-]{36})\/([\w.-]{1,150})$/i;

type Verdict = { status: "clean" | "blocked" | "unavailable"; reason?: string };

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

type Json = (body: unknown, status?: number) => Response;
type Context = { userId: string; admin: SupabaseClient; userClient: SupabaseClient; json: Json };
type Moved = { from: string; to: string; kind: string };

async function isParticipant(admin: SupabaseClient, conversationId: string, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .maybeSingle();
  if (error) console.error("screen-chat-image: conversation lookup failed", error);
  return Boolean(data);
}

// Puts files back where they came from after a send that couldn't finish, so
// the browser can send them again without another upload and check.
async function undoMoves(admin: SupabaseClient, moved: Moved[]) {
  for (const file of moved) {
    const { error } = await admin.storage.from(BUCKET).move(file.to, file.from);
    if (error) console.error("screen-chat-image: couldn't move a file back", { path: file.to, error });
  }
}

// ---------------------------------------------------------------------------
// Step 1: check one uploaded file.
// ---------------------------------------------------------------------------
async function checkUpload({ userId, admin, json }: Context, payload: Record<string, unknown> | null) {
  const path = typeof payload?.path === "string" ? payload.path : "";
  const pending = parsePendingPath(path, userId);
  if (!pending) return json({ error: "Your own pending upload path is required" }, 400);
  if (!(await isParticipant(admin, pending.conversationId, userId))) return json({ error: "Conversation not found" }, 404);

  // "blocked": sending it again won't help. "failed": it might next time.
  // Either way the upload is deleted; the browser still has the file.
  const reject = async (status: "blocked" | "failed", message: string) => {
    await admin.storage.from(BUCKET).remove([path]);
    return json({ status, message });
  };

  if (!(await withinRateLimit(admin, `chat-media:${userId}`, 40, 600))) return reject("failed", TOO_MANY_REQUESTS);

  const { data: file, error: downloadError } = await admin.storage.from(BUCKET).download(path);
  if (downloadError || !file) {
    return json({ status: "failed", message: "The photo or video didn't finish uploading. Please send it again." });
  }

  const mimeType = file.type || "application/octet-stream";
  const isVideo = mimeType.startsWith("video/");
  if (!isVideo && !mimeType.startsWith("image/")) return reject("blocked", "Only photos and videos can be sent in chat.");
  if (file.size > MAX_SCREEN_BYTES) return reject("blocked", "This file is too large to check. Please send one under 20 MB.");

  const verdict = await screen(file, mimeType, isVideo);
  if (verdict.status === "blocked") {
    console.log("screen-chat-image: blocked", { path, reason: verdict.reason });
    return reject("blocked", BLOCKED_MESSAGE);
  }
  if (verdict.status !== "clean") return reject("failed", UNAVAILABLE_MESSAGE);

  const checkedPath = checkedPathFor(pending.conversationId, userId, isVideo ? "video" : "image", pending.fileName);
  const { error: moveError } = await admin.storage.from(BUCKET).move(path, checkedPath);
  if (moveError) {
    console.error("screen-chat-image: move to checked failed", moveError);
    return reject("failed", "The file could not be sent. Please try again.");
  }
  return json({ status: "clean", path: checkedPath });
}

// ---------------------------------------------------------------------------
// Step 2: save the message and attach its checked files, together.
// ---------------------------------------------------------------------------
async function sendMessage({ userId, admin, userClient, json }: Context, payload: Record<string, unknown> | null) {
  const request = readSendRequest(payload, userId);
  if (!request.ok) return json({ error: request.error }, 400);
  const { conversationId, messageId, body, files } = request;
  if (!(await isParticipant(admin, conversationId, userId))) return json({ error: "Conversation not found" }, 404);

  // The browser picks the message ID, so tapping send again after a reply was
  // lost returns the message already sent instead of making a second copy.
  async function alreadySent() {
    const { data: existing } = await admin
      .from("messages")
      .select("*")
      .eq("id", messageId)
      .maybeSingle();
    if (!existing) return null;
    if (existing.sender_id !== userId || existing.conversation_id !== conversationId) {
      return json({ error: "This message ID is already used" }, 409);
    }
    // Files uploaded again for the repeat aren't needed.
    if (files.length) await admin.storage.from(BUCKET).remove(files.map((file) => file.path));
    const { data: attachments } = await admin
      .from("message_attachments")
      .select("id, message_id, file_url, file_type")
      .eq("message_id", messageId);
    return json({ sent: true, already_sent: true, message: existing, attachments: attachments ?? [] });
  }

  const repeat = await alreadySent();
  if (repeat) return repeat;

  // Text with contact details is refused before any file moves (the same rule
  // the messages table applies, migration 0037), so the checked files stay put
  // and go with the corrected text.
  if (body) {
    const { data: violation, error: violationError } = await admin.rpc("chat_contact_violation", { p_text: body });
    if (violationError) console.error("screen-chat-image: contact check failed; the table's own check still applies", violationError);
    else if (violation) return json({ sent: false, code: "TC001", message: CONTACT_DETAILS_MESSAGE });
  }

  // Files first: if one can't be moved, nothing has been saved yet.
  const moved: Moved[] = [];
  for (const file of files) {
    const to = finalPathFor(conversationId, file.fileName);
    const { error } = await admin.storage.from(BUCKET).move(file.path, to);
    if (error) {
      console.error("screen-chat-image: move into the conversation failed", { path: file.path, error });
      await undoMoves(admin, moved);
      // The browser uploads and checks this one again next time.
      return json({ sent: false, message: SEND_FAILED_MESSAGE, missing_paths: [file.path] });
    }
    moved.push({ from: file.path, to, kind: file.kind });
  }

  // Saved as the sender, so the usual rules and triggers apply: participants
  // only, contact details refused, the other person notified.
  const row = { conversation_id: conversationId, sender_id: userId, body };
  const insert = (values: Record<string, unknown>) => userClient.from("messages").insert(values).select().single();
  let { data: message, error: insertError } = await insert({ id: messageId, ...row });
  // A database that doesn't let users choose the ID: save without it.
  if (isColumnPermissionError(insertError)) ({ data: message, error: insertError } = await insert(row));
  if (insertError) {
    await undoMoves(admin, moved);
    if (insertError.code === "23505") {
      const repeated = await alreadySent();
      if (repeated) return repeated;
    }
    if (insertError.code === "TC001") return json({ sent: false, code: "TC001", message: insertError.message });
    console.error("screen-chat-image: message insert failed", insertError);
    return json({ sent: false, message: SEND_FAILED_MESSAGE });
  }

  let attachments: unknown[] = [];
  if (moved.length) {
    const { data, error: attachError } = await admin
      .from("message_attachments")
      .insert(moved.map((file) => ({ message_id: message.id, file_url: file.to, file_type: file.kind })))
      .select("id, message_id, file_url, file_type");
    if (attachError) {
      // Take the message back rather than leave a bubble without its photos.
      // (The other person may already have been notified; this is rare.)
      console.error("screen-chat-image: attachment insert failed", attachError);
      const { error: deleteError } = await admin.from("messages").delete().eq("id", message.id);
      if (deleteError) console.error("screen-chat-image: message not taken back", deleteError);
      await undoMoves(admin, moved);
      return json({ sent: false, message: SEND_FAILED_MESSAGE });
    }
    attachments = data ?? [];
  }

  return json({ sent: true, message, attachments });
}

// ---------------------------------------------------------------------------
// Older one-step form: the message already exists; check one file and attach
// it. Only for old copies of the website; can be removed once nobody uses it.
// ---------------------------------------------------------------------------
async function screenForExistingMessage({ userId, admin, json }: Context, payload: Record<string, unknown> | null) {
  // Set once the message is known: removes it if it's now an empty message
  // whose files all failed, so nobody is left with an "unavailable" bubble.
  let dropEmptyMessage: (() => Promise<boolean>) | null = null;

  try {
    const messageId = payload?.message_id;
    const path = typeof payload?.path === "string" ? payload.path : "";
    const final = payload?.final === true;
    const match = path.match(PENDING_PATH);
    if (!isUuid(messageId) || !match || match[2].toLowerCase() !== userId.toLowerCase()) {
      return json({ error: "A valid message_id and your own pending upload path are required" }, 400);
    }
    const [, conversationId, , fileName] = match;

    const { data: message } = await admin
      .from("messages")
      .select("id, conversation_id, sender_id, body")
      .eq("id", messageId)
      .maybeSingle();
    if (!message || message.sender_id !== userId || message.conversation_id !== conversationId) {
      return json({ error: "Message not found" }, 404);
    }

    // Only for the last file of the message, only when it has no text and no
    // file got through. The service role may delete (migration 0041).
    dropEmptyMessage = async () => {
      if (!final || String(message!.body || "").trim()) return false;
      const { count, error: countError } = await admin
        .from("message_attachments")
        .select("id", { count: "exact", head: true })
        .eq("message_id", message!.id);
      if (countError || count) return false;
      const { error: deleteError } = await admin.from("messages").delete().eq("id", message!.id);
      if (deleteError) console.error("screen-chat-image: empty message not removed", deleteError);
      return !deleteError;
    };

    async function finishBlocked(notice: string) {
      await admin.storage.from(BUCKET).remove([path]);
      const messageRemoved = await dropEmptyMessage!();
      return json({ blocked: true, message: notice, message_removed: messageRemoved });
    }

    // After the message check, so an empty message isn't left behind.
    if (!(await withinRateLimit(admin, `chat-media:${userId}`, 40, 600))) return finishBlocked(TOO_MANY_REQUESTS);

    const { data: file, error: downloadError } = await admin.storage.from(BUCKET).download(path);
    if (downloadError || !file) return finishBlocked("The photo or video didn't finish uploading. Please send it again.");

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
      return finishBlocked("The file could not be sent. Please try again.");
    }

    const { data: attachment, error: insertError } = await admin
      .from("message_attachments")
      .insert({ message_id: message.id, file_url: finalPath, file_type: isVideo ? "video" : "image" })
      .select("id, message_id, file_url, file_type")
      .single();
    if (insertError) {
      console.error("screen-chat-image: attachment insert failed", insertError);
      await admin.storage.from(BUCKET).remove([finalPath]);
      const messageRemoved = await dropEmptyMessage();
      return json({ blocked: true, message: "The file could not be sent. Please try again.", message_removed: messageRemoved });
    }

    return json({ blocked: false, attachment });
  } catch (error) {
    console.error("screen-chat-image failed", error);
    const messageRemoved = dropEmptyMessage ? await dropEmptyMessage().catch(() => false) : false;
    return json({ error: "The file could not be sent. Please try again.", message_removed: messageRemoved }, 500);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const json: Json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const otherSite = rejectOtherOrigins(req, corsHeaders);
  if (otherSite) return otherSite;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const payload = await req.json().catch(() => null);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const context: Context = { userId: user.id, admin, userClient, json };

    if (payload?.action === "check") return await checkUpload(context, payload);
    if (payload?.action === "send") return await sendMessage(context, payload);
    return await screenForExistingMessage(context, payload);
  } catch (error) {
    console.error("screen-chat-image failed", error);
    return json({ error: "The file could not be sent. Please try again." }, 500);
  }
});
