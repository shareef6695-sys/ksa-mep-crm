// Unit tests for the reminder texts and senders (supabase/functions/_shared/notify) — Prompt 15.
import { describe, expect, it } from 'vitest';
import { render, type DigestItem, type OverdueItem } from '../../functions/_shared/notify/messages.ts';
import { buildRequest, send } from '../../functions/_shared/notify/senders.ts';

const overdue: OverdueItem = {
  kind: 'overdue_invoice', channel: 'email', to: 'ap@client.test', cc: 'sami@horizon.test', refId: 'inv-1', invoiceNumber: 'INV-2026-00042',
  client: 'Red Sea Towers Co', dueDate: '2026-11-15', daysOverdue: 7, openSar: 12345.5, company: 'Horizon Business Solutions Est.',
  companyAr: 'مؤسسة حلول الأفق للأعمال', bankIban: 'SA0380000000608010167519',
};
const digest: DigestItem = {
  kind: 'approval_digest', channel: 'email', to: 'manager@horizon.test', refId: 'u1', name: 'Majid', role: 'manager', company: 'Horizon',
  items: [{ type: 'po_approval', ref: 'PO-2026-00007', text: 'Pipe Co SAR 34,500.00' }, { type: 'quote_approval', ref: 'INQ-2026-00012', text: 'Towers' }],
};
const okFetch = (reply: string, status = 200) => {
  const calls: { url: string; init: { body: string; headers: Record<string, string> } }[] = [];
  const f = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init });
    return { ok: status < 300, status, text: async () => reply };
  };
  return { f, calls };
};

describe('reminder texts', () => {
  it('overdue reminder: amount, days, IBAN, English and Arabic', () => {
    const r = render(overdue);
    expect(r.subject).toContain('INV-2026-00042');
    expect(r.subject).toContain('12,345.50');
    expect(r.text).toContain('7 day(s) past due');
    expect(r.text).toContain('SA0380000000608010167519');
    expect(r.text).toContain('متأخرة 7 يومًا');
    expect(r.html).toContain('dir="rtl"');
    expect(r.templateParams).toEqual(['Red Sea Towers Co', 'INV-2026-00042', '12,345.50', '7', 'Horizon Business Solutions Est.']);
  });
  it('escapes HTML', () => {
    expect(render({ ...overdue, client: '<script>x</script>' }).html).not.toContain('<script>');
  });
  it('digest groups the items', () => {
    const r = render(digest);
    expect(r.subject).toContain('2 item(s)');
    expect(r.text).toContain('Quotes waiting for your pricing approval');
    expect(r.text).toContain('PO-2026-00007');
    expect(r.templateParams[1]).toBe('2');
  });
});

describe('senders', () => {
  it('no provider = dry run, nothing called', async () => {
    const { f, calls } = okFetch('{}');
    expect(await send({}, overdue, render(overdue), f)).toEqual({ status: 'dry_run', provider: 'none' });
    expect(calls).toHaveLength(0);
  });
  it('missing secrets are reported, not sent', async () => {
    const { f, calls } = okFetch('{}');
    const r = await send({ NOTIFY_EMAIL_PROVIDER: 'resend' }, overdue, render(overdue), f);
    expect(r.status).toBe('failed');
    expect(r.error).toContain('RESEND_API_KEY');
    expect(calls).toHaveLength(0);
  });
  it('Resend: to, cc, subject; id recorded', async () => {
    const { f, calls } = okFetch('{"id":"re_123"}');
    const env = { NOTIFY_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', NOTIFY_EMAIL_FROM: 'ar@horizon.test' };
    expect(await send(env, overdue, render(overdue), f)).toEqual({ status: 'sent', provider: 'resend', providerId: 're_123' });
    const b = JSON.parse(calls[0].init.body);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(b).toMatchObject({ from: 'ar@horizon.test', to: ['ap@client.test'], cc: ['sami@horizon.test'] });
  });
  it('dryRun flag never calls the provider', async () => {
    const { f, calls } = okFetch('{}');
    const env = { NOTIFY_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', NOTIFY_EMAIL_FROM: 'a@b.c' };
    expect((await send(env, overdue, render(overdue), f, true)).status).toBe('dry_run');
    expect(calls).toHaveLength(0);
  });
  it('provider errors are returned as failed', async () => {
    const { f } = okFetch('{"message":"domain not verified"}', 403);
    const env = { NOTIFY_EMAIL_PROVIDER: 'sendgrid', SENDGRID_API_KEY: 'k', NOTIFY_EMAIL_FROM: 'a@b.c' };
    const r = await send(env, overdue, render(overdue), f);
    expect(r.status).toBe('failed');
    expect(r.error).toContain('HTTP 403');
  });
  it('Meta WhatsApp uses the approved template with body parameters', () => {
    const m = { ...overdue, channel: 'whatsapp' as const, to: '+966551234567' };
    const env = { NOTIFY_WHATSAPP_PROVIDER: 'meta', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_TEMPLATE_OVERDUE: 'payment_reminder', WHATSAPP_TEMPLATE_DIGEST: 'approvals', WHATSAPP_TEMPLATE_LANG: 'ar' };
    const { request } = buildRequest(env, m, render(m));
    const b = JSON.parse(request!.init.body);
    expect(request!.url).toBe('https://graph.facebook.com/v20.0/123/messages');
    expect(b.to).toBe('966551234567');
    expect(b.template).toMatchObject({ name: 'payment_reminder', language: { code: 'ar' } });
    expect(b.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(render(m).templateParams);
  });
  it('Twilio WhatsApp: content template when configured, else plain text', () => {
    const m = { ...digest, channel: 'whatsapp' as const, to: '+966551234567' };
    const base = { NOTIFY_WHATSAPP_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 's', TWILIO_WHATSAPP_FROM: '+14155238886' };
    const plain = new URLSearchParams(buildRequest(base, m, render(m)).request!.init.body);
    expect(plain.get('To')).toBe('whatsapp:+966551234567');
    expect(plain.get('Body')).toContain('PO-2026-00007');
    const tpl = new URLSearchParams(buildRequest({ ...base, TWILIO_CONTENT_SID_DIGEST: 'HX1' }, m, render(m)).request!.init.body);
    expect(tpl.get('ContentSid')).toBe('HX1');
    expect(JSON.parse(tpl.get('ContentVariables')!)).toMatchObject({ 1: 'Majid', 2: '2' });
  });
});
