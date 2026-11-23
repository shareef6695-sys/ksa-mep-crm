import React, { useState } from 'react';
import { Plus, X, Printer, QrCode, Trash2 } from 'lucide-react';
import { formatSAR, VAT_EXEMPTION_REASONS } from './erpEngine';
import { QrImage } from '../ui/QrImage';
import { blocksSharing, callZatca, needsSubmission, submitAfterPosting, zatcaQr, zatcaStatus } from '../lib/zatca';

// ZATCA debit notes (migration 0010): extra amounts charged on an issued invoice (price increase, extra scope).
// Posted by post_debit_note in one transaction: Dr 1100 / Cr 4010|4020 / Cr 2100, and the invoice's open balance grows.
const emptyLine = () => ({ desc: '', qty: 1, unitSellSar: '', vatCategory: 'S', exemptionReason: '' });
const r2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;

export function DebitNotesPanel({ supabase, company, invoices, debitNotes = [], canCreate = false, canSubmitZatca = false, onRefresh }) {
  const [show, setShow] = useState(false);
  const [invId, setInvId] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [zBusy, setZBusy] = useState(null);
  const invoiceOf = (d) => invoices.find((i) => i.id === d.original_invoice_id);

  const totals = lines.reduce((t, l) => {
    const net = r2(Number(l.qty) * Number(l.unitSellSar));
    const vat = l.vatCategory === 'S' ? net * 0.15 : 0;
    return { net: t.net + net, vat: t.vat + vat };
  }, { net: 0, vat: 0 });

  const post = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('post_debit_note', {
        p_invoice_id: invId,
        p_reason: reason,
        p_lines: lines.map((l) => ({ desc: l.desc, qty: Number(l.qty), unitSellSar: Number(l.unitSellSar), vatCategory: l.vatCategory, exemptionReason: l.vatCategory === 'S' ? null : l.exemptionReason })),
      });
      if (error) {
        window.alert(`Debit note could not be issued: ${error.message}`);
        return;
      }
      setShow(false);
      setInvId('');
      setReason('');
      setLines([emptyLine()]);
      const msg = await submitAfterPosting(supabase, 'debit_note', data);
      const { data: fresh } = await supabase.from('debit_notes_v').select('*').eq('id', data.id).maybeSingle();
      const doc = fresh || data;
      if (!blocksSharing(doc, invoices.find((i) => i.id === doc.original_invoice_id)?.invoice_type)) setPreview(doc);
      if (msg) window.alert(`${doc.debit_note_number}: ${msg}`);
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  };

  const submit = async (d) => {
    setZBusy(d.id);
    try {
      const r = await callZatca(supabase, 'submit', { doc_type: 'debit_note', doc_id: d.id });
      window.alert(`ZATCA: ${r?.status || 'done'}`);
    } catch (err) {
      window.alert(`ZATCA submission failed: ${err.message}`);
    } finally {
      setZBusy(null);
      onRefresh?.();
    }
  };

  return (
    <div className="space-y-3 pt-4 border-t border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">ZATCA Debit Notes</h2>
          <p className="text-xs text-slate-500">Extra charges on an issued invoice (price increase, additional scope). Adds output VAT and increases what the customer owes.</p>
        </div>
        {canCreate && (
          <button type="button" onClick={() => setShow(true)} className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
            <Plus className="w-4 h-4" /> Issue ZATCA Debit Note
          </button>
        )}
      </div>

      {debitNotes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-500">No debit notes issued.</div>
      ) : (
        <div className="grid gap-3">
          {debitNotes.map((d) => {
            const z = zatcaStatus(d);
            const blocked = blocksSharing(d, invoiceOf(d)?.invoice_type);
            return (
              <div key={d.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded font-mono">{d.debit_note_number}</span>
                    <span className="font-semibold bg-slate-100 px-2 py-0.5 rounded">Ref Invoice: {d.original_invoice_number}</span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${z.tone === 'positive' ? 'bg-emerald-50 text-emerald-800' : z.tone === 'negative' ? 'bg-rose-50 text-rose-800' : z.tone === 'critical' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>ZATCA: {z.label}</span>
                  </div>
                  <div className="font-bold mt-1">{d.client_name}</div>
                  <div className="text-xs text-slate-500">Reason: <strong>{d.reason}</strong> • Total: <strong className="text-indigo-700">+ SAR {formatSAR(d.grand_total_sar)}</strong></div>
                </div>
                <div className="flex gap-2">
                  {canSubmitZatca && needsSubmission(d) && (
                    <button type="button" disabled={zBusy === d.id} onClick={() => submit(d)} className="px-3 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold cursor-pointer disabled:bg-slate-300">{zBusy === d.id ? 'Sending…' : 'Send to ZATCA'}</button>
                  )}
                  <button type="button" disabled={blocked} title={blocked ? 'Available once ZATCA has cleared this debit note' : undefined} onClick={() => setPreview(d)}
                    className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                    <QrCode className="w-4 h-4" /> View Debit Note
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {show && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={post} className="bg-white rounded-t-3xl sm:rounded-2xl max-w-2xl w-full p-5 space-y-3 text-xs max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">Issue ZATCA Debit Note</h3>
              <button type="button" onClick={() => setShow(false)}><X className="w-5 h-5" /></button>
            </div>
            <select required value={invId} onChange={(e) => setInvId(e.target.value)} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white">
              <option value="">Original invoice…</option>
              {invoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_number} — {i.client_name} (SAR {formatSAR(i.grand_total_sar)})</option>)}
            </select>
            <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (shown to the customer and ZATCA) *" className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-start">
                  <input required value={l.desc} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))} placeholder="Description *" className="col-span-12 sm:col-span-4 border border-slate-300 rounded-lg px-2 py-1.5" />
                  <input required type="number" min="0.0001" step="any" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className="col-span-3 sm:col-span-1 border border-slate-300 rounded-lg px-2 py-1.5" title="Quantity" />
                  <input required type="number" min="0.01" step="any" value={l.unitSellSar} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitSellSar: e.target.value } : x)))} placeholder="Unit SAR" className="col-span-4 sm:col-span-2 border border-slate-300 rounded-lg px-2 py-1.5" />
                  <select value={l.vatCategory} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, vatCategory: e.target.value, exemptionReason: '' } : x)))} className="col-span-4 sm:col-span-2 border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
                    <option value="S">15% standard</option><option value="Z">Zero rated</option><option value="E">Exempt</option><option value="O">Out of scope</option>
                  </select>
                  {l.vatCategory !== 'S' ? (
                    <select required value={l.exemptionReason} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, exemptionReason: e.target.value } : x)))} className="col-span-11 sm:col-span-2 border border-amber-300 rounded-lg px-2 py-1.5 bg-amber-50">
                      <option value="">Reason…</option>
                      {VAT_EXEMPTION_REASONS.filter((r) => r.category === l.vatCategory).map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}
                    </select>
                  ) : <span className="col-span-11 sm:col-span-2" />}
                  <button type="button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="col-span-1 p-1.5 text-slate-400 hover:text-rose-600 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <button type="button" onClick={() => setLines([...lines, emptyLine()])} className="text-blue-700 font-semibold">+ Add line</button>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 flex justify-between font-semibold">
              <span>Net SAR {formatSAR(totals.net)} • VAT SAR {formatSAR(totals.vat)}</span>
              <span>Total SAR {formatSAR(totals.net + totals.vat)}</span>
            </div>
            <button type="submit" disabled={busy} className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold cursor-pointer disabled:bg-slate-300">{busy ? 'Posting…' : 'Post Debit Note & Adjust Ledger'}</button>
          </form>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto text-xs">
            <div className="no-print flex items-center justify-between border-b pb-3">
              <span className="font-bold text-base text-indigo-700">ZATCA Tax Debit Note • إشعار مدين ضريبي</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => window.print()} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold flex items-center gap-1 cursor-pointer"><Printer className="w-3.5 h-3.5" /> Print / PDF</button>
                <button type="button" onClick={() => setPreview(null)}><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="flex justify-between items-start gap-4 border-b pb-4">
              <div className="space-y-1">
                <div className="text-lg font-bold">{company?.nameEn}</div>
                <div className="text-sm font-bold text-blue-700">{company?.nameAr}</div>
                <div className="font-mono font-semibold">VAT Reg / الرقم الضريبي: {company?.vatNumber}</div>
                <div className="text-indigo-700 font-semibold">Original Invoice Ref: {preview.original_invoice_number}{preview.original_invoice_date ? ` (${String(preview.original_invoice_date).slice(0, 10)})` : ''}</div>
              </div>
              <div className="text-center shrink-0">
                <QrImage value={zatcaQr(preview)} size={112} alt="ZATCA QR" className="w-28 h-28 border border-slate-200 rounded-lg p-1 mx-auto" />
                <div className="text-[10px] text-slate-500 mt-1 font-mono">{preview.zatca_qr ? 'ZATCA Phase 2 QR' : 'ZATCA Phase 1 QR'}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl">
              <div><div className="text-slate-400">Debit Note No / رقم الإشعار</div><div className="font-bold font-mono">{preview.debit_note_number}</div></div>
              <div><div className="text-slate-400">Date / التاريخ</div><div className="font-bold">{new Date(preview.issued_at).toLocaleString()}</div></div>
              <div><div className="text-slate-400">Customer / العميل</div><div className="font-bold">{preview.client_name}</div></div>
              <div><div className="text-slate-400">Reason / السبب</div><div className="font-bold">{preview.reason}</div></div>
              <div className="col-span-2"><div className="text-slate-400">ZATCA UUID</div><div className="font-mono text-[10px]">{preview.zatca_uuid}</div></div>
            </div>
            <table className="w-full border border-slate-200">
              <thead className="bg-slate-100"><tr><th className="p-2 text-left">Description / البيان</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit</th><th className="p-2 text-right">VAT</th><th className="p-2 text-right">Total</th></tr></thead>
              <tbody className="divide-y">
                {(preview.items || []).map((it, i) => (
                  <tr key={i}><td className="p-2">{it.desc}</td><td className="p-2 text-right">{it.qty}</td><td className="p-2 text-right">{formatSAR(it.unitSellSar)}</td><td className="p-2 text-right">{it.vatCategory === 'S' ? '15%' : it.vatCategory}</td><td className="p-2 text-right font-semibold">{formatSAR(r2(Number(it.qty) * Number(it.unitSellSar)))}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="space-y-1 text-right">
              <div>Subtotal: <strong>SAR {formatSAR(preview.subtotal_sar)}</strong></div>
              <div>VAT: <strong>SAR {formatSAR(preview.vat_sar)}</strong></div>
              <div className="text-sm font-bold text-indigo-700">Total Debit Incl. VAT: + SAR {formatSAR(preview.grand_total_sar)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
