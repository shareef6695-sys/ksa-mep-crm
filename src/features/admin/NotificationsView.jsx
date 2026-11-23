// Settings -> Notifications: reminder settings, preview / send now, message log (Prompt 15, migration 0015).
import { useCallback, useEffect, useState } from 'react';
import { BellRing, Send, Eye } from 'lucide-react';

const DEFAULTS = { enabled: false, email: true, whatsapp: false, overdueDays: [1, 7, 14, 30], repeatEveryDays: 14, copySalesman: true, approvalDigest: true };
const STATUS_TONE = { sent: 'bg-emerald-50 text-emerald-700', failed: 'bg-rose-50 text-rose-700', dry_run: 'bg-slate-100 text-slate-600', skipped: 'bg-amber-50 text-amber-800' };

async function invokeNotify(supabase, body) {
  const { data, error } = await supabase.functions.invoke('notify', { body });
  if (error) {
    let message = error.message;
    try { const ctx = await error.context?.json?.(); if (ctx?.error) message = ctx.error; } catch { /* keep message */ }
    throw new Error(`${message} — is the notify Edge Function deployed? (README: Notifications)`);
  }
  return data;
}

export default function NotificationsView({ supabase, canSend }) {
  const [s, setS] = useState(DEFAULTS);
  const [days, setDays] = useState(DEFAULTS.overdueDays.join(', '));
  const [log, setLog] = useState([]);
  const [run, setRun] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: row }, { data: l, error }] = await Promise.all([
      supabase.from('app_settings').select('value').eq('key', 'notification_settings').maybeSingle(),
      supabase.from('notification_log').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    const v = { ...DEFAULTS, ...(row?.value || {}) };
    setS(v); setDays((v.overdueDays || []).join(', '));
    if (error) setMsg({ type: 'error', text: `${error.message} (run migration 0015)` }); else setLog(l || []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    const overdueDays = [...new Set(days.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
    const value = { ...s, overdueDays, repeatEveryDays: Math.max(0, Number(s.repeatEveryDays) || 0) };
    const { error } = await supabase.from('app_settings').upsert({ key: 'notification_settings', value, updated_at: new Date().toISOString() });
    setMsg(error ? { type: 'error', text: error.message } : { type: 'ok', text: 'Notification settings saved.' });
    if (!error) setS(value);
  };
  const go = async (dryRun) => {
    if (!dryRun && !window.confirm('Send the reminders now through the configured providers?')) return;
    setBusy(true); setMsg(null);
    try {
      const r = await invokeNotify(supabase, { dryRun });
      setRun(r);
      if (!dryRun) load();
    } catch (ex) { setMsg({ type: 'error', text: ex.message }); } finally { setBusy(false); }
  };
  const cls = 'border border-slate-300 rounded-lg px-2.5 py-1.5';
  return (
    <div className="space-y-4 text-xs">
      <div>
        <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2"><BellRing className="w-5 h-5" /> Notifications</h2>
        <p className="text-slate-500">Payment reminders for overdue invoices (to the customer) and a daily digest of approvals waiting for each approver.
          Sending runs in the <code>notify</code> Edge Function; with no email / WhatsApp provider configured every run is a dry run.</p>
      </div>
      {msg && <div className={`rounded-xl p-2.5 border ${msg.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>{msg.text}</div>}
      <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-4 grid sm:grid-cols-3 gap-3">
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Reminders on</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.email} onChange={(e) => setS({ ...s, email: e.target.checked })} /> Email</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.whatsapp} onChange={(e) => setS({ ...s, whatsapp: e.target.checked })} /> WhatsApp</label>
        <div><label className="block font-semibold text-slate-600 mb-1">Remind on these days past due</label><input className={`${cls} w-full`} value={days} onChange={(e) => setDays(e.target.value)} /></div>
        <div><label className="block font-semibold text-slate-600 mb-1">Then every … days (0 = stop)</label><input type="number" min="0" className={`${cls} w-full`} value={s.repeatEveryDays} onChange={(e) => setS({ ...s, repeatEveryDays: e.target.value })} /></div>
        <div className="space-y-1 pt-5">
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.copySalesman} onChange={(e) => setS({ ...s, copySalesman: e.target.checked })} /> Copy the salesman on reminder emails</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.approvalDigest} onChange={(e) => setS({ ...s, approvalDigest: e.target.checked })} /> Daily approvals digest</label>
        </div>
        <div className="sm:col-span-3 flex flex-wrap gap-2 justify-end">
          <button type="submit" className="px-3.5 py-2 rounded-xl bg-slate-900 text-white font-semibold cursor-pointer">Save settings</button>
          <button type="button" disabled={busy} onClick={() => go(true)} className="px-3.5 py-2 rounded-xl border border-slate-300 font-semibold flex items-center gap-1 cursor-pointer"><Eye className="w-3.5 h-3.5" /> Preview today&apos;s messages</button>
          {canSend && <button type="button" disabled={busy} onClick={() => go(false)} className="px-3.5 py-2 rounded-xl bg-blue-600 text-white font-semibold flex items-center gap-1 cursor-pointer"><Send className="w-3.5 h-3.5" /> Send now</button>}
        </div>
      </form>
      {run && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
          <div className="font-semibold">{run.dryRun ? 'Preview (nothing sent)' : 'Run'}: {run.total} message(s), {run.sent} sent, {run.failed} failed • email: {run.providers?.email} • WhatsApp: {run.providers?.whatsapp}</div>
          {(run.messages || []).map((m, i) => (
            <div key={i} className="flex flex-wrap gap-2 border-t border-slate-100 pt-1.5"><span className={`px-2 rounded-full ${STATUS_TONE[m.status] || ''}`}>{m.status}</span>
              <span>{m.channel}</span><span className="font-mono">{m.to}</span><span className="text-slate-600">{m.subject}</span>{m.error && <span className="text-rose-700">{m.error}</span>}</div>
          ))}
          {!run.messages?.length && <div className="text-slate-400">Nothing due today{s.enabled ? '' : ' (reminders are off)'}.</div>}
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">When</th><th className="p-2.5">Type</th><th className="p-2.5">Channel</th><th className="p-2.5">To</th><th className="p-2.5">Subject</th><th className="p-2.5">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {log.map((l) => (
              <tr key={l.id}><td className="p-2.5">{new Date(l.created_at).toLocaleString()}</td><td className="p-2.5">{l.kind === 'overdue_invoice' ? 'Payment reminder' : 'Approvals digest'}</td>
                <td className="p-2.5">{l.channel}</td><td className="p-2.5 font-mono">{l.recipient}</td><td className="p-2.5">{l.subject}</td>
                <td className="p-2.5"><span className={`px-2 rounded-full ${STATUS_TONE[l.status] || ''}`}>{l.status}</span>{l.error ? <div className="text-rose-700">{l.error}</div> : null}</td></tr>
            ))}
            {!log.length && <tr><td colSpan={6} className="p-4 text-center text-slate-400">No messages sent yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
