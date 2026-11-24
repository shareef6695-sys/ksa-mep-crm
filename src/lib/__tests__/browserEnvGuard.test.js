import { describe, expect, it } from 'vitest';
import { browserEnvProblems } from '../../../scripts/browser-env-guard.mjs';

const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.sig`;
const ok = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon') };

describe('browserEnvProblems', () => {
  it('allows the app variables and hosting-platform system variables', () => {
    expect(browserEnvProblems({
      ...ok, PATH: '/bin', SUPABASE_SERVICE_ROLE_KEY: 'server only, not VITE_',
      VITE_VERCEL_ENV: 'production', VITE_VERCEL_GIT_COMMIT_AUTHOR_LOGIN: 'someone', VITE_VERCEL_OIDC_TOKEN: 'x',
    })).toEqual([]);
    expect(browserEnvProblems({ ...ok, VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc' })).toEqual([]);
  });
  it('stops secret-looking VITE_ variables', () => {
    for (const k of ['VITE_SUPABASE_SERVICE_ROLE_KEY', 'VITE_STRIPE_SECRET_KEY', 'VITE_OPENAI_API_KEY', 'VITE_DATABASE_URL', 'VITE_GITHUB_TOKEN']) {
      expect(browserEnvProblems({ ...ok, [k]: 'x' })).toHaveLength(1);
    }
  });
  it('stops a service-role key passed as the anon key', () => {
    expect(browserEnvProblems({ ...ok, VITE_SUPABASE_ANON_KEY: jwt('service_role') })).toHaveLength(1);
    expect(browserEnvProblems({ ...ok, VITE_SUPABASE_ANON_KEY: 'sb_secret_abc' })).toHaveLength(1);
  });
});
