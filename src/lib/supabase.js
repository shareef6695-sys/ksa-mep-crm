import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project values.'
  );
}

// The only Supabase client in the browser. User accounts are created server-side by the
// admin-users Edge Function (supabase/functions/admin-users), never with auth.signUp here.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
