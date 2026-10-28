# Push notifications

The frontend stores Firebase Cloud Messaging tokens in `device_tokens`. The Supabase Edge Function `send-push-notification` sends notifications to Android and web-browser tokens through Firebase Cloud Messaging.

## Required deployment setup

1. Create a Firebase service account for the `trustall-technology-limited` project.
2. Set these Supabase Function secrets:

```text
FIREBASE_SERVICE_ACCOUNT_JSON=<the complete service-account JSON>
PUSH_WEBHOOK_SECRET=<long random secret>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by Supabase Edge Functions.

3. Deploy the function:

```bash
supabase functions deploy send-push-notification --no-verify-jwt
```

4. Create a Supabase Database Webhook for `public.notifications` on `INSERT`:

```text
URL: https://<project-ref>.supabase.co/functions/v1/send-push-notification
Header: x-push-secret: <the PUSH_WEBHOOK_SECRET value>
```

The webhook payload includes the inserted notification record. The function reads the recipient's `device_tokens`, sends to every valid Android/browser token, and removes expired tokens.

## Client requirements

- The user must allow browser notifications.
- Android Chrome requires the site to be HTTPS or installed as a PWA.
- iPhone/iPad web push requires iOS/iPadOS 16.4 or newer, HTTPS, and the app installed to the Home Screen.
- After changing notification permission or installing the PWA, reload once so a fresh FCM token is stored.
