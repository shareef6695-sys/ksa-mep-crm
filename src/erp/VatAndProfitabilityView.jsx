import React, { useState, useMemo } from 'react';
import { FileSpreadsheet, Printer, TrendingUp, ShieldCheck } from 'lucide-react';
import { formatSAR } from './erpEngine';

function getQuarterKey(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const yr = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${yr}-Q${q}`;
}

export function ZatcaVatReturnView({ company, invoices, creditNotes, purchaseOrders }) {
  const currentQ = getQuarterKey(new Date().toISOString());
  const [selectedPeriod, setSelectedPeriod] = useState('ALL');

  const availableQuarters = useMemo(() => {
    const set = new Set([currentQ]);
    invoices.forEach((i) => set.add(getQuarterKey(i.issued_at || i.created_at)));
    creditNotes.forEach((c) => set.add(getQuarterKey(c.issued_at)));
    purchaseOrders.forEach((p) => set.add(getQuarterKey(p.created_at)));
    return Array.from(set).sort().reverse();
  }, [invoices, creditNotes, purchaseOrders, currentQ]);

  const vatSummary = useMemo(() => {
    const matchPeriod = (dt) => selectedPeriod === 'ALL' || getQuarterKey(dt) === selectedPeriod;

    const filtInv = invoices.filter((i) => matchPeriod(i.issued_at || i.created_at));
    const filtCN = creditNotes.filter((c) => matchPeriod(c.issued_at));
    const filtPO = purchaseOrders.filter((p) => matchPeriod(p.created_at));

    // Note: invoices.grand_total_sar was reduced when credit notes posted, so reconstruct gross + net cleanly
    const cnBase = filtCN.reduce((s, c) => s + Number(c.subtotal_sar || 0), 0);
    const cnVat = filtCN.reduce((s, c) => s + Number(c.vat_sar || 0), 0);

    const netSalesVat = filtInv.reduce((s, i) => s + Number(i.vat_sar || 0), 0);
    const netSalesBase = filtInv.reduce((s, i) => s + Number(i.subtotal_sar || 0), 0);

    const grossSalesBase = netSalesBase + cnBase;
    const grossSalesVat = netSalesVat + cnVat;

    const recoverablePurchaseBase = filtPO
      .filter((p) => p.is_ksa_vat_recoverable !== false && Number(p.input_vat_sar || 0) > 0)
      .reduce((s, p) => s + Number(p.total_landed_sar || 0), 0);

    const inputVatRecoverable = filtPO
      .filter((p) => p.is_ksa_vat_recoverable !== false)
      .reduce((s, p) => s + Number(p.input_vat_sar || 0), 0);

    const netVatPayable = Number((netSalesVat - inputVatRecoverable).toFixed(2));

    return {
      grossSalesBase,
      grossSalesVat,
      cnBase,
      cnVat,
      netSalesBase,
      netSalesVat,
      recoverablePurchaseBase,
      inputVatRecoverable,
      netVatPayable,
      invCount: filtInv.length,
      cnCount: filtCN.length,
      poCount: filtPO.length,
    };
  }, [invoices, creditNotes, purchaseOrders, selectedPeriod]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">
            ZATCA Quarterly VAT Return Worksheet • إقرار ضريبة القيمة المضافة
          </h2>
          <p className="text-xs text-slate-500">
            Reconciles 15% Standard Output VAT, ZATCA Credit Note Adjustments, and Recoverable Input VAT for Fatoora / ZATCA filing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold bg-white"
          >
            <option value="ALL">All Periods (Cumulative YTD)</option>
            {availableQuarters.map((q) => (
              <option key={q} value={q}>Tax Period: {q}</option>
            ))}
          </select>

          <button
            onClick={() => window.print()}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-blue-600 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-4 h-4" /> Print VAT Return
          </button>
        </div>
      </div>

      {/* ZATCA Official Return Box Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="bg-slate-900 text-white px-5 py-3.5 flex flex-wrap justify-between items-center gap-2 text-xs">
          <div>
            <span className="font-bold">{company.nameEn}</span> • VAT TIN: <span className="font-mono">{company.vatNumber}</span>
          </div>
          <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
            Period: {selectedPeriod === 'ALL' ? 'Cumulative All Quarters' : selectedPeriod}
          </span>
        </div>

        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="p-3.5">ZATCA Return Line Item</th>
              <th className="p-3.5 text-right">Taxable Amount (SAR)</th>
              <th className="p-3.5 text-right">Adjustment (SAR)</th>
              <th className="p-3.5 text-right">VAT Amount 15% (SAR)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="p-3.5">
                <div className="font-bold text-slate-900">1. Standard-Rated Sales (15%)</div>
                <div className="text-[11px] text-slate-500">Posted ZATCA Tax Invoices ({vatSummary.invCount} invoices)</div>
              </td>
              <td className="p-3.5 text-right font-mono font-semibold">{formatSAR(vatSummary.grossSalesBase)}</td>
              <td className="p-3.5 text-right font-mono text-rose-600">-{formatSAR(vatSummary.cnBase)}</td>
              <td className="p-3.5 text-right font-mono font-bold text-slate-900">{formatSAR(vatSummary.grossSalesVat)}</td>
            </tr>
            <tr>
              <td className="p-3.5">
                <div className="font-bold text-rose-700">2. Less: ZATCA Credit Notes / Sales Returns</div>
                <div className="text-[11px] text-slate-500">Issued e-Credit Notes ({vatSummary.cnCount} credit notes)</div>
              </td>
              <td className="p-3.5 text-right font-mono text-rose-700">-{formatSAR(vatSummary.cnBase)}</td>
              <td className="p-3.5 text-right font-mono">0.00</td>
              <td className="p-3.5 text-right font-mono font-bold text-rose-700">-{formatSAR(vatSummary.cnVat)}</td>
            </tr>
            <tr className="bg-blue-50/40 font-bold">
              <td className="p-3.5 text-blue-900">3. Total Output VAT Due (Net Sales VAT)</td>
              <td className="p-3.5 text-right font-mono text-blue-900">{formatSAR(vatSummary.netSalesBase)}</td>
              <td className="p-3.5 text-right font-mono">—</td>
              <td className="p-3.5 text-right font-mono text-blue-900">{formatSAR(vatSummary.netSalesVat)}</td>
            </tr>
            <tr>
              <td className="p-3.5">
                <div className="font-bold text-slate-900">4. Standard-Rated Domestic &amp; Customs Purchases (15%)</div>
                <div className="text-[11px] text-slate-500">Recoverable Input VAT from Purchase Orders ({vatSummary.poCount} POs)</div>
              </td>
              <td className="p-3.5 text-right font-mono font-semibold">{formatSAR(vatSummary.recoverablePurchaseBase)}</td>
              <td className="p-3.5 text-right font-mono">0.00</td>
              <td className="p-3.5 text-right font-mono font-bold text-emerald-700">-{formatSAR(vatSummary.inputVatRecoverable)}</td>
            </tr>
            <tr className="bg-slate-900 text-white text-sm">
              <td className="p-4 font-bold" colSpan={3}>
                5. NET VAT PAYABLE TO ZATCA (OR CARRIED FORWARD IF NEGATIVE)
              </td>
              <td className="p-4 text-right font-mono font-bold text-emerald-400">
                SAR {formatSAR(vatSummary.netVatPayable)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DealProfitabilityView({ invoices, creditNotes, commissions, supplierPayments }) {
  const dealRows = useMemo(() => {
    return invoices.map((inv) => {
      const linkedCNs = creditNotes.filter((c) => c.original_invoice_id === inv.id);
      const cnSubtotal = linkedCNs.reduce((s, c) => s + Number(c.subtotal_sar || 0), 0);
      const cnCost = linkedCNs.reduce((s, c) => s + Number(c.landed_cost_reversed_sar || 0), 0);

      const netRevenueSar = Number(inv.subtotal_sar || 0);
      const grossCostSar = (inv.items || []).reduce(
        (s, it) => s + (Number(it.qty) || 0) * (Number(it.unitCostSar) || 0),
        0
      );
      const netCostSar = Math.max(0, grossCostSar - cnCost);

      const comm = commissions.find((c) => c.invoice_id === inv.id);
      const commissionSar = Number(comm?.total_eligible_commission_sar || 0);

      const grossProfitSar = netRevenueSar - netCostSar;
      const netProfitAfterCommSar = grossProfitSar - commissionSar;
      const marginPct = netRevenueSar > 0 ? (netProfitAfterCommSar / netRevenueSar) * 100 : 0;

      return {
        invoiceNumber: inv.invoice_number,
        soNumber: inv.so_number || 'Direct',
        clientName: inv.client_name,
        salesman: comm?.salesman_name || 'House Account',
        netRevenueSar,
        netCostSar,
        commissionSar,
        netProfitAfterCommSar,
        marginPct,
        hasReturns: cnSubtotal > 0,
      };
    });
  }, [invoices, creditNotes, commissions]);

  const totals = useMemo(() => {
    const rev = dealRows.reduce((s, r) => s + r.netRevenueSar, 0);
    const cost = dealRows.reduce((s, r) => s + r.netCostSar, 0);
    const comm = dealRows.reduce((s, r) => s + r.commissionSar, 0);
    const fxLoss = supplierPayments.reduce((s, p) => s + Number(p.fx_variance_sar || 0), 0);
    const net = rev - cost - comm - fxLoss;
    return { rev, cost, comm, fxLoss, net };
  }, [dealRows, supplierPayments]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base sm:text-lg font-bold text-slate-900">Deal &amp; Sales Order Profitability P&amp;L Report</h2>
        <p className="text-xs text-slate-500">
          True net margin per transaction after deducting COGS, Credit Note returns, Salesman Profit Share, and realized FX variance.
        </p>
      </div>

      {/* Executive P&L Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-slate-500">Net Invoiced Revenue</div>
          <div className="text-base sm:text-lg font-bold text-slate-900 mt-1">SAR {formatSAR(totals.rev)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-slate-500">Landed COGS</div>
          <div className="text-base sm:text-lg font-bold text-amber-700 mt-1">SAR {formatSAR(totals.cost)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-slate-500">Sales Profit Share</div>
          <div className="text-base sm:text-lg font-bold text-blue-700 mt-1">SAR {formatSAR(totals.comm)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-slate-500">Realized FX Diff</div>
          <div className="text-base sm:text-lg font-bold text-slate-700 mt-1">SAR {formatSAR(totals.fxLoss)}</div>
        </div>
        <div className="bg-emerald-900 text-white rounded-2xl p-4 col-span-2 lg:col-span-1">
          <div className="text-emerald-200">Net Company Profit</div>
          <div className="text-base sm:text-lg font-bold mt-1">SAR {formatSAR(totals.net)}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
        {dealRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No posted ZATCA Invoices yet. Deal profitability updates live as invoices, credit notes, and supplier payments post.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-3">Invoice / SO</th>
                <th className="p-3">Customer &amp; Salesman</th>
                <th className="p-3 text-right">Net Revenue</th>
                <th className="p-3 text-right">Landed COGS</th>
                <th className="p-3 text-right">Sales Share</th>
                <th className="p-3 text-right">Net Profit (SAR)</th>
                <th className="p-3 text-right">Net Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dealRows.map((r, i) => (
                <tr key={i} className="hover:bg-slate-50/70">
                  <td className="p-3">
                    <div className="font-mono font-bold text-blue-700">{r.invoiceNumber}</div>
                    <div className="text-[11px] font-mono text-slate-400">{r.soNumber}</div>
                  </td>
                  <td className="p-3">
                    <div className="font-bold text-slate-900">{r.clientName}</div>
                    <div className="text-[11px] text-slate-500">{r.salesman}</div>
                  </td>
                  <td className="p-3 text-right font-semibold">SAR {formatSAR(r.netRevenueSar)}</td>
                  <td className="p-3 text-right text-slate-600">SAR {formatSAR(r.netCostSar)}</td>
                  <td className="p-3 text-right text-blue-700">SAR {formatSAR(r.commissionSar)}</td>
                  <td className={`p-3 text-right font-bold ${r.netProfitAfterCommSar >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                    SAR {formatSAR(r.netProfitAfterCommSar)}
                  </td>
                  <td className="p-3 text-right">
                    <span
                      className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                        r.marginPct >= 15
                          ? 'bg-emerald-50 text-emerald-700'
                          : r.marginPct >= 5
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {r.marginPct.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}