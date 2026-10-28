import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { isUuid, secretsMatch } from "../_shared/validate.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

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
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    // Only the database webhook may trigger pushes. Without the secret configured
    // the function refuses everything rather than accepting anyone.
    const expectedSecret = Deno.env.get("PUSH_WEBHOOK_SECRET")
    if (!expectedSecret || !secretsMatch(request.headers.get("x-push-secret"), expectedSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    const payload = await request.json()
    const notification_id = payload.notification_id || payload.record?.id
    if (!isUuid(notification_id)) throw new Error("notification_id must be a UUID")

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if (!serviceRoleKey || !supabaseUrl || !serviceAccountJson) throw new Error("Push notification secrets are not configured")

    const admin = createClient(supabaseUrl, serviceRoleKey)
    const { data: notification, error: notificationError } = await admin
      .from("notifications")
      .select("id, recipient_id, title, message, related_conversation_id, related_offer_id, related_order_id")
      .eq("id", notification_id)
      .single()
    if (notificationError) throw notificationError

    const { data: tokens, error: tokenError } = await admin
      .from("device_tokens")
      .select("id, fcm_token")
      .eq("user_id", notification.recipient_id)
    if (tokenError) throw tokenError
    if (!tokens?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const serviceAccount = JSON.parse(serviceAccountJson)
    const accessToken = await createFirebaseAccessToken(serviceAccount)
    const actionUrl = notification.related_conversation_id
      ? `/messages/${notification.related_conversation_id}`
      : notification.related_order_id
        ? `/orders/${notification.related_order_id}`
        : "/"

    let sent = 0
    const failedTokenIds: string[] = []
    for (const token of tokens) {
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          message: {
            token: token.fcm_token,
            notification: { title: notification.title || "Trustall", body: notification.message || "You have a new notification" },
            data: { actionUrl, notificationId: notification.id },
            webpush: { fcm_options: { link: actionUrl } },
          },
        }),
      })
      if (response.ok) sent += 1
      else {
        const errorBody = await response.text()
        if (["UNREGISTERED", "INVALID_ARGUMENT"].some((code) => errorBody.includes(code))) failedTokenIds.push(token.id)
      }
    }

    if (failedTokenIds.length) await admin.from("device_tokens").delete().in("id", failedTokenIds)
    return new Response(JSON.stringify({ sent, removed: failedTokenIds.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
  } catch (error) {
    console.error("Push notification failed:", error)
    return new Response(JSON.stringify({ error: "Push notification failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  }
})
