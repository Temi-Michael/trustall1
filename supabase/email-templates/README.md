# Supabase email templates

Trustall's branded emails. Supabase sends them; these files are the source of truth.
Paste each one into **Supabase → Authentication → Emails** (the template's message body), set the subject, and save.

| File | Supabase template | Subject |
|---|---|---|
| `confirm-signup.html` | Confirm signup | Confirm your email to start using Trustall |
| `reset-password.html` | Reset password | Reset your Trustall password |

- Links use `{{ .SiteURL }}` + `token_hash`, so they open on any device (the app signs the user in with `verifyOtp`; see `src/lib/emailLinkSession.js`). **Site URL** in Supabase must be `https://www.trustall.online`.
- "Expires in 1 hour" matches **Email OTP expiration** (3600 seconds). Change both together.
- The seal is built from text and colour, not an image, so it shows even when images are blocked.
- Tables and inline styles are deliberate: they're what Gmail, Outlook and Apple Mail render reliably.
- The support address is `support@trustall.online` (the app's default, `VITE_SUPPORT_EMAIL`). Update it here too if that changes.
