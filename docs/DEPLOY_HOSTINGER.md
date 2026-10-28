# Deploy Trustall to Hostinger with GitHub

## 1. Create a GitHub repository

1. Push this project to GitHub.
2. Make sure the default branch is `main`.
3. In GitHub, go to: Settings → Secrets and variables → Actions

Add these repository secrets:

- `HOSTINGER_FTP_HOST`
- `HOSTINGER_FTP_USERNAME`
- `HOSTINGER_FTP_PASSWORD`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PAYSTACK_PUBLIC_KEY`
- `VITE_PUBLIC_SITE_URL`
- `VITE_SUPPORT_EMAIL`

Example values:

- `VITE_PUBLIC_SITE_URL=https://your-domain.com`
- `VITE_SUPPORT_EMAIL=support@trustall.online`

## 2. Hostinger settings

In Hostinger, use the FTP credentials for the website root directory.

Typical target path:

- `/public_html/`

If your site is in a subfolder, replace that path accordingly.

## 3. Deploy

Push to the `main` branch, or trigger the workflow manually from the GitHub Actions tab.

The workflow will:

1. install dependencies
2. run `npm run build`
3. upload the contents of `dist/` to the Hostinger FTP root

## 4. Important runtime notes

- Hostinger is static hosting, so all `VITE_` variables are build-time only.
- `SUPABASE_SERVICE_ROLE_KEY` and other server-side secrets must stay in Supabase Edge Functions, not in the frontend build.
- The app already includes `public/.htaccess` to support SPA routing on Apache.

## 5. Check after deploy

Open the live domain and verify:

- login works
- seller dashboard loads
- reset-password flow works
- support email shows `support@trustall.online`
- seller share link uses the live host instead of a hardcoded domain

## 6. If Git is not installed on this machine

This environment does not currently have the Git CLI available, so the initial push cannot be run from here.

You can initialize and push from your local machine or from VS Code with Git installed:

```bash
git init
git add .
git commit -m "Initial Trustall deploy setup"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

Then GitHub Actions will handle deployment to Hostinger automatically.
