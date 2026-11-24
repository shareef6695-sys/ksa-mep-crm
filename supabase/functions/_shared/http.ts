// HTTP plumbing shared by every Edge Function: CORS limited to the app's own origin, security headers on every
// response, errors with a correlation id (details only in the server log), and required settings checked up front.
import { redactPII } from './safe.ts';

// The production app. Add more (a custom domain, a staging site) with the ALLOWED_ORIGINS function secret:
//   supabase secrets set ALLOWED_ORIGINS=https://ksa-mep-crm.vercel.app,https://erp.example.com
export const DEFAULT_ORIGINS = ['https://ksa-mep-crm.vercel.app'];

const envGet = (name: string): string | undefined =>
  (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(name);

export function allowedOrigins(): string[] {
  const raw = envGet('ALLOWED_ORIGINS');
  const list = raw ? raw.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean) : DEFAULT_ORIGINS;
  return list.filter((o) => o !== '*'); // a wildcard is never honoured
}

export const originAllowed = (origin: string | null, list: string[] = allowedOrigins()): boolean =>
  !!origin && list.includes(origin);

/** Headers for a response to this request: security headers always, CORS only for an allowed browser origin. */
export function responseHeaders(origin: string | null, allowHeaders: string, list?: string[]): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin',
  };
  if (originAllowed(origin, list)) {
    h['Access-Control-Allow-Origin'] = origin!;
    h['Access-Control-Allow-Headers'] = allowHeaders;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

/** Per-request helpers: `json(status, body)` and `preflight()` (204 for the app's origin, 403 for any other). */
export function responder(req: Request, allowHeaders: string) {
  const origin = req.headers.get('Origin');
  const headers = responseHeaders(origin, allowHeaders);
  return {
    json: (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers }),
    preflight: () => new Response(null, { status: originAllowed(origin) ? 204 : 403, headers }),
  };
}

/**
 * Error body for the client: `{ error, ref }`. `ref` is a correlation id that is also written to the function log
 * with the (redacted) detail. Errors we raise on purpose keep their message; anything unexpected (database, network,
 * library, missing settings) shows only a generic message.
 */
export function errorBody(fn: string, e: unknown, expected: boolean): { error: string; ref: string } {
  const ref = crypto.randomUUID().slice(0, 8);
  const detail = redactPII((e as { message?: string })?.message ?? String(e));
  if (expected) {
    console.warn(`${fn} ${ref}: ${detail}`);
    return { error: detail, ref };
  }
  console.error(`${fn} ${ref}: ${detail}`);
  return { error: `Something went wrong on the server. Reference: ${ref}`, ref };
}

/** The named settings, or an error naming the missing ones (logged server-side; the client sees only a reference). */
export function requireEnv<K extends string>(...names: K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  const missing: string[] = [];
  for (const n of names) {
    const v = envGet(n);
    if (v) out[n] = v;
    else missing.push(n);
  }
  if (missing.length) throw new Error(`Function is not configured: missing ${missing.join(', ')}.`);
  return out;
}
