import React, { useState } from 'react';
import { RotateCcw, QrCode, Printer, X, Plus } from 'lucide-react';
import { generateZatcaQrBase64, formatSAR } from './erpEngine';
import { postAutoJournal } from './glEngine';
import { ShareDocumentButtons } from './shareDispatch';

export function CreditNotesView({
  supabase,
  company,
  invoices,
  creditNotes,
  commissions,
  profile,
  onRefresh,
}) {
  const [showModal, setShowModal] = useState(false);
  const [selectedInvId, setSelectedInvId] = useState('');
  const [reason, setReason] = useState('Sales Return / Defective Material');
  const [returnQtys, setReturnQtys] = useState({});
  const [previewCN, setPreviewCN] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedInvoice = invoices.find((i) => i.id === selectedInvId) || null;

  const handleSelectInvoice = (invId) => {
    setSelectedInvId(invId);
    const inv = invoices.find((i) => i.id === invId);
    if (!inv) {
      setReturnQtys({});
      return;
    }
    const init = {};
    (inv.items || []).forEach((it, idx) => {
      init[idx] = Number(it.qty) || 0;
    });
    setReturnQtys(init);
  };

  const handleIssueCreditNote = async (e) => {
    e.preventDefault();
    if (!selectedInvoice) return;
    setSubmitting(true);

    try {
      const returnedLines = [];
      let subtotal = 0;
      let costReversed = 0;

      (selectedInvoice.items || []).forEach((it, idx) => {
        const retQty = Math.min(Number(it.qty) || 0, Math.max(0, Number(returnQtys[idx]) || 0));
        if (retQty > 0) {
          returnedLines.push({
            desc: it.desc,
            qty: retQty,
            unit: it.unit || 'PCS',
            unitSellSar: Number(it.unitSellSar) || 0,
            unitCostSar: Number(it.unitCostSar) || 0,
          });
          subtotal += retQty * (Number(it.unitSellSar) || 0);
          costReversed += retQty * (Number(it.unitCostSar) || 0);
        }
      });

      if (returnedLines.length === 0 || subtotal <= 0) {
        setSubmitting(false);
        return;
      }

      const vat = subtotal * 0.15;
      const grandTotal = subtotal + vat;
      const { data: cnNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'CREDIT_NOTE' });
      const issuedIso = new Date().toISOString();

      const qrBase64 = generateZatcaQrBase64({
        sellerName: company.nameEn,
        vatNumber: company.vatNumber,
        timestampIso: issuedIso,
        totalWithVat: grandTotal,
        vatAmount: vat,
      });

      const newCN = {
        id: `cn-${Date.now()}`,
        credit_note_number: cnNum,
        original_invoice_id: selectedInvoice.id,
        original_invoice_number: selectedInvoice.invoice_number,
        client_name: selectedInvoice.client_name,
        client_vat: selectedInvoice.client_vat || '',
        reason,
        items: returnedLines,
        subtotal_sar: Number(subtotal.toFixed(2)),
        vat_sar: Number(vat.toFixed(2)),
        grand_total_sar: Number(grandTotal.toFixed(2)),
        landed_cost_reversed_sar: Number(costReversed.toFixed(2)),
        qr_base64: qrBase64,
        issued_by: profile?.full_name || 'Finance',
        issued_at: issuedIso,
      };

      const { data: insertedCN } = await supabase.from('credit_notes').insert(newCN).select().single();
      await postAutoJournal({ supabase, entryDate: issuedIso.slice(0, 10), sourceModule: 'CREDIT_NOTE', sourceDocNumber: cnNum, description: 'ZATCA Credit Note ' + cnNum + ' vs ' + selectedInvoice.invoice_number + ' (' + selectedInvoice.client_name + ')', postedBy: profile?.full_name || 'Finance', lines: [{ account_code: '4090', account_name: '4090 - Sales Returns & Credit Notes', debit: subtotal, credit: 0, memo: reason }, { account_code: '2100', account_name: '2100 - VAT Payable / Output VAT (15%)', debit: vat, credit: 0, memo: 'VAT Reversal 15%' }, { account_code: '1100', account_name: '1100 - Accounts Receivable (Trade Customers)', debit: 0, credit: grandTotal, memo: selectedInvoice.client_name }, { account_code: '1200', account_name: '1200 - Inventory / Warehouse Stock Asset', debit: costReversed, credit: 0, memo: 'Stock Return Valuation' }, { account_code: '5010', account_name: '5010 - Cost of Goods Sold (Landed COGS)', debit: 0, credit: costReversed, memo: 'COGS Reversal' }] });

      // 1. Reduce Original Invoice Payable Balance
      const revisedInvTotal = Math.max(0, Number(selectedInvoice.grand_total_sar) - grandTotal);
      const paidSoFar = Number(selectedInvoice.paid_amount_sar || 0);
      const nextPayStatus =
        revisedInvTotal <= 0.01 || paidSoFar >= revisedInvTotal - 0.01
          ? 'paid'
          : paidSoFar > 0
          ? 'partial'
          : 'unpaid';

      await supabase
        .from('invoices')
        .update({
          grand_total_sar: Number(revisedInvTotal.toFixed(2)),
          payment_status: nextPayStatus,
        })
        .eq('id', selectedInvoice.id);

      // 2. Claw back proportional Salesman Net Profit Share
      const commRow = commissions.find((c) => c.invoice_id === selectedInvoice.id);
      if (commRow) {
        const profitReturned = Math.max(0, subtotal - costReversed);
        const revisedNetProfit = Math.max(0, Number(commRow.net_profit_sar) - profitReturned);
        const revisedEligible = Number(((revisedNetProfit * Number(commRow.commission_pct)) / 100).toFixed(2));
        const collectionRatio = revisedInvTotal > 0 ? Math.min(1, paidSoFar / revisedInvTotal) : 0;
        const revisedUnlocked = Number((revisedEligible * collectionRatio).toFixed(2));

        await supabase
          .from('commission_ledger')
          .update({
            net_profit_sar: Number(revisedNetProfit.toFixed(2)),
            total_eligible_commission_sar: revisedEligible,
            unlocked_commission_sar: revisedUnlocked,
            status:
              revisedEligible <= 0
                ? 'reversed_by_credit_note'
                : collectionRatio >= 0.999
                ? 'ready_for_payout'
                : revisedUnlocked > 0
                ? 'partially_unlocked'
                : 'awaiting_collection',
            updated_at: issuedIso,
          })
          .eq('id', commRow.id);
      }

      setShowModal(false);
      setSelectedInvId('');
      if (insertedCN) setPreviewCN(insertedCN);
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
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    ZATCA TLV QR
                  </span>
                </div>
                <h3 className="text-base font-bold mt-1">{cn.client_name}</h3>
                <p className="text-xs text-slate-500">
                  Reason: <strong>{cn.reason}</strong> • Reversed Total: <strong className="text-rose-700">- SAR {formatSAR(cn.grand_total_sar)}</strong>
                </p>
              </div>

              <ShareDocumentButtons company={company} docType="ZATCA Credit Note" docNumber={cn.credit_note_number} clientName={cn.client_name} totalSar={cn.grand_total_sar} compact /> <button onClick={() => setPreviewCN(cn)}
                className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5 cursor-pointer self-start sm:self-center"
              >
                <QrCode className="w-4 h-4" /> View ZATCA Credit Note
              </button>
            </div>
          ))}
        </div>
      )}

      {/* MODAL: ISSUE ZATCA CREDIT NOTE */}
      {showModal && (
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
                  {invoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_number} — {inv.client_name} (SAR {formatSAR(inv.grand_total_sar)})
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
                  <option value="Sales Return / Defective Material">Sales Return / Defective Material</option>
                  <option value="Post-Invoice Commercial Discount">Post-Invoice Commercial Discount</option>
                  <option value="Quantity / Billing Correction">Quantity / Billing Correction</option>
                  <option value="Cancelled Scope / Partial Cancellation">Cancelled Scope / Partial Cancellation</option>
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
                        </div>
                      </div>
                      <input
                        type="number"
                        min="0"
                        max={it.qty}
                        step="any"
                        value={returnQtys[idx] ?? 0}
                        onChange={(e) => setReturnQtys({ ...returnQtys, [idx]: e.target.value })}
                        className="w-20 border border-slate-300 rounded-lg px-2.5 py-1.5 text-right font-bold bg-white"
                      />
                    </div>
                  ))}
                </div>
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
                <div className="text-lg font-bold text-slate-900">{company?.logoUrl && (<img src={company.logoUrl} alt="Company Logo" className="h-12 max-w-[160px] object-contain mb-1.5" />)}`n                  {company.nameEn}</div>
                <div className="text-sm font-bold text-blue-700">{company.nameAr}</div>
                <div className="font-mono font-semibold">VAT Reg / الرقم الضريبي: {company.vatNumber}</div>
                <div className="text-rose-700 font-semibold">Original Invoice Ref: {previewCN.original_invoice_number}</div>
              </div>
              <div className="text-center shrink-0">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(previewCN.qr_base64)}`}
                  alt="ZATCA Credit Note QR"
                  className="w-28 h-28 border border-slate-200 rounded-lg p-1 mx-auto"
                />
                <div className="text-[10px] text-slate-500 mt-1 font-mono">ZATCA TLV QR</div>
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
    </div>
  );
}