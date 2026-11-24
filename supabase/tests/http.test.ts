import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowedOrigins, errorBody, originAllowed, requireEnv, responseHeaders } from '../functions/_shared/http.ts';

const APP = 'https://ksa-mep-crm.vercel.app';
const setEnv = (vars: Record<string, string>) => {
  (globalThis as Record<string, unknown>).Deno = { env: { get: (n: string) => vars[n] } };
};
afterEach(() => { delete (globalThis as Record<string, unknown>).Deno; vi.restoreAllMocks(); });

describe('CORS', () => {
  it('allows only the app origin by default, never a wildcard', () => {
    expect(allowedOrigins()).toEqual([APP]);
    expect(originAllowed(APP)).toBe(true);
    expect(originAllowed('https://evil.example')).toBe(false);
    expect(originAllowed(null)).toBe(false);
    setEnv({ ALLOWED_ORIGINS: `${APP}/, https://erp.example.com, *` });
    expect(allowedOrigins()).toEqual([APP, 'https://erp.example.com']);
  });
  it('sends CORS headers only to an allowed origin; security headers always', () => {
    const ok = responseHeaders(APP, 'authorization', [APP]);
    expect(ok['Access-Control-Allow-Origin']).toBe(APP);
    const other = responseHeaders('https://evil.example', 'authorization', [APP]);
    expect(other['Access-Control-Allow-Origin']).toBeUndefined();
    for (const h of [ok, other]) {
      expect(h['X-Content-Type-Options']).toBe('nosniff');
      expect(h['Cache-Control']).toBe('no-store');
      expect(h.Vary).toBe('Origin');
    }
  });
});

describe('errors', () => {
  it('unexpected errors: generic message + reference; detail only in the log, redacted', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = errorBody('fn', new Error('duplicate key (email)=(a@b.test) at /var/task/index.ts:12'), false);
    expect(b.ref).toMatch(/^[0-9a-f]{8}$/);
    expect(b.error).toBe(`Something went wrong on the server. Reference: ${b.ref}`);
    expect(b.error).not.toMatch(/index\.ts|duplicate|a@b/);
    expect(String(log.mock.calls[0])).toContain(b.ref);
    expect(String(log.mock.calls[0])).not.toContain('a@b.test');
  });
  it('our own errors keep their message and still carry a reference', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = errorBody('fn', new Error('Only a System Administrator can manage users.'), true);
    expect(b.error).toBe('Only a System Administrator can manage users.');
    expect(b.ref).toMatch(/^[0-9a-f]{8}$/);
  });
  it('requireEnv names what is missing', () => {
    setEnv({ SUPABASE_URL: 'https://x.supabase.co' });
    expect(requireEnv('SUPABASE_URL').SUPABASE_URL).toBe('https://x.supabase.co');
    expect(() => requireEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')).toThrow(/missing SUPABASE_SERVICE_ROLE_KEY/);
  });
});
