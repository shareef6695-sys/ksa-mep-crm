// Build-time guard used by vite.config.js. Every VITE_* variable can end up in the public browser bundle, so a
// secret-looking one stops the build. Hosting platforms add their own VITE_* system variables (Vercel:
// VITE_VERCEL_ENV, VITE_VERCEL_GIT_COMMIT_AUTHOR_LOGIN, ...); the app never reads them, so they are ignored.

export const BROWSER_SAFE = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
const PLATFORM = /^VITE_(VERCEL|NETLIFY|CF_PAGES)_/;
const SENSITIVE = /(SERVICE_ROLE|SECRET|PASSWORD|PASSWD|PRIVATE|_TOKEN$|ACCESS_TOKEN|AUTH_TOKEN|API_KEY|ENC_KEY|DATABASE_URL|DB_URL|CONNECTION_STRING)/i;

function jwtRole(key = '') {
  try {
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role || '';
  } catch {
    return '';
  }
}

/** Problems with the VITE_* variables, as messages; empty when the build may go ahead. */
export function browserEnvProblems(env) {
  const problems = Object.keys(env)
    .filter((k) => k.startsWith('VITE_') && !BROWSER_SAFE.has(k) && !PLATFORM.test(k) && SENSITIVE.test(k))
    .map((k) => `${k} would be exposed to the browser. Keep secrets server-side.`);
  const anon = env.VITE_SUPABASE_ANON_KEY || '';
  if (/^sb_secret_/.test(anon) || jwtRole(anon) === 'service_role') {
    problems.push('VITE_SUPABASE_ANON_KEY is a service-role / secret key. Use the anon (publishable) key and rotate this one.');
  }
  return problems;
}
