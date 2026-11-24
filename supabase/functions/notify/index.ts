// =====================================================================
// notify — email / WhatsApp reminders for Horizon ERP (Prompt 15)
// ---------------------------------------------------------------------
// Overdue-invoice payment reminders to customers (optionally copied to the salesman) and a daily digest per approver
// (quotes / POs waiting for approval, contract drafts to post, renewals due). What to send comes from
// notification_queue() (migration 0015); every message is logged in notification_log.
//
// POST { dryRun?: boolean, limit?: number }
//   - from the schedule: header x-notify-cron = NOTIFY_CRON_SECRET  (sends for real unless dryRun)
//   - from the app: an admin / ceo / finance session                (Settings -> Notifications; preview = dryRun)
//
// Providers (secrets; leave unset for dry runs only):
//   NOTIFY_EMAIL_PROVIDER = resend | sendgrid      + RESEND_API_KEY or SENDGRID_API_KEY, NOTIFY_EMAIL_FROM, NOTIFY_REPLY_TO (optional)
//   NOTIFY_WHATSAPP_PROVIDER = meta | twilio       + meta: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_OVERDUE,
//                                                    WHATSAPP_TEMPLATE_DIGEST, WHATSAPP_TEMPLATE_LANG (en / ar)
//                                                    twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM,
//                                                    TWILIO_CONTENT_SID_OVERDUE / _DIGEST (templates, recommended)
//   NOTIFY_CRON_SECRET = long random string for the scheduled run (supabase/snippets/notify_schedule.sql)
// Deploy:  supabase functions deploy notify
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { render, type QueueItem } from '../_shared/notify/messages.ts';
import { publicError, safeEqual } from '../_shared/safe.ts';
import { emailProvider, send, whatsappProvider } from '../_shared/notify/senders.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notify-cron',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const env = Deno.env.toObject();
  const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  let body: { dryRun?: boolean; limit?: number } = {};
  try { body = await req.json(); } catch { /* empty body */ }

  // who is calling
  const cron = req.headers.get('x-notify-cron');
  let dryRun = body.dryRun === true;
  if (cron) {
    if (!safeEqual(cron, env.NOTIFY_CRON_SECRET)) return json(401, { error: 'Bad cron secret.' });
  } else {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const { data, error } = token ? await admin.auth.getUser(token) : { data: null, error: true };
    if (error || !data?.user) return json(401, { error: 'Sign in first.' });
    const { data: r } = await admin.from('user_roles').select('role, active').eq('user_id', data.user.id).maybeSingle();
    if (!r?.active || !['admin', 'ceo', 'finance'].includes(r.role)) return json(403, { error: 'Only Admin, CEO or Finance can run reminders.' });
    if (body.dryRun !== false) dryRun = true; // the app previews unless it explicitly asks to send
  }

  const { data: queue, error: qe } = await admin.rpc('notification_queue', {});
  if (qe) return json(500, { error: publicError('notify', qe, false) });
  const items = ((queue || []) as QueueItem[]).slice(0, Math.min(Math.max(Number(body.limit) || 200, 1), 1000));
  const results = [];
  for (const m of items) {
    const r = render(m);
    const res = await send(env, m, r, (url, init) => fetch(url, init), dryRun);
    if (!dryRun) {
      await admin.rpc('record_notification', { p: { kind: m.kind, channel: m.channel, to: m.to, refId: m.refId, subject: r.subject, body: r.text,
        status: res.status, provider: res.provider, providerId: res.providerId, error: res.error } });
    }
    results.push({ kind: m.kind, channel: m.channel, to: m.to, subject: r.subject, status: res.status, provider: res.provider, error: res.error });
  }
  return json(200, {
    dryRun, total: results.length,
    sent: results.filter((x) => x.status === 'sent').length,
    failed: results.filter((x) => x.status === 'failed').length,
    providers: { email: emailProvider(env) || 'none (dry run)', whatsapp: whatsappProvider(env) || 'none (dry run)' },
    messages: results,
  });
});
