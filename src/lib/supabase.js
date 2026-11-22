import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project values.'
  );
}

// Main client: persists the signed-in session.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Non-persistent client used by Admins to create Team logins without logging themselves out.
// TODO(Prompt 2): replace with the admin-create-user Edge Function and remove this client.
export const supabaseProvisioner = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
