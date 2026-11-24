// Pluggable senders for the notify Edge Function. Nothing is sent unless a provider is configured; without one
// every message is a dry run (logged in notification_log as dry_run). Request builders are pure for unit tests.
import type { QueueItem, Rendered } from './messages.ts';
import { redactPII } from '../safe.ts';

export type Env = Record<string, string | undefined>;
export interface SendResult { status: 'sent' | 'failed' | 'dry_run'; provider: string; providerId?: string; error?: string }
export interface HttpRequest { url: string; init: { method: string; headers: Record<string, string>; body: string } }
type Fetch = (url: string, init: HttpRequest['init']) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export const emailProvider = (env: Env) => (env.NOTIFY_EMAIL_PROVIDER || '').toLowerCase(); // resend | sendgrid | '' (dry run)
export const whatsappProvider = (env: Env) => (env.NOTIFY_WHATSAPP_PROVIDER || '').toLowerCase(); // meta | twilio | '' (dry run)

export function resendRequest(env: Env, m: QueueItem, r: Rendered): HttpRequest {
  return {
    url: 'https://api.resend.com/emails',
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.NOTIFY_EMAIL_FROM, to: [m.to], ...(('cc' in m && m.cc) ? { cc: [m.cc] } : {}), subject: r.subject, text: r.text, html: r.html,
        ...(env.NOTIFY_REPLY_TO ? { reply_to: env.NOTIFY_REPLY_TO } : {}) }),
    },
  };
}

export function sendgridRequest(env: Env, m: QueueItem, r: Rendered): HttpRequest {
  return {
    url: 'https://api.sendgrid.com/v3/mail/send',
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: m.to }], ...(('cc' in m && m.cc) ? { cc: [{ email: m.cc }] } : {}) }],
        from: { email: env.NOTIFY_EMAIL_FROM }, subject: r.subject,
        content: [{ type: 'text/plain', value: r.text }, { type: 'text/html', value: r.html }],
        ...(env.NOTIFY_REPLY_TO ? { reply_to: { email: env.NOTIFY_REPLY_TO } } : {}),
      }),
    },
  };
}

/** Meta WhatsApp Cloud API. Business-initiated messages must use an approved template. */
export function metaWhatsAppRequest(env: Env, m: QueueItem, r: Rendered): HttpRequest {
  const template = m.kind === 'overdue_invoice' ? env.WHATSAPP_TEMPLATE_OVERDUE : env.WHATSAPP_TEMPLATE_DIGEST;
  return {
    url: `https://graph.facebook.com/${env.WHATSAPP_API_VERSION || 'v20.0'}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: m.to.replace(/^\+/, ''), type: 'template',
        template: { name: template, language: { code: env.WHATSAPP_TEMPLATE_LANG || 'en' },
          components: [{ type: 'body', parameters: r.templateParams.map((text) => ({ type: 'text', text })) }] },
      }),
    },
  };
}

/** Twilio WhatsApp: a Content template (TWILIO_CONTENT_SID_*) for business-initiated messages, else plain text. */
export function twilioWhatsAppRequest(env: Env, m: QueueItem, r: Rendered): HttpRequest {
  const contentSid = m.kind === 'overdue_invoice' ? env.TWILIO_CONTENT_SID_OVERDUE : env.TWILIO_CONTENT_SID_DIGEST;
  const form = new URLSearchParams({ From: `whatsapp:${env.TWILIO_WHATSAPP_FROM}`, To: `whatsapp:${m.to}` });
  if (contentSid) {
    form.set('ContentSid', contentSid);
    form.set('ContentVariables', JSON.stringify(Object.fromEntries(r.templateParams.map((v, i) => [String(i + 1), v]))));
  } else {
    form.set('Body', r.text.slice(0, 1500));
  }
  return {
    url: `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    init: {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    },
  };
}

const REQUIRED: Record<string, string[]> = {
  resend: ['RESEND_API_KEY', 'NOTIFY_EMAIL_FROM'],
  sendgrid: ['SENDGRID_API_KEY', 'NOTIFY_EMAIL_FROM'],
  meta: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE_OVERDUE', 'WHATSAPP_TEMPLATE_DIGEST'],
  twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM'],
};
export const missingSettings = (env: Env, provider: string) => (REQUIRED[provider] || []).filter((k) => !env[k]);

export function buildRequest(env: Env, m: QueueItem, r: Rendered): { provider: string; request: HttpRequest | null; problem?: string } {
  const provider = m.channel === 'email' ? emailProvider(env) : whatsappProvider(env);
  if (!provider) return { provider: 'none', request: null };
  const missing = missingSettings(env, provider);
  if (!REQUIRED[provider]) return { provider, request: null, problem: `Unknown ${m.channel} provider "${provider}".` };
  if (missing.length) return { provider, request: null, problem: `Missing secrets for ${provider}: ${missing.join(', ')}.` };
  const build = { resend: resendRequest, sendgrid: sendgridRequest, meta: metaWhatsAppRequest, twilio: twilioWhatsAppRequest }[provider]!;
  return { provider, request: build(env, m, r) };
}

/** Sends one message, or reports a dry run when no provider is configured / dryRun is set. */
export async function send(env: Env, m: QueueItem, r: Rendered, fetchImpl: Fetch, dryRun = false): Promise<SendResult> {
  const { provider, request, problem } = buildRequest(env, m, r);
  if (problem) return { status: 'failed', provider, error: problem };
  if (dryRun || !request) return { status: 'dry_run', provider };
  try {
    const res = await fetchImpl(request.url, request.init);
    const body = await res.text();
    if (!res.ok) return { status: 'failed', provider, error: `HTTP ${res.status}: ${redactPII(body.slice(0, 500))}` }; // provider errors can echo the recipient
    let id: string | undefined;
    try {
      const j = JSON.parse(body);
      id = j.id || j.sid || j.messages?.[0]?.id;
    } catch { /* SendGrid answers 202 with an empty body */ }
    return { status: 'sent', provider, providerId: id };
  } catch (e) {
    return { status: 'failed', provider, error: redactPII((e as Error).message) };
  }
}
