import { createClient } from '@supabase/supabase-js';
import { keyRole } from './keyRole.js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project values.'
  );
}

// Defence in depth: the browser may only ever hold the public anon / publishable key. A service-role or
// secret key here would bypass Row Level Security for anyone who opens the site, so refuse to start.
if (keyRole(SUPABASE_ANON_KEY) === 'service_role') {
  throw new Error('VITE_SUPABASE_ANON_KEY holds a service-role / secret key. Use the anon (publishable) key; rotate the leaked one.');
}

// The only Supabase client in the browser. User accounts are created server-side by the
// admin-users Edge Function (supabase/functions/admin-users), never with auth.signUp here.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
