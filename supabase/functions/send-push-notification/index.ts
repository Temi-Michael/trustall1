import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { isUuid, secretsMatch } from "../_shared/validate.ts"
import { corsHeadersFor, rejectOtherOrigins } from "../_shared/cors.js"
import { buildPushMessage, isDeadTokenResponse, resolveSiteOrigin } from "../_shared/pushMessage.js"

const json = (body: unknown, corsHeaders: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

function base64Url(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value
  let binary = ""
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

async function createFirebaseAccessToken(serviceAccount: Record<string, string>) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claim = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }))
  const unsignedToken = `${header}.${claim}`
  const privateKey = serviceAccount.private_key.replace(/\\n/g, "\n")
  const keyData = Uint8Array.from(atob(privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "")), (char) => char.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken),
  )

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedToken}.${base64Url(new Uint8Array(signature))}`,
    }),
  })
  const result = await response.json()
  if (!response.ok || !result.access_token) throw new Error(result.error_description || "Firebase access token request failed")
  return result.access_token as string
}

Deno.serve(async (request) => {
  // Called by the database webhook, which sends no Origin; browsers on other sites are refused.
  const corsHeaders = corsHeadersFor(request, ["x-push-secret"])
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  const otherSite = rejectOtherOrigins(request, corsHeaders)
  if (otherSite) return otherSite

  try {
    // Only the database webhook may trigger pushes. Without the secret configured
    // the function refuses everything rather than accepting anyone.
    const expectedSecret = Deno.env.get("PUSH_WEBHOOK_SECRET")
    if (!expectedSecret || !secretsMatch(request.headers.get("x-push-secret"), expectedSecret)) {
      return json({ error: "Unauthorized" }, corsHeaders, 401)
    }

    const payload = await request.json().catch(() => null)
    // A webhook set to also fire on UPDATE would push again whenever a
    // notification is marked read. Only new notifications are pushed.
    if (payload?.type && payload.type !== "INSERT") return json({ sent: 0, skipped: "not an insert" }, corsHeaders)
    const notification_id = payload?.notification_id || payload?.record?.id
    if (!isUuid(notification_id)) return json({ error: "notification_id must be a UUID" }, corsHeaders, 400)

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if (!serviceRoleKey || !supabaseUrl || !serviceAccountJson) throw new Error("Push notification secrets are not configured")

    const admin = createClient(supabaseUrl, serviceRoleKey)
    const { data: notification, error: notificationError } = await admin
      .from("notifications")
      .select("id, recipient_id, type, title, message, read_at, related_conversation_id, related_order_id, related_dispute_id")
      .eq("id", notification_id)
      .maybeSingle()
    if (notificationError) throw notificationError
    if (!notification) return json({ sent: 0, skipped: "notification not found" }, corsHeaders)
    // Already read in the app (the user was looking): nothing to tell them.
    if (notification.read_at) return json({ sent: 0, skipped: "already read" }, corsHeaders)

    const { data: tokens, error: tokenError } = await admin
      .from("device_tokens")
      .select("id, fcm_token")
      .eq("user_id", notification.recipient_id)
    if (tokenError) throw tokenError
    if (!tokens?.length) return json({ sent: 0 }, corsHeaders)

    // For the app icon's badge. A failed count only leaves the badge out.
    const { count: unreadCount } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", notification.recipient_id)
      .is("read_at", null)

    const serviceAccount = JSON.parse(serviceAccountJson)
    const accessToken = await createFirebaseAccessToken(serviceAccount)
    const siteOrigin = resolveSiteOrigin(Deno.env.get("PUBLIC_SITE_URL"))
    const sendUrl = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/messages:send`

    let sent = 0
    const failedTokenIds: string[] = []
    for (const token of tokens) {
      const response = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          message: buildPushMessage(notification, token.fcm_token, { siteOrigin, unreadCount: unreadCount ?? undefined }),
        }),
      })
      if (response.ok) sent += 1
      else {
        const errorBody = await response.text()
        if (isDeadTokenResponse(errorBody)) failedTokenIds.push(token.id)
        else console.error("Push to one device failed:", response.status, errorBody.slice(0, 500))
      }
    }

    if (failedTokenIds.length) await admin.from("device_tokens").delete().in("id", failedTokenIds)
    return json({ sent, removed: failedTokenIds.length }, corsHeaders)
  } catch (error) {
    console.error("Push notification failed:", error)
    return json({ error: "Push notification failed" }, corsHeaders, 500)
  }
})
