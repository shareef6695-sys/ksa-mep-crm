import React, { useState } from 'react';
import { RotateCcw, QrCode, Printer, X, Plus } from 'lucide-react';
import { formatSAR } from './erpEngine';
import { ShareDocumentButtons } from './shareDispatch';
import { DebitNotesPanel } from './DebitNotesPanel';
import { QrImage } from '../ui/QrImage';
import { blocksSharing, callZatca, needsSubmission, submitAfterPosting, zatcaQr, zatcaStatus } from '../lib/zatca';

// Reason shown on the credit note -> code stored for ZATCA (0006)
const REASONS = [
  { label: 'Sales Return / Defective Material', code: 'RETURN' },
  { label: 'Damaged in Transit', code: 'DAMAGED' },
  { label: 'Post-Invoice Commercial Discount', code: 'PRICE_ADJUSTMENT' },
  { label: 'Cancelled Scope / Partial Cancellation', code: 'CANCELLATION' },
  { label: 'Quantity / Billing Correction', code: 'OTHER' },
];

export function CreditNotesView({
  supabase,
  company,
  invoices,
  creditNotes,
  debitNotes = [],
  canDebit = false,
  canSubmitZatca = false,
  commissions,
  profile,
  onRefresh,
  readOnly = false,
}) {
  const [showModal, setShowModal] = useState(false);
  const [selectedInvId, setSelectedInvId] = useState('');
  const [reason, setReason] = useState('Sales Return / Defective Material');
  const [returnQtys, setReturnQtys] = useState({});
  const [replacement, setReplacement] = useState(false); // 0024: reopen the returned qty on the sales order
  const [previewCN, setPreviewCN] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [creditedQty, setCreditedQty] = useState([]); // already credited per invoice line (0006)
  const [zBusy, setZBusy] = useState(null);
  const invTypeOf = (cn) => invoices.find((i) => i.id === cn.original_invoice_id)?.invoice_type;
  const submitCn = async (cn) => {
    setZBusy(cn.id);
    try {
      const r = await callZatca(supabase, 'submit', { doc_type: 'credit_note', doc_id: cn.id });
      window.alert(`ZATCA: ${r?.status || 'done'}`);
    } catch (err) {
      window.alert(`ZATCA submission failed: ${err.message}`);
    } finally {
      setZBusy(null);
      onRefresh();
    }
  };

  const selectedInvoice = invoices.find((i) => i.id === selectedInvId) || null;
  const leftQty = (it, idx) => Math.max(0, (Number(it.qty) || 0) - (Number(creditedQty[idx]) || 0));
  // invoices that still have value left to credit
  const creditableInvoices = invoices.filter((i) => Number(i.grand_total_sar || 0) + Number(i.debited_amount_sar || 0) - Number(i.credited_amount_sar || 0) > 0.01);

  const handleSelectInvoice = async (invId) => {
    setSelectedInvId(invId);
    setReturnQtys({});
    setReplacement(false);
    setCreditedQty([]);
    if (!invId) return;
    const { data, error } = await supabase.rpc('invoice_credited_qty', { p_invoice_id: invId });
    if (!error && Array.isArray(data)) setCreditedQty(data.map((q) => Number(q) || 0));
  };

  const handleIssueCreditNote = async (e) => {
    e.preventDefault();
    if (!selectedInvoice) return;
    setSubmitting(true);

    try {
      // One transaction in the database: credit note + journal + invoice balance + commission (0004_posting.sql)
      const qtys = (selectedInvoice.items || []).map((_, idx) => Math.max(0, Number(returnQtys[idx]) || 0));
      if (!qtys.some((q) => q > 0)) return;
      const { data: insertedCN, error } = await supabase.rpc('post_credit_note', {
        p_invoice_id: selectedInvoice.id,
        p_return_qtys: qtys,
        p_reason: reason,
        p_reason_code: REASONS.find((r) => r.label === reason)?.code || 'OTHER',
        p_replacement: Boolean(replacement && selectedInvoice.dn_id),
      });
      if (error) {
        window.alert(`Credit note could not be issued: ${error.message}`);
        return;
      }

      setShowModal(false);
      setSelectedInvId('');
      if (insertedCN && Number(insertedCN.to_customer_credit_sar) > 0) {
        window.alert(`${insertedCN.credit_note_number}: the customer had already paid, so SAR ${formatSAR(insertedCN.to_customer_credit_sar)} is now customer credit. Apply it to another invoice or refund it from AR Customer Receipts.`);
      }
      if (insertedCN) {
        // Phase 2: clear (B2B) / report (B2C) with ZATCA straight away
        const msg = await submitAfterPosting(supabase, 'credit_note', insertedCN);
        const { data: fresh } = await supabase.from('credit_notes_v').select('*').eq('id', insertedCN.id).maybeSingle();
        const cn = fresh || insertedCN;
        if (!blocksSharing(cn, selectedInvoice.invoice_type)) setPreviewCN(cn);
        if (msg) window.alert(`${cn.credit_note_number}: ${msg}`);
      }
      onRefresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">ZATCA Credit Notes &amp; Sales Returns</h2>
          <p className="text-xs text-slate-500">
            Official ZATCA e-Credit Notes linked to posted Tax Invoices—reverses 15% VAT, AR receivable balance, and Salesman profit share.
          </p>
        </div>
        <button
          hidden={readOnly}
          onClick={() => setShowModal(true)}
          className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Issue ZATCA Credit Note
        </button>
      </div>

      {creditNotes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          No Credit Notes issued yet. Click <strong>Issue ZATCA Credit Note</strong> to process a return or post-invoice adjustment.
        </div>
      ) : (
        <div className="grid gap-3">
          {creditNotes.map((cn) => (
            <div key={cn.id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-0.5 rounded font-mono">
                    {cn.credit_note_number}
                  </span>
                  <span className="text-xs font-semibold bg-slate-100 px-2 py-0.5 rounded">
                    Ref Invoice: {cn.original_invoice_number}
                  </span>
                  {(() => {
                    const z = zatcaStatus(cn);
                    return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${z.tone === 'positive' ? 'bg-emerald-50 text-emerald-800' : z.tone === 'negative' ? 'bg-rose-50 text-rose-800' : z.tone === 'critical' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>ZATCA: {z.label}</span>;
                  })()}
                </div>
                <h3 className="text-base font-bold mt-1">{cn.client_name}</h3>
                <p className="text-xs text-slate-500">
                  Reason: <strong>{cn.reason}</strong>{cn.replacement && <> • <strong className="text-blue-700">replacement to follow</strong></>} • Reversed Total: <strong className="text-rose-700">- SAR {formatSAR(cn.grand_total_sar)}</strong>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
              {canSubmitZatca && needsSubmission(cn) && (
                <button type="button" disabled={zBusy === cn.id} onClick={() => submitCn(cn)} className="px-3 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold cursor-pointer disabled:bg-slate-300">{zBusy === cn.id ? 'Sending…' : 'Send to ZATCA'}</button>
              )}
              {!blocksSharing(cn, invTypeOf(cn)) && <ShareDocumentButtons company={company} docType="ZATCA Credit Note" docNumber={cn.credit_note_number} clientName={cn.client_name} totalSar={cn.grand_total_sar} compact />}
              <button onClick={() => setPreviewCN(cn)} disabled={blocksSharing(cn, invTypeOf(cn))} title={blocksSharing(cn, invTypeOf(cn)) ? 'Available once ZATCA has cleared this credit note' : undefined}
                className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5 cursor-pointer self-start sm:self-center disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <QrCode className="w-4 h-4" /> View ZATCA Credit Note
              </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL: ISSUE ZATCA CREDIT NOTE */}
      {showModal && !readOnly && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-rose-600" /> Issue ZATCA Credit Note
              </h3>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleIssueCreditNote} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Original Posted ZATCA Invoice *</label>
                <select
                  required
                  value={selectedInvId}
                  onChange={(e) => handleSelectInvoice(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 bg-white font-semibold"
                >
                  <option value="">Select Posted Invoice...</option>
                  {creditableInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_number} — {inv.client_name} (SAR {formatSAR(inv.grand_total_sar)}{Number(inv.credited_amount_sar) > 0 ? `, credited ${formatSAR(inv.credited_amount_sar)}` : ''})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">ZATCA Credit Note Reason *</label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 bg-white"
                >
                  {REASONS.map((r) => <option key={r.code + r.label} value={r.label}>{r.label}</option>)}
                </select>
              </div>

              {selectedInvoice && (
                <div className="space-y-2 pt-1">
                  <div className="font-bold text-slate-700">Select Quantities to Credit / Return:</div>
                  {(selectedInvoice.items || []).map((it, idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-bold">{it.desc}</div>
                        <div className="text-slate-500">
                          Invoiced Qty: {it.qty} • Unit Price: SAR {formatSAR(it.unitSellSar)}
                          {Number(creditedQty[idx]) > 0 && <> • <span className="text-rose-700 font-semibold">Already credited: {creditedQty[idx]}</span></>} • Left: {leftQty(it, idx)}
                        </div>
                      </div>
                      <input
                        type="number"
                        min="0"
                        max={leftQty(it, idx)}
                        step="any"
                        disabled={leftQty(it, idx) <= 0}
                        value={returnQtys[idx] ?? 0}
                        onChange={(e) => setReturnQtys({ ...returnQtys, [idx]: e.target.value })}
                        className="w-20 border border-slate-300 rounded-lg px-2.5 py-1.5 text-right font-bold bg-white"
                      />
                    </div>
                  ))}
                </div>
              )}

              {selectedInvoice?.dn_id && (
                <label className="flex items-start gap-2 p-3 rounded-xl border border-slate-200 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 w-4 h-4" checked={replacement} onChange={(e) => setReplacement(e.target.checked)} />
                  <span>
                    <span className="font-bold text-slate-700">Replacement to follow</span>
                    <span className="block text-slate-500">Reopens the returned quantity on {selectedInvoice.so_number || 'the sales order'} so the replacement can be delivered and invoiced against it.</span>
                  </span>
                </label>
              )}

              <button
                type="submit"
                disabled={submitting || !selectedInvoice}
                className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold cursor-pointer"
              >
                {submitting ? 'Generating ZATCA Credit Note...' : 'Post ZATCA Credit Note & Adjust Ledger'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: BILINGUAL ZATCA CREDIT NOTE PREVIEW */}
      {previewCN && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="no-print flex items-center justify-between border-b pb-3"><span className="font-bold text-base text-rose-700">ZATCA Tax Credit Note • إشعار دائن ضريبي</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Print / PDF
                </button>
                <button onClick={() => setPreviewCN(null)}><X className="w-5 h-5" /></button>
              </div>
            </div>

            <div className="flex justify-between items-start gap-4 border-b pb-4">
              <div className="space-y-1 text-xs">
                <div className="text-lg font-bold text-slate-900">{company?.logoUrl && (<img src={company.logoUrl} alt="Company Logo" className="h-12 max-w-[160px] object-contain mb-1.5" />)}
                  {company.nameEn}</div>
                <div className="text-sm font-bold text-blue-700">{company.nameAr}</div>
                <div className="font-mono font-semibold">VAT Reg / الرقم الضريبي: {company.vatNumber}</div>
                <div className="text-rose-700 font-semibold">Original Invoice Ref: {previewCN.original_invoice_number}{previewCN.original_invoice_date ? ` (${String(previewCN.original_invoice_date).slice(0, 10)})` : ''}</div>
              </div>
              <div className="text-center shrink-0">
                <QrImage value={zatcaQr(previewCN)} size={112} alt="ZATCA Credit Note QR" className="w-28 h-28 border border-slate-200 rounded-lg p-1 mx-auto" />
                <div className="text-[10px] text-slate-500 mt-1 font-mono">{previewCN.zatca_qr ? 'ZATCA Phase 2 QR' : 'ZATCA Phase 1 QR'}</div>
                {previewCN.zatca_uuid && <div className="text-[9px] text-slate-400 font-mono mt-0.5">UUID {previewCN.zatca_uuid}</div>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-rose-50/50 border border-rose-100 p-3.5 rounded-xl">
              <div>
                <div className="text-slate-400">Credit Note No / رقم الإشعار</div>
                <div className="font-bold font-mono">{previewCN.credit_note_number}</div>
              </div>
              <div>
                <div className="text-slate-400">Date / التاريخ</div>
                <div className="font-bold">{new Date(previewCN.issued_at).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-slate-400">Customer / العميل</div>
                <div className="font-bold">{previewCN.client_name}</div>
              </div>
              <div>
                <div className="text-slate-400">Reason / السبب</div>
                <div className="font-bold">{previewCN.reason}</div>
              </div>
            </div>

            <table className="w-full text-xs border border-slate-200">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-2 text-left">Returned Item / البيان</th>
                  <th className="p-2 text-right">Qty / الكمية</th>
                  <th className="p-2 text-right">Unit Price / السعر</th>
                  <th className="p-2 text-right">Credit Total / الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(previewCN.items || []).map((it, idx) => (
                  <tr key={idx}>
                    <td className="p-2">{it.desc}</td>
                    <td className="p-2 text-right">{it.qty}</td>
                    <td className="p-2 text-right">{formatSAR(it.unitSellSar)}</td>
                    <td className="p-2 text-right font-semibold">{formatSAR(Number(it.qty) * Number(it.unitSellSar))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="ml-auto max-w-xs space-y-1 text-xs">
              <div className="flex justify-between">
                <span>Subtotal Credited:</span>
                <span className="font-semibold">SAR {formatSAR(previewCN.subtotal_sar)}</span>
              </div>
              <div className="flex justify-between">
                <span>VAT Reversed (15%):</span>
                <span className="font-semibold">SAR {formatSAR(previewCN.vat_sar)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-rose-700 pt-1.5 border-t">
                <span>Total Credit Incl. VAT:</span>
                <span>- SAR {formatSAR(previewCN.grand_total_sar)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      <DebitNotesPanel supabase={supabase} company={company} invoices={invoices} debitNotes={debitNotes} canCreate={canDebit && !readOnly} canSubmitZatca={canSubmitZatca} onRefresh={onRefresh} />
    </div>
  );
}