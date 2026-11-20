import React, { useState, useMemo } from 'react';
import { Banknote, Plus, Clock, AlertCircle, CheckCircle2, X, ArrowRightLeft } from 'lucide-react';
import { formatSAR } from './erpEngine';
import { downloadCsvFile } from './csvExport';
import { postAutoJournal } from './glEngine';

function getDaysOld(dateStr) {
  if (!dateStr) return 0;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function getBucket(days) {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export function SupplierPaymentsView({
  supabase,
  purchaseOrders,
  supplierPayments,
  profile,
  onRefresh,
}) {
  const [showModal, setShowModal] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState('');
  const [form, setForm] = useState({
    amount_fx: '',
    settlement_fx_rate: '1',
    payment_method: 'Bank TT / Wire Transfer',
    bank_reference: '',
    payment_date: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const openPOs = useMemo(
    () =>
      purchaseOrders.filter((po) => {
        const dueFx = Number(po.total_amount_fx || 0) - Number(po.paid_amount_fx || 0);
        return dueFx > 0.01 && po.payment_status !== 'paid';
      }),
    [purchaseOrders]
  );

  const selectedPO = purchaseOrders.find((p) => p.id === selectedPoId) || null;

  const handleSelectPO = (poId) => {
    setSelectedPoId(poId);
    const po = purchaseOrders.find((p) => p.id === poId);
    if (!po) return;
    const remainingFx = Math.max(0, Number(po.total_amount_fx || 0) - Number(po.paid_amount_fx || 0));
    setForm((prev) => ({
      ...prev,
      amount_fx: remainingFx.toFixed(2),
      settlement_fx_rate: String(po.fx_rate || 1),
    }));
  };

  const handleCreatePayment = async (e) => {
    e.preventDefault();
    if (!selectedPO) return;
    setSaving(true);

    try {
      const amtFx = parseFloat(form.amount_fx) || 0;
      const settleRate = parseFloat(form.settlement_fx_rate) || Number(selectedPO.fx_rate) || 1;
      const bookedRate = Number(selectedPO.fx_rate) || 1;
      if (amtFx <= 0) {
        setSaving(false);
        return;
      }

      const amtSar = Number((amtFx * settleRate).toFixed(2));
      const bookedSar = Number((amtFx * bookedRate).toFixed(2));
      const fxVarianceSar = Number((amtSar - bookedSar).toFixed(2));

      const { data: payNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'SUPPLIER_PAY' });
      const glLines = [{ account_code: '2010', account_name: '2010 - Accounts Payable (Trade Suppliers)', debit: bookedSar, credit: 0, memo: selectedPO.po_number + ' (' + selectedPO.supplier_name + ')' }, { account_code: '1020', account_name: '1020 - Al Rajhi / SNB Main Bank Account (SAR)', debit: 0, credit: amtSar, memo: form.payment_method + ' ' + (form.bank_reference || '') }];
      if (fxVarianceSar > 0) glLines.push({ account_code: '5130', account_name: '5130 - Bank Charges & Realized FX Gain/Loss', debit: fxVarianceSar, credit: 0, memo: 'Realized FX Loss on ' + selectedPO.currency });
      if (fxVarianceSar < 0) glLines.push({ account_code: '5130', account_name: '5130 - Bank Charges & Realized FX Gain/Loss', debit: 0, credit: Math.abs(fxVarianceSar), memo: 'Realized FX Gain on ' + selectedPO.currency });
      await postAutoJournal({ supabase, entryDate: form.payment_date, sourceModule: 'SUPPLIER_PAY', sourceDocNumber: payNum, description: 'Supplier Payment ' + payNum + ' - ' + selectedPO.supplier_name + ' (' + selectedPO.po_number + ')', postedBy: profile?.full_name || 'Finance', lines: glLines });

      await supabase.from('supplier_payments').insert({
        id: `spay-${Date.now()}`,
        voucher_number: payNum,
        po_id: selectedPO.id,
        po_number: selectedPO.po_number,
        supplier_name: selectedPO.supplier_name,
        currency: selectedPO.currency || 'SAR',
        amount_fx: amtFx,
        booked_fx_rate: bookedRate,
        settlement_fx_rate: settleRate,
        amount_sar: amtSar,
        fx_variance_sar: fxVarianceSar,
        payment_method: form.payment_method,
        bank_reference: form.bank_reference,
        payment_date: form.payment_date,
        notes: form.notes,
        recorded_by: profile?.full_name || 'Finance',
      });

      const nextPaidFx = Number((Number(selectedPO.paid_amount_fx || 0) + amtFx).toFixed(2));
      const nextPaidSar = Number((Number(selectedPO.paid_amount_sar || 0) + amtSar).toFixed(2));
      const isFullyPaid = nextPaidFx >= Number(selectedPO.total_amount_fx || 0) - 0.01;

      await supabase
        .from('purchase_orders')
        .update({
          paid_amount_fx: nextPaidFx,
          paid_amount_sar: nextPaidSar,
          payment_status: isFullyPaid ? 'paid' : 'partial',
          status: isFullyPaid ? 'paid' : selectedPO.status,
        })
        .eq('id', selectedPO.id);

      setShowModal(false);
      setSelectedPoId('');
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const totalDisbursedSar = useMemo(
    () => supplierPayments.reduce((s, p) => s + Number(p.amount_sar || 0), 0),
    [supplierPayments]
  );

  const totalFxVarianceSar = useMemo(
    () => supplierPayments.reduce((s, p) => s + Number(p.fx_variance_sar || 0), 0),
    [supplierPayments]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">Supplier Payment Vouchers (Accounts Payable)</h2>
          <p className="text-xs text-slate-500">
            Post partial or full multi-currency supplier settlements (TT / LC / Bank Transfer) with automatic SAR FX variance tracking.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Record Supplier Payment
        </button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 text-xs">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-slate-500">Total Supplier Disbursements</div>
          <div className="text-xl font-bold text-slate-900 mt-1">SAR {formatSAR(totalDisbursedSar)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-slate-500">Open Unpaid / Partial POs</div>
          <div className="text-xl font-bold text-amber-700 mt-1">{openPOs.length} Orders</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-slate-500">Realized FX Variance (SAR)</div>
          <div className={`text-xl font-bold mt-1 ${totalFxVarianceSar > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
            {totalFxVarianceSar > 0 ? `+SAR ${formatSAR(totalFxVarianceSar)} (Loss)` : `SAR ${formatSAR(Math.abs(totalFxVarianceSar))} (Gain)`}
          </div>
        </div>
      </div>

      {supplierPayments.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          No Supplier Payment Vouchers recorded yet. Click <strong>Record Supplier Payment</strong> to settle a Purchase Order.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-3">Voucher #</th>
                <th className="p-3">Date</th>
                <th className="p-3">Supplier &amp; PO Ref</th>
                <th className="p-3">Method / Bank Ref</th>
                <th className="p-3 text-right">Paid (FCY)</th>
                <th className="p-3 text-right">Settle Rate</th>
                <th className="p-3 text-right">Paid (SAR)</th>
                <th className="p-3 text-right">FX Diff (SAR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {supplierPayments.map((p) => {
                const fxDiff = Number(p.fx_variance_sar || 0);
                return (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="p-3 font-mono font-bold text-blue-700">{p.voucher_number}</td>
                    <td className="p-3 text-slate-600">{p.payment_date}</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-900">{p.supplier_name}</div>
                      <div className="text-[11px] font-mono text-slate-500">{p.po_number}</div>
                    </td>
                    <td className="p-3">
                      <div>{p.payment_method}</div>
                      <div className="text-[11px] text-slate-400">{p.bank_reference || '—'}</div>
                    </td>
                    <td className="p-3 text-right font-mono font-bold">
                      {p.currency} {formatSAR(p.amount_fx)}
                    </td>
                    <td className="p-3 text-right font-mono">{Number(p.settlement_fx_rate).toFixed(4)}</td>
                    <td className="p-3 text-right font-bold text-slate-900">SAR {formatSAR(p.amount_sar)}</td>
                    <td className={`p-3 text-right font-semibold ${fxDiff > 0 ? 'text-rose-600' : fxDiff < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {fxDiff === 0 ? '0.00' : `${fxDiff > 0 ? '+' : ''}${formatSAR(fxDiff)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL: RECORD SUPPLIER PAYMENT VOUCHER */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Banknote className="w-4 h-4 text-blue-600" /> Record Supplier Payment Voucher
              </h3>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleCreatePayment} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select Open Purchase Order *</label>
                <select
                  required
                  value={selectedPoId}
                  onChange={(e) => handleSelectPO(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 bg-white font-semibold"
                >
                  <option value="">Choose Unpaid / Partial PO...</option>
                  {openPOs.map((po) => {
                    const remFx = Math.max(0, Number(po.total_amount_fx || 0) - Number(po.paid_amount_fx || 0));
                    return (
                      <option key={po.id} value={po.id}>
                        {po.po_number} — {po.supplier_name} (Due: {po.currency} {formatSAR(remFx)})
                      </option>
                    );
                  })}
                </select>
              </div>

              {selectedPO && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">PO Total ({selectedPO.currency}):</span>
                    <span className="font-bold">{selectedPO.currency} {formatSAR(selectedPO.total_amount_fx)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Booked PO FX Rate:</span>
                    <span className="font-mono font-bold">{selectedPO.fx_rate} SAR</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Amount ({selectedPO?.currency || 'FCY'}) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={form.amount_fx}
                    onChange={(e) => setForm({ ...form, amount_fx: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Bank Settlement FX Rate *</label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    required
                    value={form.settlement_fx_rate}
                    onChange={(e) => setForm({ ...form, settlement_fx_rate: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 font-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payment Method *</label>
                  <select
                    value={form.payment_method}
                    onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 bg-white"
                  >
                    <option value="Bank TT / Wire Transfer">Bank TT / Wire Transfer</option>
                    <option value="Letter of Credit (LC)">Letter of Credit (LC)</option>
                    <option value="SAR Local Bank Transfer">SAR Local Bank Transfer</option>
                    <option value="Corporate Card / Cheque">Corporate Card / Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payment Date *</label>
                  <input
                    type="date"
                    required
                    value={form.payment_date}
                    onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5"
                  />
                </div>
              </div>

              <input
                type="text"
                placeholder="SWIFT / Bank Reference No."
                value={form.bank_reference}
                onChange={(e) => setForm({ ...form, bank_reference: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5"
              />
              <input
                type="text"
                placeholder="Remarks / Remittance Note"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5"
              />

              <button
                type="submit"
                disabled={saving || !selectedPO}
                className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer"
              >
                {saving ? 'Posting Payment Voucher...' : 'Post Supplier Payment Voucher'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function AgingReportView({ invoices, purchaseOrders }) {
  const [ledgerSide, setLedgerSide] = useState('ar'); // ar | ap

  const arRows = useMemo(() => {
    return invoices
      .map((inv) => {
        const balance = Math.max(0, Number(inv.grand_total_sar || 0) - Number(inv.paid_amount_sar || 0));
        const days = getDaysOld(inv.issued_at || inv.created_at);
        return {
          docNum: inv.invoice_number,
          party: inv.client_name,
          date: inv.issued_at || inv.created_at,
          days,
          bucket: getBucket(days),
          totalSar: Number(inv.grand_total_sar || 0),
          paidSar: Number(inv.paid_amount_sar || 0),
          balanceSar: balance,
        };
      })
      .filter((r) => r.balanceSar > 0.01);
  }, [invoices]);

  const apRows = useMemo(() => {
    return purchaseOrders
      .map((po) => {
        const totalSar = Number(po.total_landed_sar || 0);
        const paidSar = Number(po.paid_amount_sar || 0);
        const balance = Math.max(0, totalSar - paidSar);
        const days = getDaysOld(po.created_at);
        return {
          docNum: po.po_number,
          party: po.supplier_name,
          date: po.created_at,
          days,
          bucket: getBucket(days),
          totalSar,
          paidSar,
          balanceSar: balance,
        };
      })
      .filter((r) => r.balanceSar > 0.01 && r.totalSar > 0);
  }, [purchaseOrders]);

  const activeRows = ledgerSide === 'ar' ? arRows : apRows;

  const bucketTotals = useMemo(() => {
    const sums = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 0 };
    activeRows.forEach((r) => {
      sums[r.bucket] += r.balanceSar;
      sums.total += r.balanceSar;
    });
    return sums;
  }, [activeRows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">AR &amp; AP Aging Schedule (Cash Flow Overdue Analysis)</h2>
          <p className="text-xs text-slate-500">
            Track open Customer Receivables and Supplier Payables across 0–30, 31–60, 61–90, and 90+ day aging buckets.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setLedgerSide('ar')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${
              ledgerSide === 'ar' ? 'bg-emerald-700 text-white' : 'bg-white border border-slate-200 text-slate-700'
            }`}
          >
            Accounts Receivable (AR) ({arRows.length})
          </button>
          <button
            onClick={() => setLedgerSide('ap')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${
              ledgerSide === 'ap' ? 'bg-amber-700 text-white' : 'bg-white border border-slate-200 text-slate-700'
            }`}
          >
            Accounts Payable (AP) ({apRows.length})</button>
          <button onClick={() => downloadCsvFile(${ledgerSide.toUpperCase()}_Aging_Report_.csv, ['Document #', ledgerSide === 'ar' ? 'Customer' : 'Supplier', 'Age (Days)', 'Aging Bucket', 'Original (SAR)', 'Settled (SAR)', 'Open Balance (SAR)'], activeRows.map((r) => [r.docNum, r.party, r.days, r.bucket + ' Days', r.totalSar.toFixed(2), r.paidSar.toFixed(2), r.balanceSar.toFixed(2)]))} className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer">Export Excel / CSV</button>
        </div>
      </div>

      {/* 4 Aging Bucket Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-slate-500">Current (0–30 Days)</div>
          <div className="text-base sm:text-lg font-bold text-slate-900 mt-1">SAR {formatSAR(bucketTotals['0-30'])}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-slate-500">31–60 Days</div>
          <div className="text-base sm:text-lg font-bold text-blue-700 mt-1">SAR {formatSAR(bucketTotals['31-60'])}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-slate-500">61–90 Days</div>
          <div className="text-base sm:text-lg font-bold text-amber-600 mt-1">SAR {formatSAR(bucketTotals['61-90'])}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-slate-500">Overdue 90+ Days</div>
          <div className="text-base sm:text-lg font-bold text-rose-600 mt-1">SAR {formatSAR(bucketTotals['90+'])}</div>
        </div>
        <div className="bg-slate-900 text-white rounded-2xl p-4 col-span-2 lg:col-span-1">
          <div className="text-slate-300">Total Open {ledgerSide.toUpperCase()}</div>
          <div className="text-base sm:text-lg font-bold mt-1">SAR {formatSAR(bucketTotals.total)}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
        {activeRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Zero open balances in {ledgerSide === 'ar' ? 'Accounts Receivable' : 'Accounts Payable'}.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-3">Document #</th>
                <th className="p-3">{ledgerSide === 'ar' ? 'Customer' : 'Supplier'}</th>
                <th className="p-3 text-center">Age (Days)</th>
                <th className="p-3 text-center">Aging Bucket</th>
                <th className="p-3 text-right">Original (SAR)</th>
                <th className="p-3 text-right">Settled (SAR)</th>
                <th className="p-3 text-right">Open Balance (SAR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeRows.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50/70">
                  <td className="p-3 font-mono font-bold text-blue-700">{row.docNum}</td>
                  <td className="p-3 font-bold text-slate-900">{row.party}</td>
                  <td className="p-3 text-center font-mono">{row.days}d</td>
                  <td className="p-3 text-center">
                    <span
                      className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                        row.bucket === '90+'
                          ? 'bg-rose-100 text-rose-800'
                          : row.bucket === '61-90'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {row.bucket} Days
                    </span>
                  </td>
                  <td className="p-3 text-right">SAR {formatSAR(row.totalSar)}</td>
                  <td className="p-3 text-right text-emerald-700">SAR {formatSAR(row.paidSar)}</td>
                  <td className="p-3 text-right font-bold text-slate-900">SAR {formatSAR(row.balanceSar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}