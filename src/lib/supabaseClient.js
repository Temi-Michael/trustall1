import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder-project.supabase.co'
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // PKCE: after Google sign-in, Supabase sends back a one-time ?code= that
    // only this browser can exchange (it holds the matching secret), instead
    // of the login tokens themselves in the address bar (#access_token=…),
    // where they could end up in browser history.
    // Email links (confirm sign-up, reset password) use ?token_hash= instead,
    // handled by emailLinkSession.js, so they work on any device.
    flowType: 'pkce',
  },
})
