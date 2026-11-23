import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, ShieldCheck, AlertTriangle, History } from 'lucide-react';
import { formatSAR } from './erpEngine';

// Sales controls (migration 0013): quote approval / stages / revisions, credit control, SO amendments, pipeline.
const num = (v) => Number(v) || 0;
export const QUOTE_STAGES = { new_inquiry: 'New inquiry', quoted: 'Quoted', negotiation: 'Negotiation', won: 'Won (SO)', lost: 'Lost' };
export const LOST_REASONS = {
  PRICE: 'Price', LEAD_TIME: 'Lead time', SPECIFICATION: 'Specification / scope', COMPETITOR: 'Went to a competitor',
  NO_BUDGET: 'No budget', NO_RESPONSE: 'No response', PROJECT_CANCELLED: 'Project cancelled', OTHER: 'Other',
};

const rpc = async (supabase, fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

/** Approval badge for a quote row. */
export function ApprovalBadge({ status }) {
  if (!status?.needed) return null;
  if (status.approved) return <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">✓ Approved{status.approved_by ? ` by ${status.approved_by}` : ''}</span>;
  return (
    <span title={(status.reasons || []).join('\n')} className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full cursor-help">
      {status.stale ? 'Re-approval needed (pricing changed)' : 'Needs manager approval'}
    </span>
  );
}

/** Stage, revision, approval and history controls inside the quote drawer. */
export function QuoteControls({ supabase, inquiry, approval, canApprove, canEdit, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [lost, setLost] = useState(null); // {reason, note}
  const [history, setHistory] = useState(null);
  const won = inquiry.stage === 'won';
  const run = async (fn, args, done) => {
    setBusy(true);
    try {
      await rpc(supabase, fn, args);
      done?.();
      onChanged?.();
    } catch (e) {
      window.alert(e.message);
    } finally {
      setBusy(false);
    }
  };
  const loadHistory = async () => {
    const { data } = await supabase.from('quote_revisions').select('revision, note, created_by, created_at').eq('inquiry_id', inquiry.id).order('id', { ascending: false });
    setHistory(data || []);
  };
  return (
    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">Rev {inquiry.revision || 'A'}</span>
        {inquiry.validUntil && <span className={new Date(inquiry.validUntil) < new Date() ? 'text-rose-700 font-semibold' : 'text-slate-500'}>valid until {inquiry.validUntil}</span>}
        <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 font-semibold">{QUOTE_STAGES[inquiry.stage] || inquiry.stage || 'New inquiry'}</span>
        {inquiry.stage === 'lost' && inquiry.lostReason && <span className="text-rose-700">({LOST_REASONS[inquiry.lostReason] || inquiry.lostReason}{inquiry.lostNote ? `: ${inquiry.lostNote}` : ''})</span>}
        <ApprovalBadge status={approval} />
      </div>
      {approval?.needed && !approval?.approved && <div className="text-amber-800">Approval needed because {(approval.reasons || []).join('; ')}.</div>}
      {!won && (
        <div className="flex flex-wrap gap-2">
          {canEdit && ['new_inquiry', 'quoted', 'negotiation'].filter((s) => s !== inquiry.stage).map((s) => (
            <button key={s} type="button" disabled={busy} onClick={() => run('set_quote_stage', { p_inquiry_id: inquiry.id, p_stage: s })} className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white cursor-pointer">→ {QUOTE_STAGES[s]}</button>
          ))}
          {canEdit && inquiry.stage !== 'lost' && <button type="button" disabled={busy} onClick={() => setLost({ reason: '', note: '' })} className="px-2.5 py-1 rounded-lg border border-rose-300 text-rose-700 bg-white cursor-pointer">Mark lost</button>}
          {canEdit && <button type="button" disabled={busy} onClick={() => { const note = window.prompt('What changed in this revision?') ; if (note !== null) run('revise_quote', { p_inquiry_id: inquiry.id, p_note: note || null }); }} className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white cursor-pointer">New revision</button>}
          {canApprove && approval?.needed && !approval?.approved && (
            <button type="button" disabled={busy} onClick={() => run('approve_quote', { p_inquiry_id: inquiry.id, p_note: null })} className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold cursor-pointer flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Approve pricing</button>
          )}
          <button type="button" onClick={loadHistory} className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white cursor-pointer flex items-center gap-1"><History className="w-3.5 h-3.5" /> Revisions</button>
        </div>
      )}
      {lost && (
        <div className="grid grid-cols-12 gap-2">
          <select value={lost.reason} onChange={(e) => setLost({ ...lost, reason: e.target.value })} className="col-span-12 sm:col-span-4 border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
            <option value="">Why was it lost? *</option>
            {Object.entries(LOST_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input value={lost.note} onChange={(e) => setLost({ ...lost, note: e.target.value })} placeholder="Details (competitor, price gap…)" className="col-span-12 sm:col-span-6 border border-slate-300 rounded-lg px-2 py-1.5" />
          <button type="button" disabled={!lost.reason || busy} onClick={() => run('set_quote_stage', { p_inquiry_id: inquiry.id, p_stage: 'lost', p_lost_reason: lost.reason, p_note: lost.note || null }, () => setLost(null))} className="col-span-12 sm:col-span-2 px-2 py-1.5 rounded-lg bg-rose-600 text-white font-semibold cursor-pointer disabled:bg-slate-300">Save</button>
        </div>
      )}
      {history && (
        <div className="bg-white border border-slate-200 rounded-lg p-2 space-y-1">
          {history.length === 0 ? <div className="text-slate-500">No earlier revisions.</div> : history.map((h) => <div key={h.revision}>Rev {h.revision} — {new Date(h.created_at).toLocaleDateString()} {h.created_by ? `by ${h.created_by}` : ''}{h.note ? ` • next revision: ${h.note}` : ''}</div>)}
        </div>
      )}
    </div>
  );
}

/** Customers' credit position and Finance's one-time overrides. */
export function CreditControlPanel({ supabase, customers = [], inquiries = [], deliveryNotes = [], invoices = [], salesOrders = [], canOverride, settings }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ docType: 'SO', refId: '', reason: '' });
  const [msg, setMsg] = useState('');
  const limited = useMemo(() => customers.filter((c) => num(c.credit_limit_sar) > 0), [customers]);
  const load = useCallback(async () => {
    const out = await Promise.all(limited.slice(0, 60).map(async (c) => {
      const { data } = await supabase.rpc('credit_status', { p_customer_id: c.id, p_client_name: c.name_en, p_new_amount: 0 });
      return data;
    }));
    setRows(out.filter(Boolean));
  }, [supabase, limited]);
  useEffect(() => {
    load();
  }, [load]);
  const invoicedDn = new Set(invoices.map((i) => i.dn_id));
  const refs = form.docType === 'SO'
    ? inquiries.filter((q) => !['won', 'lost'].includes(q.stage)).map((q) => ({ id: q.id, label: `${q.refNo || q.id} — ${q.clientName}` }))
    : form.docType === 'INVOICE'
      ? deliveryNotes.filter((d) => !invoicedDn.has(d.id)).map((d) => ({ id: d.id, label: `${d.dn_number} — ${d.client_name}` }))
      : salesOrders.filter((s) => !['cancelled', 'delivered'].includes(s.status)).map((s) => ({ id: s.id, label: `${s.so_number} — ${s.client_name}` }));
  const grant = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await rpc(supabase, 'grant_credit_override', { p_doc_type: form.docType, p_ref_id: form.refId, p_reason: form.reason });
      setMsg('Override granted. It applies once, to that document.');
      setForm({ ...form, refId: '', reason: '' });
    } catch (err) {
      setMsg(err.message);
    }
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 text-xs">
      <div className="font-bold text-sm">Credit control</div>
      <p className="text-slate-500">New sales orders and invoices are refused when open receivables + open orders + the new amount exceed the customer's credit limit, or when an invoice is more than {settings?.overdueBlockDays ?? 90} days past due.</p>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="text-slate-500 text-left"><tr><th className="p-1.5">Customer</th><th className="p-1.5 text-right">Limit</th><th className="p-1.5 text-right">Open AR</th><th className="p-1.5 text-right">Open orders</th><th className="p-1.5 text-right">Available</th><th className="p-1.5">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.customerId || r.customer}>
                  <td className="p-1.5 font-semibold">{r.customer}</td><td className="p-1.5 text-right">{formatSAR(r.creditLimit)}</td><td className="p-1.5 text-right">{formatSAR(r.openAr)}</td>
                  <td className="p-1.5 text-right">{formatSAR(r.openOrders)}</td><td className={`p-1.5 text-right font-bold ${num(r.available) < 0 ? 'text-rose-700' : ''}`}>{formatSAR(r.available)}</td>
                  <td className="p-1.5">{(r.problems || []).length ? <span className="text-rose-700"><AlertTriangle className="w-3.5 h-3.5 inline" /> {r.problems.join('; ')}</span> : <span className="text-emerald-700">OK</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canOverride && (
        <form onSubmit={grant} className="grid grid-cols-12 gap-2 items-center border-t pt-3">
          <select value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value, refId: '' })} className="col-span-12 sm:col-span-3 border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
            <option value="SO">Override for a new sales order</option><option value="INVOICE">Override for an invoice</option><option value="SO_AMEND">Override for an SO increase</option>
          </select>
          <select required value={form.refId} onChange={(e) => setForm({ ...form, refId: e.target.value })} className="col-span-12 sm:col-span-4 border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
            <option value="">{form.docType === 'SO' ? 'Quote…' : form.docType === 'INVOICE' ? 'Delivery note…' : 'Sales order…'}</option>
            {refs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <input required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason (guarantee, CFO approval…) *" className="col-span-12 sm:col-span-3 border border-slate-300 rounded-lg px-2 py-1.5" />
          <button type="submit" className="col-span-12 sm:col-span-2 px-2 py-1.5 rounded-lg bg-slate-900 text-white font-semibold cursor-pointer">Grant override</button>
          {msg && <div className="col-span-12 text-slate-700">{msg}</div>}
        </form>
      )}
    </div>
  );
}

/** Amend undelivered quantities / prices on a sales order, or cancel what is still undelivered. */
export function SalesOrderAmendModal({ supabase, so, onClose, onDone }) {
  const [lines, setLines] = useState(Object.fromEntries((so.items || []).map((l) => [l.id, { orderedQty: num(l.orderedQty), unitSellSar: num(l.unitSellSar) }])));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  useEffect(() => {
    supabase.from('sales_order_changes').select('*').eq('so_id', so.id).order('id', { ascending: false }).then(({ data }) => setLog(data || []));
  }, [supabase, so.id]);
  const submit = async (kind) => {
    if (!reason.trim()) return window.alert('Give a reason for the change.');
    if (kind === 'cancel' && !window.confirm(`Cancel everything not yet delivered on ${so.so_number}?`)) return;
    setBusy(true);
    try {
      if (kind === 'cancel') await rpc(supabase, 'cancel_sales_order', { p_so_id: so.id, p_reason: reason });
      else await rpc(supabase, 'amend_sales_order', { p_so_id: so.id, p_reason: reason, p_lines: Object.entries(lines).map(([id, v]) => ({ id, orderedQty: num(v.orderedQty), unitSellSar: num(v.unitSellSar) })) });
      onDone?.();
    } catch (e) {
      window.alert(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl max-w-xl w-full p-5 space-y-3 text-xs max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="font-bold text-base">Change {so.so_number} — {so.client_name}</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        {(so.items || []).map((l) => (
          <div key={l.id} className="grid grid-cols-12 gap-2 items-center p-2 rounded-lg bg-slate-50 border border-slate-200">
            <div className="col-span-12 sm:col-span-6"><div className="font-bold">{l.desc}</div><div className="text-slate-500">delivered {num(l.deliveredQty)}</div></div>
            <input type="number" min={num(l.deliveredQty)} step="any" value={lines[l.id].orderedQty} onChange={(e) => setLines({ ...lines, [l.id]: { ...lines[l.id], orderedQty: e.target.value } })} title="Ordered quantity" className="col-span-5 sm:col-span-3 border border-slate-300 rounded-lg px-2 py-1.5 text-right" />
            <input type="number" min="0" step="any" disabled={num(l.deliveredQty) > 0} value={lines[l.id].unitSellSar} onChange={(e) => setLines({ ...lines, [l.id]: { ...lines[l.id], unitSellSar: e.target.value } })} title={num(l.deliveredQty) > 0 ? 'Price is fixed after a delivery (use a debit / credit note)' : 'Unit price SAR'} className="col-span-7 sm:col-span-3 border border-slate-300 rounded-lg px-2 py-1.5 text-right disabled:bg-slate-100" />
          </div>
        ))}
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the change *" className="w-full border border-slate-300 rounded-lg px-2 py-2" />
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => submit('amend')} className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">Save amendment</button>
          <button type="button" disabled={busy} onClick={() => submit('cancel')} className="flex-1 py-2.5 rounded-xl border border-rose-300 text-rose-700 font-semibold cursor-pointer">Cancel undelivered</button>
        </div>
        {log.length > 0 && (
          <div className="border-t pt-2 space-y-1">
            <div className="font-semibold">Change log</div>
            {log.map((c) => <div key={c.id} className="text-slate-600">{new Date(c.changed_at).toLocaleString()} • {c.change_type} by {c.changed_by}: SAR {formatSAR(c.before_total)} → {formatSAR(c.after_total)} — {c.reason}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Pipeline by stage, salesman and division (sales_pipeline()). */
export function SalesPipelineView({ supabase }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState('');
  useEffect(() => {
    supabase.rpc('sales_pipeline', { p_from: from || null, p_to: to || null }).then(({ data, error: err }) => {
      if (err) setError(err.message);
      else setRows(data || []);
    });
  }, [supabase, from, to]);
  const byStage = Object.keys(QUOTE_STAGES).map((s) => ({ s, n: rows.filter((r) => r.stage === s).reduce((t, r) => t + r.quotes, 0), v: rows.filter((r) => r.stage === s).reduce((t, r) => t + num(r.value_sar), 0) }));
  const people = [...new Set(rows.map((r) => r.salesman_name || 'Unassigned'))];
  const won = byStage.find((x) => x.s === 'won');
  const lostRow = byStage.find((x) => x.s === 'lost');
  const winRate = won.n + lostRow.n > 0 ? (won.n / (won.n + lostRow.n)) * 100 : null;
  const lostReasons = Object.entries(rows.filter((r) => r.stage === 'lost').reduce((m, r) => ({ ...m, [r.lost_reason || 'OTHER']: (m[r.lost_reason || 'OTHER'] || 0) + r.quotes }), {}));
  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">Sales Pipeline</h2>
          <p className="text-slate-500">Quotes by stage, salesman and division (values excl. VAT). Win rate = won ÷ (won + lost).</p>
        </div>
        <div className="flex gap-2 items-center">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5" />
          <span>to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5" />
        </div>
      </div>
      {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3">{error}</div>}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
        {byStage.map((x) => (
          <div key={x.s} className="bg-white border border-slate-200 rounded-2xl p-3">
            <div className="text-slate-500">{QUOTE_STAGES[x.s]}</div>
            <div className="text-lg font-bold">{x.n}</div>
            <div className="text-slate-600">SAR {formatSAR(x.v)}</div>
          </div>
        ))}
        <div className="bg-slate-900 text-white rounded-2xl p-3"><div className="text-slate-300">Win rate</div><div className="text-lg font-bold">{winRate === null ? '—' : `${winRate.toFixed(0)}%`}</div></div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">Salesman</th>{Object.keys(QUOTE_STAGES).map((s) => <th key={s} className="p-2.5 text-right">{QUOTE_STAGES[s]}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {people.map((p) => (
              <tr key={p}><td className="p-2.5 font-semibold">{p}</td>
                {Object.keys(QUOTE_STAGES).map((s) => {
                  const rs = rows.filter((r) => (r.salesman_name || 'Unassigned') === p && r.stage === s);
                  const n = rs.reduce((t, r) => t + r.quotes, 0);
                  return <td key={s} className="p-2.5 text-right">{n ? <>{n} <span className="text-slate-400">/ {formatSAR(rs.reduce((t, r) => t + num(r.value_sar), 0))}</span></> : ''}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-3">
          <div className="font-semibold mb-1">By division</div>
          {[...new Set(rows.map((r) => r.division))].map((d) => <div key={d} className="flex justify-between"><span>{d}</span><span>{rows.filter((r) => r.division === d && !['lost'].includes(r.stage)).reduce((t, r) => t + r.quotes, 0)} open/won • SAR {formatSAR(rows.filter((r) => r.division === d && r.stage !== 'lost').reduce((t, r) => t + num(r.value_sar), 0))}</span></div>)}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3">
          <div className="font-semibold mb-1">Lost reasons</div>
          {lostReasons.length === 0 ? <div className="text-slate-500">None recorded.</div> : lostReasons.map(([k, n]) => <div key={k} className="flex justify-between"><span>{LOST_REASONS[k] || k}</span><span>{n}</span></div>)}
        </div>
      </div>
    </div>
  );
}
