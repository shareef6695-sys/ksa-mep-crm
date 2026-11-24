// Small helpers that keep secrets and internals out of HTTP responses.

/** Constant-time string compare, for shared secrets such as cron headers. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 9-15 digits, optionally with + and separators: phone numbers, not dates (8 digits) or invoice amounts
const PHONE = /(?<![\w.])\+?\d(?:[\s()-]?\d){8,14}(?![\w.])/g;

/** Text with email addresses and phone numbers replaced by [REDACTED], for logs and stored error messages. */
export function redactPII(text: string): string {
  return String(text ?? '').replace(EMAIL, '[REDACTED]').replace(PHONE, '[REDACTED]');
}

const SECRET_FIELD = /^(binarySecurityToken|secret|token|access_token|refresh_token|password|private_?key|api_?key|authorization)$/i;

/** Copy of a JSON value with secret-looking fields replaced, for error messages and logs. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, SECRET_FIELD.test(k) ? '[redacted]' : redact(v)]));
  }
  return value;
}

/**
 * Message safe to return to the caller. Errors we raise on purpose (HttpError, written by us) keep their message;
 * anything unexpected (database, network, library errors) is logged server-side with a reference and the caller only
 * sees the reference.
 */
export function publicError(fn: string, e: unknown, expected: boolean): string {
  const message = (e as { message?: string })?.message ?? String(e);
  if (expected) return message;
  const ref = crypto.randomUUID().slice(0, 8);
  console.error(`${fn} error ${ref}:`, redactPII(message));
  return `Unexpected server error (ref ${ref}). Check the function logs.`;
}
