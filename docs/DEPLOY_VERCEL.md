# Deploy Trustall to Vercel

## Deploy from a folder

This workspace has an outer `trustall-13` folder and the Vite app in its inner `trustall` folder. The inner folder contains `package.json` and `vercel.json`.

1. In Vercel, create or open the project and choose its folder-upload/deploy option.
2. Upload the **inner `trustall` app folder**, not the outer `trustall-13` workspace folder. The folder you select must show `package.json` immediately inside it.
3. Set the project root directory to `.` when the inner app folder itself is the upload root. If you uploaded the outer folder, set Root Directory to `trustall` instead.
4. Use the Vite settings:
   - Framework preset: Vite
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm install`

An `ENOENT` for `/vercel/path0/package.json` means the selected build root does not contain the app's `package.json`. Correct the uploaded folder/root directory before redeploying.

If the folder-upload flow is for a **prebuilt static output** rather than a source project, run `npm run build` locally and upload the contents of `dist`; do not configure Vercel to run `npm install` or `npm run build` on that static-only upload.

The included `vercel.json` rewrites client-side routes to `/index.html`, so routes such as `/seller/:handle`, `/orders`, and `/how-it-works` work on direct visits and refreshes. Keep Vercel's Output Directory set to `dist` so it serves Vite's built assets and this rewrite file together.

## Environment variables

Add these in **Project Settings → Environment Variables** for Production, Preview, and Development as appropriate:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PAYSTACK_PUBLIC_KEY`
- `VITE_PUBLIC_SITE_URL` set to the deployed site origin, for example `https://your-domain.example`
- `VITE_SUPPORT_EMAIL` (optional; defaults to the Trustall support address)

`VITE_` values are compiled into browser code. Only use client/public keys here. Never put `PAYSTACK_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `OPENAI_API_KEY` in Vercel environment variables used by this Vite client. Keep backend secrets in Supabase Edge Function secrets.

After choosing a Vercel domain, configure Supabase **Authentication → URL Configuration**:

- Site URL: the deployed site origin
- Redirect URL: `https://your-domain.example/reset-password`

Also update any Supabase Auth redirect allowlists and Paystack callback/domain settings to match the deployed domain.

## Analytics

The app includes Vercel Web Analytics and Speed Insights. After deployment:

1. Open the project in Vercel and enable **Web Analytics**.
2. Enable **Speed Insights** in the project dashboard.
3. Redeploy if the dashboard prompts you to do so, then visit the live site and check the Analytics and Speed Insights tabs.

Vercel collects production traffic after these project features are enabled; local development and preview traffic may not appear in Production analytics.

## Verify deployment

- Open the homepage and directly refresh `/how-it-works`, `/orders`, and a public `/seller/<handle>` route.
- Test sign-in, Supabase data reads, Paystack checkout, email/password reset redirects, and uploads.
- Confirm Vercel Analytics and Speed Insights begin receiving production data.
