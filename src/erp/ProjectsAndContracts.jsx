import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Plus, FolderKanban, FileSignature, Wrench, RefreshCw, AlertTriangle } from 'lucide-react';
import { formatSAR } from './erpEngine';

// Projects (MEP progress billing), IT & ELV service contracts and service tickets — migration 0014.
const num = (v) => Number(v) || 0;
const today = () => new Date().toISOString().slice(0, 10);
const inputCls = 'w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs';
const labelCls = 'block font-semibold text-slate-600 mb-1';
const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50';

export const INVOICE_KIND = { sale: 'Sale', advance: 'Advance (386)', progress: 'Progress claim', retention: 'Retention release', contract: 'Contract', service: 'Service' };
const BILLING_METHOD = { delivery: 'Per delivery (normal)', percent: '% complete', boq: 'BOQ quantities' };
const PROJECT_STATUS = { active: 'Active', on_hold: 'On hold', completed: 'Completed', closed: 'Closed' };
const FREQ = { monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Semi-annual', annual: 'Annual' };
const CONTRACT_TYPE = { amc: 'AMC', subscription: 'Subscription', support: 'Support', licence: 'Licence' };
const TICKET_STATUS = { open: 'Open', in_progress: 'In progress', on_hold: 'On hold', resolved: 'Resolved', closed: 'Closed', cancelled: 'Cancelled' };
const COVERAGE = { warranty: 'Warranty', amc: 'AMC', chargeable: 'Chargeable' };

const rpc = async (supabase, fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-3">
      <div className={`bg-white rounded-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} p-5 space-y-3 max-h-[92vh] overflow-y-auto text-xs`}>
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="font-bold text-sm">{title}</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const ErrorBox = ({ text }) => (text ? <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-2.5 text-xs">{text}</div> : null);
const Badge = ({ children, tone = 'slate' }) => {
  const tones = { slate: 'bg-slate-100 text-slate-700', blue: 'bg-blue-50 text-blue-700', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-800', rose: 'bg-rose-50 text-rose-700' };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${tones[tone]}`}>{children}</span>;
};

// ---------------------------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------------------------
const blankProject = () => ({
  name: '', customer_id: '', division: 'MEP', cost_centre: '', project_manager: '', status: 'active', billing_method: 'percent',
  contract_value_sar: '', retention_pct: 10, advance_pct: 0, start_date: '', end_date: '', notes: '',
  budget: { revenue: '', material: '', labour: '', subcontract: '', other: '' }, boq: [],
});

function ProjectModal({ supabase, project, customers, onClose, onSaved }) {
  const [f, setF] = useState(() => (project ? { ...blankProject(), ...project, budget: { ...blankProject().budget, ...(project.budget || {}) }, boq: project.boq || [] } : blankProject()));
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const boqValue = (f.boq || []).reduce((s, b) => s + Math.round(num(b.qty) * num(b.rate) * 100) / 100, 0);
  const setBoq = (i, k, v) => setF({ ...f, boq: f.boq.map((b, j) => (j === i ? { ...b, [k]: v } : b)) });
  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      const saved = await rpc(supabase, 'save_project', { p: { ...f, id: project?.id || null } });
      onSaved(saved);
    } catch (ex) { setErr(ex.message); } finally { setSaving(false); }
  };
  return (
    <Modal title={project ? `Edit ${project.project_code}` : 'New project'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-3">
        <div className="grid sm:grid-cols-3 gap-2">
          <div className="sm:col-span-2"><label className={labelCls}>Project name *</label><input required className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><label className={labelCls}>Customer *</label>
            <select required className={inputCls} value={f.customer_id || ''} onChange={(e) => setF({ ...f, customer_id: e.target.value })}>
              <option value="">— Choose —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name_en}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>Division</label>
            <select className={inputCls} value={f.division} onChange={(e) => setF({ ...f, division: e.target.value })}><option>MEP</option><option>IT &amp; ELV</option></select></div>
          <div><label className={labelCls}>Cost centre</label><input className={inputCls} value={f.cost_centre} onChange={(e) => setF({ ...f, cost_centre: e.target.value })} /></div>
          <div><label className={labelCls}>Project manager</label><input className={inputCls} value={f.project_manager} onChange={(e) => setF({ ...f, project_manager: e.target.value })} /></div>
          <div><label className={labelCls}>Billing</label>
            <select className={inputCls} value={f.billing_method} onChange={(e) => setF({ ...f, billing_method: e.target.value })}>
              {Object.entries(BILLING_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          {f.billing_method !== 'boq' && (
            <div><label className={labelCls}>Contract value (SAR excl. VAT)</label><input type="number" step="0.01" min="0" className={inputCls} value={f.contract_value_sar} onChange={(e) => setF({ ...f, contract_value_sar: e.target.value })} /></div>
          )}
          {f.billing_method === 'boq' && <div><label className={labelCls}>Contract value (from BOQ)</label><div className="py-1.5 font-semibold">SAR {formatSAR(boqValue)}</div></div>}
          <div><label className={labelCls}>Status</label>
            <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          {f.billing_method !== 'delivery' && (
            <>
              <div><label className={labelCls}>Retention %</label><input type="number" step="0.01" min="0" max="50" className={inputCls} value={f.retention_pct} onChange={(e) => setF({ ...f, retention_pct: e.target.value })} /></div>
              <div><label className={labelCls}>Advance % (default for the advance invoice)</label><input type="number" step="0.01" min="0" max="100" className={inputCls} value={f.advance_pct} onChange={(e) => setF({ ...f, advance_pct: e.target.value })} /></div>
            </>
          )}
          <div><label className={labelCls}>Start</label><input type="date" className={inputCls} value={f.start_date || ''} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></div>
          <div><label className={labelCls}>End</label><input type="date" className={inputCls} value={f.end_date || ''} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></div>
        </div>
        <div>
          <div className="font-semibold text-slate-700 mb-1">Budget (SAR)</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {['revenue', 'material', 'labour', 'subcontract', 'other'].map((k) => (
              <div key={k}><label className={labelCls}>{k[0].toUpperCase() + k.slice(1)}</label>
                <input type="number" step="0.01" min="0" className={inputCls} value={f.budget[k]} onChange={(e) => setF({ ...f, budget: { ...f.budget, [k]: e.target.value } })} /></div>
            ))}
          </div>
        </div>
        {f.billing_method === 'boq' && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-slate-700">BOQ (bill of quantities)</span>
              <button type="button" className={`${btn} bg-slate-100`} onClick={() => setF({ ...f, boq: [...f.boq, { code: '', description: '', unit: 'NOS', qty: '', rate: '' }] })}>+ Line</button>
            </div>
            <table className="w-full">
              <thead className="text-slate-500 text-left"><tr><th className="p-1">Code</th><th className="p-1">Description</th><th className="p-1">Unit</th><th className="p-1 text-right">Qty</th><th className="p-1 text-right">Rate</th><th className="p-1 text-right">Amount</th><th /></tr></thead>
              <tbody>
                {f.boq.map((b, i) => (
                  <tr key={i}>
                    <td className="p-1 w-20"><input className={inputCls} value={b.code} onChange={(e) => setBoq(i, 'code', e.target.value)} /></td>
                    <td className="p-1"><input className={inputCls} value={b.description} onChange={(e) => setBoq(i, 'description', e.target.value)} /></td>
                    <td className="p-1 w-16"><input className={inputCls} value={b.unit} onChange={(e) => setBoq(i, 'unit', e.target.value)} /></td>
                    <td className="p-1 w-20"><input type="number" step="any" className={`${inputCls} text-right`} value={b.qty} onChange={(e) => setBoq(i, 'qty', e.target.value)} /></td>
                    <td className="p-1 w-24"><input type="number" step="any" className={`${inputCls} text-right`} value={b.rate} onChange={(e) => setBoq(i, 'rate', e.target.value)} /></td>
                    <td className="p-1 text-right w-24">{formatSAR(num(b.qty) * num(b.rate))}</td>
                    <td className="p-1"><button type="button" onClick={() => setF({ ...f, boq: f.boq.filter((_, j) => j !== i) })}><X className="w-4 h-4 text-slate-400" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div><label className={labelCls}>Notes</label><textarea className={inputCls} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        <ErrorBox text={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className={`${btn} bg-slate-100`} onClick={onClose}>Cancel</button>
          <button disabled={saving} className={`${btn} bg-blue-600 text-white`}>{saving ? 'Saving…' : 'Save project'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ClaimModal({ supabase, project, billing, onClose, onPosted }) {
  const [pct, setPct] = useState('');
  const [qtys, setQtys] = useState(() => Object.fromEntries((project.boq || []).map((b) => [b.code, num(billing?.boqQty?.[b.code])])));
  const [deduct, setDeduct] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const r = num(project.retention_pct) / 100;
  const gross = project.billing_method === 'percent'
    ? Math.max(0, Math.round(num(project.contract_value_sar) * num(pct)) / 100 - num(billing?.billedGross))
    : (project.boq || []).reduce((s, b) => s + Math.max(0, num(qtys[b.code]) - num(billing?.boqQty?.[b.code])) * num(b.rate), 0);
  const cum = num(billing?.billedGross) + gross;
  const final = cum >= num(project.contract_value_sar) - 0.005;
  const autoDeduct = num(billing?.advanceRemaining) > 0
    ? Math.min(num(billing.advanceRemaining), final ? num(billing.advanceRemaining) : Math.round(num(billing.advanceNet) * gross / num(project.contract_value_sar) * 100) / 100) : 0;
  const net = gross * (1 - r);
  const ded = deduct === '' ? autoDeduct : num(deduct);
  const payable = net * 1.15 - ded * 1.15;
  const post = async () => {
    setSaving(true); setErr('');
    try {
      const p = project.billing_method === 'percent' ? { percentComplete: num(pct) } : { quantities: qtys };
      if (deduct !== '') p.advanceDeductionSar = num(deduct);
      if (note) p.note = note;
      const inv = await rpc(supabase, 'post_progress_invoice', { p_project_id: project.id, p });
      onPosted(inv);
    } catch (ex) { setErr(ex.message); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Progress claim ${num(billing?.claims) + 1} — ${project.project_code}`} onClose={onClose} wide={project.billing_method === 'boq'}>
      <p className="text-slate-500">Claims are cumulative: enter work done to date. Already claimed: SAR {formatSAR(billing?.billedGross)} ({num(billing?.lastPercent)}%).</p>
      {project.billing_method === 'percent' ? (
        <div><label className={labelCls}>Cumulative % complete</label><input type="number" step="0.01" min="0" max="100" className={inputCls} value={pct} onChange={(e) => setPct(e.target.value)} /></div>
      ) : (
        <table className="w-full">
          <thead className="text-slate-500 text-left"><tr><th className="p-1">BOQ</th><th className="p-1 text-right">Contract qty</th><th className="p-1 text-right">Claimed</th><th className="p-1 text-right">Done to date</th><th className="p-1 text-right">This claim</th></tr></thead>
          <tbody>
            {(project.boq || []).map((b) => (
              <tr key={b.code}>
                <td className="p-1">{b.code} {b.description}</td>
                <td className="p-1 text-right">{b.qty} {b.unit}</td>
                <td className="p-1 text-right">{num(billing?.boqQty?.[b.code])}</td>
                <td className="p-1 w-24"><input type="number" step="any" className={`${inputCls} text-right`} value={qtys[b.code]} onChange={(e) => setQtys({ ...qtys, [b.code]: e.target.value })} /></td>
                <td className="p-1 text-right">SAR {formatSAR(Math.max(0, num(qtys[b.code]) - num(billing?.boqQty?.[b.code])) * num(b.rate))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {num(billing?.advanceRemaining) > 0 && (
        <div><label className={labelCls}>Advance to deduct (SAR excl. VAT) — default pro rata: {formatSAR(autoDeduct)}{final ? ' (final claim: all of it)' : ''}</label>
          <input type="number" step="0.01" min="0" className={inputCls} value={deduct} placeholder={formatSAR(autoDeduct)} onChange={(e) => setDeduct(e.target.value)} /></div>
      )}
      <div><label className={labelCls}>Note (optional)</label><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="bg-slate-50 rounded-xl p-3 space-y-1">
        <div className="flex justify-between"><span>Work done this claim</span><b>SAR {formatSAR(gross)}</b></div>
        <div className="flex justify-between"><span>Retention {num(project.retention_pct)}%</span><span>- {formatSAR(gross * r)}</span></div>
        <div className="flex justify-between"><span>Advance deducted (+VAT)</span><span>- {formatSAR(ded * 1.15)}</span></div>
        <div className="flex justify-between border-t pt-1"><span>Estimated amount due incl. VAT</span><b>SAR {formatSAR(payable)}</b></div>
        <div className="text-[10px] text-slate-400">Final amounts are computed by the server (ZATCA rounding).</div>
      </div>
      <ErrorBox text={err} />
      <div className="flex justify-end gap-2">
        <button className={`${btn} bg-slate-100`} onClick={onClose}>Cancel</button>
        <button disabled={saving || gross <= 0} className={`${btn} bg-blue-600 text-white`} onClick={post}>{saving ? 'Posting…' : 'Post claim invoice'}</button>
      </div>
    </Modal>
  );
}

export function ProjectsView({ supabase, projects = [], customers = [], salesOrders = [], invoices = [], canManage, canBill, onRefresh, onPostedInvoice }) {
  const [selId, setSelId] = useState(null);
  const [edit, setEdit] = useState(null); // null | 'new' | project
  const [claimFor, setClaimFor] = useState(null);
  const [billing, setBilling] = useState(null);
  const [cost, setCost] = useState(null);
  const [lines, setLines] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('open');
  const sel = projects.find((p) => p.id === selId) || null;
  const list = projects.filter((p) => filter === 'all' || (filter === 'open' ? !['closed'].includes(p.status) : p.status === filter));

  const loadDetail = useCallback(async (id) => {
    if (!id) return;
    setErr('');
    try {
      const [b, c] = await Promise.all([rpc(supabase, 'project_billing', { p_project_id: id }), rpc(supabase, 'project_job_cost', { p_project_id: id })]);
      setBilling(b); setCost((c || [])[0] || null); setLines(null);
    } catch (ex) { setErr(ex.message); }
  }, [supabase]);
  useEffect(() => { loadDetail(selId); }, [selId, loadDetail, invoices.length]);

  const act = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  const posted = async (inv) => { setClaimFor(null); await onPostedInvoice(inv); loadDetail(selId); };
  const linkedSOs = sel ? salesOrders.filter((s) => s.project_id === sel.id) : [];
  const linkable = sel ? salesOrders.filter((s) => !s.project_id && s.status !== 'cancelled'
    && ((sel.customer_id && s.customer_id === sel.customer_id) || (s.client_name || '').trim().toLowerCase() === sel.client_name.trim().toLowerCase())) : [];
  const projInvoices = sel ? invoices.filter((i) => i.project_id === sel.id) : [];

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2"><FolderKanban className="w-5 h-5" /> Projects</h2>
          <p className="text-slate-500">Job costing, advances, progress claims with retention, retention release.</p>
        </div>
        <div className="flex gap-2">
          <select className="border border-slate-300 rounded-lg px-2 py-1.5" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="open">Not closed</option><option value="all">All</option>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {canManage && <button className={`${btn} bg-blue-600 text-white flex items-center gap-1`} onClick={() => setEdit('new')}><Plus className="w-3.5 h-3.5" /> New project</button>}
        </div>
      </div>
      <ErrorBox text={err} />
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">Project</th><th className="p-2.5">Customer</th><th className="p-2.5">Division</th><th className="p-2.5">Billing</th><th className="p-2.5 text-right">Contract (SAR)</th><th className="p-2.5">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((p) => (
              <tr key={p.id} className={`cursor-pointer hover:bg-slate-50 ${p.id === selId ? 'bg-blue-50' : ''}`} onClick={() => setSelId(p.id)}>
                <td className="p-2.5"><div className="font-semibold">{p.project_code}</div><div className="text-slate-500">{p.name}</div></td>
                <td className="p-2.5">{p.client_name}</td>
                <td className="p-2.5">{p.division}{p.cost_centre ? ` • ${p.cost_centre}` : ''}</td>
                <td className="p-2.5">{BILLING_METHOD[p.billing_method]}{num(p.retention_pct) > 0 ? ` • ret. ${num(p.retention_pct)}%` : ''}</td>
                <td className="p-2.5 text-right">{formatSAR(p.contract_value_sar)}</td>
                <td className="p-2.5"><Badge tone={p.status === 'active' ? 'green' : 'slate'}>{PROJECT_STATUS[p.status]}</Badge></td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="p-4 text-center text-slate-400">No projects.</td></tr>}
          </tbody>
        </table>
      </div>

      {sel && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-sm font-bold">{sel.project_code} — {sel.name}</div>
              <div className="text-slate-500">{sel.client_name} • {BILLING_METHOD[sel.billing_method]} • PM {sel.project_manager || '—'}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManage && <button className={`${btn} bg-slate-100`} onClick={() => setEdit(sel)}>Edit</button>}
              {canBill && sel.billing_method !== 'delivery' && (
                <>
                  <button disabled={busy} className={`${btn} bg-slate-900 text-white`} onClick={() => {
                    const def = num(sel.contract_value_sar) * num(sel.advance_pct) / 100;
                    const v = window.prompt(`Advance amount excl. VAT (SAR) for ${sel.project_code}:`, def ? def.toFixed(2) : '');
                    if (v) act(async () => posted(await rpc(supabase, 'post_advance_invoice', { p_project_id: sel.id, p_amount_sar: num(v), p_note: '' })));
                  }}>Advance invoice</button>
                  <button disabled={busy} className={`${btn} bg-blue-600 text-white`} onClick={() => setClaimFor(sel)}>Progress claim</button>
                  {num(billing?.retentionHeld) > 0 && (
                    <button disabled={busy} className={`${btn} bg-emerald-600 text-white`} onClick={() => {
                      const v = window.prompt(`Retention to release (SAR excl. VAT). Held: ${formatSAR(billing.retentionHeld)}`, num(billing.retentionHeld).toFixed(2));
                      if (v) act(async () => posted(await rpc(supabase, 'post_retention_release', { p_project_id: sel.id, p_amount_sar: num(v), p_note: '' })));
                    }}>Release retention</button>
                  )}
                </>
              )}
            </div>
          </div>

          {billing && (
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
              {[['Contract', sel.contract_value_sar], ['Claimed (work done)', billing.billedGross], ['Advance billed', billing.advanceNet],
                ['Advance not yet deducted', billing.advanceRemaining], ['Retention held', billing.retentionHeld], ['Invoiced incl. VAT', billing.invoicedTotal]].map(([l, v]) => (
                <div key={l} className="bg-slate-50 rounded-xl p-2.5"><div className="text-slate-500">{l}</div><div className="font-bold">SAR {formatSAR(v)}</div></div>
              ))}
            </div>
          )}

          {cost && (
            <div>
              <div className="font-semibold mb-1">Job cost (from the GL)</div>
              <table className="w-full">
                <thead className="text-slate-500 text-left"><tr><th className="p-1.5" /><th className="p-1.5 text-right">Budget</th><th className="p-1.5 text-right">Actual</th><th className="p-1.5 text-right">Variance</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {[['Revenue', 'revenue', cost.revenue_sar], ['Material', 'material', cost.material_sar], ['Labour', 'labour', cost.labour_sar],
                    ['Subcontract', 'subcontract', cost.subcontract_sar], ['Other costs', 'other', cost.other_cost_sar]].map(([l, k, a]) => (
                    <tr key={k}><td className="p-1.5">{l}</td><td className="p-1.5 text-right">{formatSAR(sel.budget?.[k])}</td><td className="p-1.5 text-right">{formatSAR(a)}</td>
                      <td className={`p-1.5 text-right ${k !== 'revenue' && num(a) > num(sel.budget?.[k]) && num(sel.budget?.[k]) > 0 ? 'text-rose-600 font-semibold' : ''}`}>{formatSAR(num(a) - num(sel.budget?.[k]))}</td></tr>
                  ))}
                  <tr className="font-bold"><td className="p-1.5">Margin</td><td className="p-1.5 text-right">{formatSAR(num(sel.budget?.revenue) - num(cost.budget_cost_sar))}</td>
                    <td className="p-1.5 text-right">{formatSAR(cost.margin_sar)}{cost.margin_pct !== null ? ` (${num(cost.margin_pct).toFixed(1)}%)` : ''}</td><td /></tr>
                </tbody>
              </table>
              <button className="text-blue-700 font-semibold mt-1" onClick={async () => {
                if (lines) return setLines(null);
                try { setLines(await rpc(supabase, 'project_cost_lines', { p_project_id: sel.id })); } catch (ex) { setErr(ex.message); }
              }}>{lines ? 'Hide' : 'Show'} GL lines</button>
              {lines && (
                <table className="w-full mt-1">
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((l, i) => (
                      <tr key={i}><td className="p-1">{l.entry_date}</td><td className="p-1">{l.voucher_number}</td><td className="p-1">{l.source_doc}</td><td className="p-1">{l.account_code} {l.account_name}</td>
                        <td className="p-1 text-slate-500">{l.memo}</td><td className="p-1 text-right">{num(l.debit) ? formatSAR(l.debit) : ''}</td><td className="p-1 text-right">{num(l.credit) ? formatSAR(l.credit) : ''}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <div className="font-semibold mb-1">Sales orders</div>
              {linkedSOs.map((s) => (
                <div key={s.id} className="flex justify-between py-1 border-b border-slate-100">
                  <span>{s.so_number} • SAR {formatSAR(s.grand_total_sar)}{s.id === sel.main_so_id ? ' • main' : ''}</span>
                  {canManage && <button className="text-slate-500" onClick={() => act(async () => { await rpc(supabase, 'link_sales_order_to_project', { p_so_id: s.id, p_project_id: null }); onRefresh(); })}>Unlink</button>}
                </div>
              ))}
              {!linkedSOs.length && <div className="text-slate-400">No sales order linked.</div>}
              {canManage && linkable.length > 0 && (
                <select className={`${inputCls} mt-2`} value="" onChange={(e) => e.target.value && act(async () => { await rpc(supabase, 'link_sales_order_to_project', { p_so_id: e.target.value, p_project_id: sel.id }); onRefresh(); })}>
                  <option value="">Link a sales order of {sel.client_name}…</option>
                  {linkable.map((s) => <option key={s.id} value={s.id}>{s.so_number} — SAR {formatSAR(s.grand_total_sar)}</option>)}
                </select>
              )}
            </div>
            <div>
              <div className="font-semibold mb-1">Invoices</div>
              {projInvoices.map((i) => (
                <div key={i.id} className="flex justify-between py-1 border-b border-slate-100">
                  <span>{i.invoice_number} <Badge tone={i.invoice_kind === 'advance' ? 'amber' : i.invoice_kind === 'retention' ? 'green' : 'blue'}>{INVOICE_KIND[i.invoice_kind] || i.invoice_kind}</Badge></span>
                  <span>SAR {formatSAR(i.grand_total_sar)}{num(i.retention_sar) ? ` • ret. ${formatSAR(i.retention_sar)}` : ''}</span>
                </div>
              ))}
              {!projInvoices.length && <div className="text-slate-400">No invoices yet.</div>}
            </div>
          </div>
        </div>
      )}

      {edit && <ProjectModal supabase={supabase} project={edit === 'new' ? null : edit} customers={customers} onClose={() => setEdit(null)}
        onSaved={(p) => { setEdit(null); setSelId(p.id); onRefresh(); }} />}
      {claimFor && <ClaimModal supabase={supabase} project={claimFor} billing={billing} onClose={() => setClaimFor(null)} onPosted={posted} />}
    </div>
  );
}

export function JobCostView({ supabase }) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    supabase.rpc('project_job_cost', { p_project_id: null, p_from: from || null, p_to: to || null }).then(({ data, error }) => {
      if (error) setErr(error.message); else { setErr(''); setRows(data || []); }
    });
  }, [supabase, from, to]);
  const tot = (k) => rows.reduce((s, r) => s + num(r[k]), 0);
  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">Project Job Cost</h2>
          <p className="text-slate-500">Revenue and costs per project from GL lines tagged with the project. Material = 5010/5020, labour = 5200/5310, subcontract = 5300.</p>
        </div>
        <div className="flex gap-2 items-center">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5" /><span>to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5" />
        </div>
      </div>
      <ErrorBox text={err} />
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr><th className="p-2">Project</th><th className="p-2 text-right">Contract</th><th className="p-2 text-right">Revenue</th><th className="p-2 text-right">Material</th><th className="p-2 text-right">Labour</th>
              <th className="p-2 text-right">Subcontract</th><th className="p-2 text-right">Other</th><th className="p-2 text-right">Margin</th><th className="p-2 text-right">Budget cost</th><th className="p-2 text-right">Retention held</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.project_id}>
                <td className="p-2"><div className="font-semibold">{r.project_code}</div><div className="text-slate-500">{r.name} • {r.client_name}</div></td>
                <td className="p-2 text-right">{formatSAR(r.contract_value_sar)}</td>
                <td className="p-2 text-right">{formatSAR(r.revenue_sar)}</td>
                <td className="p-2 text-right">{formatSAR(r.material_sar)}</td>
                <td className="p-2 text-right">{formatSAR(r.labour_sar)}</td>
                <td className="p-2 text-right">{formatSAR(r.subcontract_sar)}</td>
                <td className="p-2 text-right">{formatSAR(r.other_cost_sar)}</td>
                <td className={`p-2 text-right font-semibold ${num(r.margin_sar) < 0 ? 'text-rose-600' : ''}`}>{formatSAR(r.margin_sar)}{r.margin_pct !== null ? ` (${num(r.margin_pct).toFixed(1)}%)` : ''}</td>
                <td className={`p-2 text-right ${num(r.total_cost_sar) > num(r.budget_cost_sar) && num(r.budget_cost_sar) > 0 ? 'text-rose-600 font-semibold' : ''}`}>{formatSAR(r.budget_cost_sar)}</td>
                <td className="p-2 text-right">{formatSAR(r.retention_held_sar)}</td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="font-bold bg-slate-50">
                <td className="p-2">Total</td><td className="p-2 text-right">{formatSAR(tot('contract_value_sar'))}</td><td className="p-2 text-right">{formatSAR(tot('revenue_sar'))}</td>
                <td className="p-2 text-right">{formatSAR(tot('material_sar'))}</td><td className="p-2 text-right">{formatSAR(tot('labour_sar'))}</td><td className="p-2 text-right">{formatSAR(tot('subcontract_sar'))}</td>
                <td className="p-2 text-right">{formatSAR(tot('other_cost_sar'))}</td><td className="p-2 text-right">{formatSAR(tot('margin_sar'))}</td><td className="p-2 text-right">{formatSAR(tot('budget_cost_sar'))}</td>
                <td className="p-2 text-right">{formatSAR(tot('retention_held_sar'))}</td>
              </tr>
            )}
            {!rows.length && <tr><td colSpan={10} className="p-4 text-center text-slate-400">No projects.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Service contracts (AMC / subscriptions)
// ---------------------------------------------------------------------------------------------
const blankContract = () => ({
  title: '', customer_id: '', contract_type: 'amc', division: 'IT & ELV', start_date: today(), end_date: '', billing_frequency: 'monthly',
  billing_timing: 'advance', deferred_revenue: false, renewal_notice_days: 30, sla_response_hours: 24, covers_all_assets: false, covered_serials: [],
  lines: [{ desc: '', qty: 1, monthlySar: '', vatCategory: 'S', exemptionReason: '' }], notes: '',
});

function ContractModal({ supabase, contract, customers, onClose, onSaved }) {
  const [f, setF] = useState(() => (contract ? { ...blankContract(), ...contract } : blankContract()));
  const [serials, setSerials] = useState(() => (contract?.covered_serials || []).join(', '));
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const locked = contract && contract.status !== 'draft';
  const monthly = (f.lines || []).reduce((s, l) => s + num(l.qty) * num(l.monthlySar), 0);
  const setLine = (i, k, v) => setF({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      const saved = await rpc(supabase, 'save_contract', { p: { ...f, id: contract?.id || null, covered_serials: serials.split(/[\s,;]+/).filter(Boolean) } });
      onSaved(saved);
    } catch (ex) { setErr(ex.message); } finally { setSaving(false); }
  };
  return (
    <Modal title={contract ? `${contract.contract_number} — ${contract.status}` : 'New service contract'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-3">
        {locked && <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">This contract is running: prices and dates change by renewal. You can change the service side (SLA, covered serials, notice period, notes).</p>}
        <fieldset disabled={locked} className="grid sm:grid-cols-3 gap-2">
          <div className="sm:col-span-2"><label className={labelCls}>Title *</label><input required className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div><label className={labelCls}>Customer *</label>
            <select required className={inputCls} value={f.customer_id || ''} onChange={(e) => setF({ ...f, customer_id: e.target.value })}>
              <option value="">— Choose —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name_en}</option>)}
            </select></div>
          <div><label className={labelCls}>Type</label><select className={inputCls} value={f.contract_type} onChange={(e) => setF({ ...f, contract_type: e.target.value })}>{Object.entries(CONTRACT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className={labelCls}>Division</label><select className={inputCls} value={f.division} onChange={(e) => setF({ ...f, division: e.target.value })}><option>IT &amp; ELV</option><option>MEP</option></select></div>
          <div><label className={labelCls}>Billing</label>
            <div className="flex gap-1">
              <select className={inputCls} value={f.billing_frequency} onChange={(e) => setF({ ...f, billing_frequency: e.target.value })}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select className={inputCls} value={f.billing_timing} onChange={(e) => setF({ ...f, billing_timing: e.target.value })}><option value="advance">in advance</option><option value="arrears">in arrears</option></select>
            </div></div>
          <div><label className={labelCls}>Start *</label><input type="date" required className={inputCls} value={f.start_date || ''} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></div>
          <div><label className={labelCls}>End *</label><input type="date" required className={inputCls} value={f.end_date || ''} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></div>
          <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={!!f.deferred_revenue} onChange={(e) => setF({ ...f, deferred_revenue: e.target.checked })} /> Deferred revenue (2400, recognised monthly)</label>
        </fieldset>
        <fieldset disabled={locked}>
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-slate-700">Lines (price per unit per month) — monthly value SAR {formatSAR(monthly)}</span>
            <button type="button" className={`${btn} bg-slate-100`} onClick={() => setF({ ...f, lines: [...f.lines, { desc: '', qty: 1, monthlySar: '', vatCategory: 'S', exemptionReason: '' }] })}>+ Line</button>
          </div>
          <table className="w-full">
            <thead className="text-slate-500 text-left"><tr><th className="p-1">Description</th><th className="p-1 text-right">Qty</th><th className="p-1 text-right">SAR / month</th><th className="p-1">VAT</th><th className="p-1">Exemption code</th><th /></tr></thead>
            <tbody>
              {f.lines.map((l, i) => (
                <tr key={i}>
                  <td className="p-1"><input className={inputCls} value={l.desc} onChange={(e) => setLine(i, 'desc', e.target.value)} /></td>
                  <td className="p-1 w-20"><input type="number" step="any" className={`${inputCls} text-right`} value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} /></td>
                  <td className="p-1 w-28"><input type="number" step="0.01" className={`${inputCls} text-right`} value={l.monthlySar} onChange={(e) => setLine(i, 'monthlySar', e.target.value)} /></td>
                  <td className="p-1 w-16"><select className={inputCls} value={l.vatCategory || 'S'} onChange={(e) => setLine(i, 'vatCategory', e.target.value)}><option>S</option><option>Z</option><option>E</option><option>O</option></select></td>
                  <td className="p-1 w-32"><input className={inputCls} disabled={(l.vatCategory || 'S') === 'S'} value={l.exemptionReason || ''} onChange={(e) => setLine(i, 'exemptionReason', e.target.value)} placeholder="VATEX-SA-…" /></td>
                  <td className="p-1"><button type="button" onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })}><X className="w-4 h-4 text-slate-400" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
        <div className="grid sm:grid-cols-3 gap-2">
          <div><label className={labelCls}>SLA response (hours)</label><input type="number" min="1" className={inputCls} value={f.sla_response_hours} onChange={(e) => setF({ ...f, sla_response_hours: e.target.value })} /></div>
          <div><label className={labelCls}>Renewal reminder (days before end)</label><input type="number" min="0" className={inputCls} value={f.renewal_notice_days} onChange={(e) => setF({ ...f, renewal_notice_days: e.target.value })} /></div>
          <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={!!f.covers_all_assets} onChange={(e) => setF({ ...f, covers_all_assets: e.target.checked })} /> Covers all of the customer&apos;s equipment</label>
          <div className="sm:col-span-3"><label className={labelCls}>Covered serial numbers (comma separated)</label><textarea rows={2} className={inputCls} value={serials} onChange={(e) => setSerials(e.target.value)} /></div>
          <div className="sm:col-span-3"><label className={labelCls}>Notes</label><textarea rows={2} className={inputCls} value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <ErrorBox text={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className={`${btn} bg-slate-100`} onClick={onClose}>Close</button>
          <button disabled={saving} className={`${btn} bg-blue-600 text-white`}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function DraftRow({ supabase, d, contract, canBill, canEdit, onChanged, onPosted, setErr }) {
  const [lines, setLines] = useState(d.lines || []);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(lines) !== JSON.stringify(d.lines || []);
  const total = lines.reduce((s, l) => s + Math.round(num(l.qty) * num(l.unitSellSar) * 100) / 100, 0);
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); } };
  return (
    <div className="border border-slate-200 rounded-xl p-3 space-y-2">
      <div className="flex flex-wrap justify-between gap-2">
        <div><b>{contract?.contract_number}</b> {contract?.client_name} • period {d.period_no}: {d.period_start} → {d.period_end} • bill date {d.bill_date}</div>
        <div className="font-bold">SAR {formatSAR(total)} + VAT</div>
      </div>
      <table className="w-full">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="p-1">{l.desc}</td>
              <td className="p-1 w-24"><input type="number" step="any" disabled={!canEdit} className={`${inputCls} text-right`} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
              <td className="p-1 w-14 text-slate-500">{l.unit}</td>
              <td className="p-1 w-28"><input type="number" step="0.01" disabled={!canEdit} className={`${inputCls} text-right`} value={l.unitSellSar} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitSellSar: e.target.value } : x)))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end gap-2">
        {canEdit && dirty && <button disabled={busy} className={`${btn} bg-slate-900 text-white`} onClick={() => run(async () => { await rpc(supabase, 'update_contract_draft', { p_period_id: d.id, p_lines: lines, p_note: null }); onChanged(); })}>Save changes</button>}
        {canEdit && <button disabled={busy} className={`${btn} bg-slate-100`} onClick={() => { const r = window.prompt('Reason for skipping this period:'); if (r) run(async () => { await rpc(supabase, 'skip_contract_draft', { p_period_id: d.id, p_reason: r }); onChanged(); }); }}>Skip</button>}
        {canBill && <button disabled={busy || dirty} title={dirty ? 'Save the changes first' : ''} className={`${btn} bg-blue-600 text-white`} onClick={() => run(async () => onPosted(await rpc(supabase, 'post_contract_invoice', { p_period_id: d.id })))}>Post invoice</button>}
      </div>
    </div>
  );
}

export function ContractsView({ supabase, customers = [], canManage, canActivate, canBill, canRecognize, onPostedInvoice }) {
  const [tab, setTab] = useState('contracts');
  const [contracts, setContracts] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [renewals, setRenewals] = useState([]);
  const [deferred, setDeferred] = useState([]);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [asOf, setAsOf] = useState(today());
  const [through, setThrough] = useState(today());
  const load = useCallback(async () => {
    const [k, d, r, s] = await Promise.all([
      supabase.from('service_contracts').select('*').order('contract_number', { ascending: false }),
      supabase.from('contract_billing_periods').select('*').eq('status', 'draft').order('bill_date'),
      supabase.rpc('contract_renewals_due', { p_within_days: null }),
      canRecognize ? supabase.from('deferred_revenue_schedule').select('*').eq('recognized', false).order('month') : Promise.resolve({ data: [] }),
    ]);
    const e = k.error || d.error || r.error || s.error;
    if (e) setErr(e.message);
    setContracts(k.data || []); setDrafts(d.data || []); setRenewals(r.data || []); setDeferred(s.data || []);
  }, [supabase, canRecognize]);
  useEffect(() => { load(); }, [load]);
  const byId = useMemo(() => Object.fromEntries(contracts.map((c) => [c.id, c])), [contracts]);
  const run = async (fn) => { setErr(''); setMsg(''); try { await fn(); } catch (ex) { setErr(ex.message); } };
  const posted = async (inv) => { await onPostedInvoice(inv); load(); };
  const deferredByMonth = Object.entries(deferred.reduce((m, r) => ({ ...m, [r.month]: (m[r.month] || 0) + num(r.amount_sar) }), {}));
  const tabs = [['contracts', `Contracts (${contracts.length})`], ['drafts', `Billing drafts (${drafts.length})`], ['renewals', `Renewals due (${renewals.length})`]];
  if (canRecognize) tabs.push(['deferred', 'Deferred revenue']);

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2"><FileSignature className="w-5 h-5" /> Service Contracts (AMC / Subscriptions)</h2>
          <p className="text-slate-500">Recurring billing: drafts are generated when a period falls due, reviewed, then posted as invoices.</p>
        </div>
        {canManage && <button className={`${btn} bg-blue-600 text-white flex items-center gap-1`} onClick={() => setEdit('new')}><Plus className="w-3.5 h-3.5" /> New contract</button>}
      </div>
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 font-semibold ${tab === k ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500'}`}>{l}</button>)}
      </div>
      <ErrorBox text={err} />
      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-2.5">{msg}</div>}

      {tab === 'contracts' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">Contract</th><th className="p-2.5">Customer</th><th className="p-2.5">Term</th><th className="p-2.5">Billing</th><th className="p-2.5 text-right">SAR / month</th><th className="p-2.5">Status</th><th className="p-2.5" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td className="p-2.5"><button className="font-semibold text-blue-700" onClick={() => setEdit(c)}>{c.contract_number}</button><div className="text-slate-500">{CONTRACT_TYPE[c.contract_type]} • {c.title}</div></td>
                  <td className="p-2.5">{c.client_name}<div className="text-slate-400">{c.salesman_name}</div></td>
                  <td className="p-2.5">{c.start_date} → {c.end_date}</td>
                  <td className="p-2.5">{FREQ[c.billing_frequency]} in {c.billing_timing}{c.deferred_revenue ? ' • deferred' : ''}</td>
                  <td className="p-2.5 text-right">{formatSAR(c.monthly_value_sar)}</td>
                  <td className="p-2.5"><Badge tone={c.status === 'active' ? 'green' : c.status === 'draft' ? 'amber' : 'slate'}>{c.status}</Badge>{c.renewed_to ? <div className="text-slate-400">renewed</div> : null}</td>
                  <td className="p-2.5 space-x-2 whitespace-nowrap">
                    {canActivate && c.status === 'draft' && <button className="text-emerald-700 font-semibold" onClick={() => run(async () => { await rpc(supabase, 'activate_contract', { p_id: c.id }); load(); })}>Activate</button>}
                    {canActivate && ['draft', 'active'].includes(c.status) && <button className="text-slate-600" onClick={() => { const v = window.prompt(`Salesman commission on ${c.contract_number} invoices (% of the invoice net, 0-50):`, String(num(c.commission_pct))); if (v !== null) run(async () => { await rpc(supabase, 'set_contract_commission', { p_id: c.id, p_pct: num(v) }); load(); }); }}>Commission {num(c.commission_pct)}%</button>}
                    {canManage && ['active', 'expired'].includes(c.status) && !c.renewed_to && <button className="text-blue-700 font-semibold" onClick={() => { const u = window.prompt('Price change for the renewal (% , e.g. 5 or 0):', '0'); if (u !== null) run(async () => { const n = await rpc(supabase, 'renew_contract', { p_id: c.id, p: { upliftPct: num(u) } }); setMsg(`Draft renewal ${n.contract_number} created.`); load(); }); }}>Renew</button>}
                    {canActivate && ['draft', 'active'].includes(c.status) && <button className="text-rose-700" onClick={() => { const r = window.prompt(`Cancel ${c.contract_number}? Reason:`); if (r) run(async () => { await rpc(supabase, 'cancel_contract', { p_id: c.id, p_reason: r }); load(); }); }}>Cancel</button>}
                  </td>
                </tr>
              ))}
              {!contracts.length && <tr><td colSpan={7} className="p-4 text-center text-slate-400">No contracts.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'drafts' && (
        <div className="space-y-2">
          {canActivate && (
            <div className="flex items-center gap-2">
              <span>Make drafts for periods due by</span>
              <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5" />
              <button className={`${btn} bg-slate-900 text-white flex items-center gap-1`} onClick={() => run(async () => { const n = await rpc(supabase, 'generate_contract_drafts', { p_as_of: asOf, p_contract_id: null }); setMsg(`${n} draft(s) made.`); load(); })}><RefreshCw className="w-3.5 h-3.5" /> Generate drafts</button>
            </div>
          )}
          {drafts.map((d) => <DraftRow key={`${d.id}-${d.updated_at}`} supabase={supabase} d={d} contract={byId[d.contract_id]} canBill={canBill} canEdit={canActivate} onChanged={load} onPosted={posted} setErr={setErr} />)}
          {!drafts.length && <div className="text-slate-400 p-4 text-center bg-white border border-slate-200 rounded-2xl">No drafts waiting.</div>}
        </div>
      )}

      {tab === 'renewals' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">Contract</th><th className="p-2.5">Customer</th><th className="p-2.5">Salesman</th><th className="p-2.5">Ends</th><th className="p-2.5 text-right">Days left</th><th className="p-2.5 text-right">SAR / month</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {renewals.map((r) => (
                <tr key={r.contract_id} className={r.days_left < 0 ? 'bg-rose-50' : r.days_left <= 14 ? 'bg-amber-50' : ''}>
                  <td className="p-2.5 font-semibold">{r.contract_number} <span className="text-slate-500 font-normal">{r.title}</span></td><td className="p-2.5">{r.client_name}</td><td className="p-2.5">{r.salesman_name}</td>
                  <td className="p-2.5">{r.end_date}</td><td className="p-2.5 text-right">{r.days_left}</td><td className="p-2.5 text-right">{formatSAR(r.monthly_value_sar)}</td>
                </tr>
              ))}
              {!renewals.length && <tr><td colSpan={6} className="p-4 text-center text-slate-400">No contract is inside its renewal notice period.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'deferred' && canRecognize && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span>Recognise deferred revenue for months up to</span>
            <input type="date" value={through} onChange={(e) => setThrough(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5" />
            <button className={`${btn} bg-slate-900 text-white`} onClick={() => run(async () => { const r = await rpc(supabase, 'recognize_deferred_revenue', { p_through: through }); setMsg(r.journal ? `SAR ${formatSAR(r.amount)} recognised (${r.journal}).` : 'Nothing to recognise.'); load(); })}>Recognise (Dr 2400 / Cr revenue)</button>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">Month</th><th className="p-2.5 text-right">Still deferred (SAR)</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {deferredByMonth.map(([m, v]) => <tr key={m}><td className="p-2.5">{m.slice(0, 7)}</td><td className="p-2.5 text-right">{formatSAR(v)}</td></tr>)}
                {!deferredByMonth.length && <tr><td colSpan={2} className="p-4 text-center text-slate-400">Nothing deferred.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {edit && <ContractModal supabase={supabase} contract={edit === 'new' ? null : edit} customers={customers} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Service tickets
// ---------------------------------------------------------------------------------------------
function NewTicketModal({ supabase, customers, onClose, onSaved }) {
  const [f, setF] = useState({ serial: '', customer_id: '', subject: '', description: '', priority: 'normal', contact_name: '', contact_phone: '', chargeable: false });
  const [cov, setCov] = useState(null);
  const [err, setErr] = useState('');
  const check = async () => {
    setErr('');
    try { setCov(await rpc(supabase, 'serial_coverage', { p_serial: f.serial, p_customer_id: f.customer_id || null, p_client_name: null })); } catch (ex) { setErr(ex.message); }
  };
  const save = async (e) => {
    e.preventDefault(); setErr('');
    try { onSaved(await rpc(supabase, 'open_service_ticket', { p: f })); } catch (ex) { setErr(ex.message); }
  };
  return (
    <Modal title="New service ticket" onClose={onClose}>
      <form onSubmit={save} className="space-y-2">
        <div><label className={labelCls}>Serial number</label>
          <div className="flex gap-2"><input className={inputCls} value={f.serial} onChange={(e) => { setF({ ...f, serial: e.target.value }); setCov(null); }} />
            <button type="button" className={`${btn} bg-slate-100 whitespace-nowrap`} onClick={check}>Check coverage</button></div></div>
        {cov && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-0.5">
            <div>Coverage: <Badge tone={cov.coverage === 'chargeable' ? 'amber' : 'green'}>{COVERAGE[cov.coverage]}</Badge> {cov.contractNumber ? `(${cov.contractNumber}, SLA ${cov.slaHours} h)` : ''}</div>
            <div className="text-slate-600">{cov.found ? `${cov.itemName || ''} • ${cov.dnNumber || 'no delivery note'} • warranty to ${cov.warrantyEnd || '—'}` : 'Serial not found in our deliveries.'}{cov.clientName ? ` • ${cov.clientName}` : ''}</div>
          </div>
        )}
        <div><label className={labelCls}>Customer {cov?.clientName ? '(from the serial)' : '*'}</label>
          <select className={inputCls} value={f.customer_id} onChange={(e) => { setF({ ...f, customer_id: e.target.value }); setCov(null); }}>
            <option value="">— {cov?.clientName || 'Choose'} —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name_en}</option>)}
          </select></div>
        <div><label className={labelCls}>Problem *</label><input required className={inputCls} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></div>
        <div><label className={labelCls}>Details</label><textarea rows={2} className={inputCls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className={labelCls}>Priority</label><select className={inputCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></div>
          <div><label className={labelCls}>Contact</label><input className={inputCls} value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></div>
          <div><label className={labelCls}>Phone</label><input className={inputCls} value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></div>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.chargeable} onChange={(e) => setF({ ...f, chargeable: e.target.checked })} /> Chargeable even if covered (e.g. misuse, out of scope)</label>
        <ErrorBox text={err} />
        <div className="flex justify-end gap-2"><button type="button" className={`${btn} bg-slate-100`} onClick={onClose}>Cancel</button><button className={`${btn} bg-blue-600 text-white`}>Open ticket</button></div>
      </form>
    </Modal>
  );
}

function TicketModal({ supabase, ticket, teamProfiles, canBill, onClose, onSaved, onInvoiced }) {
  const [f, setF] = useState({ status: ticket.status, assigned_to: ticket.assigned_to, priority: ticket.priority, resolution: ticket.resolution, labour_hours: ticket.labour_hours, chargeable_sar: ticket.chargeable_sar, note: '' });
  const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault(); setErr('');
    try { onSaved(await rpc(supabase, 'update_service_ticket', { p_id: ticket.id, p: f })); } catch (ex) { setErr(ex.message); }
  };
  const final = ['closed', 'cancelled'].includes(ticket.status);
  return (
    <Modal title={`${ticket.ticket_number} — ${ticket.subject}`} onClose={onClose}>
      <div className="text-slate-600">{ticket.client_name} • {ticket.item_name} {ticket.serial} • <Badge tone={ticket.coverage === 'chargeable' ? 'amber' : 'green'}>{COVERAGE[ticket.coverage]}</Badge> • SLA {ticket.sla_due_at ? new Date(ticket.sla_due_at).toLocaleString() : '—'}</div>
      {ticket.description && <p className="bg-slate-50 rounded-lg p-2">{ticket.description}</p>}
      <form onSubmit={save} className="space-y-2">
        <fieldset disabled={final} className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div><label className={labelCls}>Status</label><select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(TICKET_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={labelCls}>Priority</label><select className={inputCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></div>
            <div><label className={labelCls}>Assigned to</label>
              <input list="ticket-team" className={inputCls} value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })} />
              <datalist id="ticket-team">{teamProfiles.map((t) => <option key={t.id} value={t.full_name} />)}</datalist></div>
          </div>
          <div><label className={labelCls}>Resolution</label><textarea rows={2} className={inputCls} value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={labelCls}>Labour hours</label><input type="number" step="0.25" min="0" className={inputCls} value={f.labour_hours} onChange={(e) => setF({ ...f, labour_hours: e.target.value })} /></div>
            {ticket.coverage === 'chargeable' && <div><label className={labelCls}>Charge (SAR excl. VAT)</label><input type="number" step="0.01" min="0" className={inputCls} value={f.chargeable_sar} onChange={(e) => setF({ ...f, chargeable_sar: e.target.value })} /></div>}
          </div>
          <div><label className={labelCls}>Note for the history</label><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        </fieldset>
        <div className="max-h-32 overflow-y-auto border-t pt-2 space-y-0.5">
          {(ticket.history || []).map((h, i) => <div key={i} className="text-slate-500">{new Date(h.at).toLocaleString()} • {h.by} • {TICKET_STATUS[h.status] || h.status}{h.note ? ` — ${h.note}` : ''}</div>)}
        </div>
        {ticket.invoice_number && <div className="text-emerald-700 font-semibold">Invoiced: {ticket.invoice_number}</div>}
        <ErrorBox text={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className={`${btn} bg-slate-100`} onClick={onClose}>Close</button>
          {canBill && ticket.coverage === 'chargeable' && ['resolved', 'closed'].includes(ticket.status) && num(ticket.chargeable_sar) > 0 && !ticket.invoice_id && (
            <button type="button" className={`${btn} bg-slate-900 text-white`} onClick={async () => {
              setErr('');
              try { onInvoiced(await rpc(supabase, 'invoice_service_ticket', { p_ticket_id: ticket.id })); } catch (ex) { setErr(ex.message); }
            }}>Issue invoice (SAR {formatSAR(ticket.chargeable_sar)} + VAT)</button>
          )}
          {!final && <button className={`${btn} bg-blue-600 text-white`}>Save</button>}
        </div>
      </form>
    </Modal>
  );
}

export function ServiceTicketsView({ supabase, customers = [], teamProfiles = [], canBill, onPostedInvoice }) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState('open_all');
  const [showNew, setShowNew] = useState(false);
  const [open, setOpen] = useState(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('service_tickets').select('*').order('opened_at', { ascending: false }).limit(1000);
    if (error) setErr(error.message); else setRows(data || []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);
  const now = Date.now();
  const list = rows.filter((t) => (status === 'open_all' ? !['resolved', 'closed', 'cancelled'].includes(t.status) : status === 'all' || t.status === status));
  const overdue = (t) => t.sla_due_at && !['resolved', 'closed', 'cancelled'].includes(t.status) && new Date(t.sla_due_at).getTime() < now;
  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2"><Wrench className="w-5 h-5" /> Service Tickets</h2>
          <p className="text-slate-500">Against warranties (serials we delivered) and AMCs. SLA from the contract, otherwise by priority (critical 4 h, high 8 h, normal 24 h, low 72 h).</p>
        </div>
        <div className="flex gap-2">
          <select className="border border-slate-300 rounded-lg px-2 py-1.5" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open_all">Open / in progress / on hold</option><option value="all">All</option>{Object.entries(TICKET_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className={`${btn} bg-blue-600 text-white flex items-center gap-1`} onClick={() => setShowNew(true)}><Plus className="w-3.5 h-3.5" /> New ticket</button>
        </div>
      </div>
      <ErrorBox text={err} />
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">Ticket</th><th className="p-2.5">Customer</th><th className="p-2.5">Equipment</th><th className="p-2.5">Coverage</th><th className="p-2.5">Priority</th><th className="p-2.5">Assigned</th><th className="p-2.5">SLA due</th><th className="p-2.5">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((t) => (
              <tr key={t.id} className={`cursor-pointer hover:bg-slate-50 ${overdue(t) ? 'bg-rose-50' : ''}`} onClick={() => setOpen(t)}>
                <td className="p-2.5"><div className="font-semibold">{t.ticket_number}</div><div className="text-slate-500">{t.subject}</div></td>
                <td className="p-2.5">{t.client_name}</td>
                <td className="p-2.5">{t.item_name} {t.serial}</td>
                <td className="p-2.5"><Badge tone={t.coverage === 'chargeable' ? 'amber' : 'green'}>{COVERAGE[t.coverage]}</Badge></td>
                <td className="p-2.5">{t.priority}</td>
                <td className="p-2.5">{t.assigned_to || '—'}</td>
                <td className="p-2.5">{overdue(t) && <AlertTriangle className="w-3.5 h-3.5 inline text-rose-600 mr-1" />}{t.sla_due_at ? new Date(t.sla_due_at).toLocaleString() : '—'}</td>
                <td className="p-2.5">{TICKET_STATUS[t.status]}{t.invoice_number ? <div className="text-emerald-700">{t.invoice_number}</div> : null}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={8} className="p-4 text-center text-slate-400">No tickets.</td></tr>}
          </tbody>
        </table>
      </div>
      {showNew && <NewTicketModal supabase={supabase} customers={customers} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
      {open && <TicketModal supabase={supabase} ticket={open} teamProfiles={teamProfiles} canBill={canBill} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }}
        onInvoiced={async (inv) => { setOpen(null); await onPostedInvoice?.(inv); load(); }} />}
    </div>
  );
}
