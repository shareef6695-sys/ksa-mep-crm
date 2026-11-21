import React, { useMemo } from 'react';
import {
  TrendingUp,
  Landmark,
  Package,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  AlertTriangle,
  FileSpreadsheet,
  Scale,
  Plus,
} from 'lucide-react';
import { formatSAR } from './erpEngine';

function getDaysOld(dateStr) {
  if (!dateStr) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)));
}

export function ExecutiveDashboardView({
  company,
  profile,
  inquiries,
  salesOrders,
  invoices,
  creditNotes,
  purchaseOrders,
  receipts,
  supplierPayments,
  items,
  commissions,
  glEntries,
  onNavigate,
}) {
  const kpis = useMemo(() => {
    // 1. Net Revenue, COGS & Net Margin
    const netRevenueSar = invoices.reduce((s, i) => s + Number(i.subtotal_sar || 0), 0);
    const totalVatOutputSar = invoices.reduce((s, i) => s + Number(i.vat_sar || 0), 0);

    const cnCostReversed = creditNotes.reduce((s, c) => s + Number(c.landed_cost_reversed_sar || 0), 0);
    const grossCogsSar = invoices.reduce(
      (s, inv) =>
        s +
        (inv.items || []).reduce(
          (ls, it) => ls + (Number(it.qty) || 0) * (Number(it.unitCostSar) || 0),
          0
        ),
      0
    );
    const netCogsSar = Math.max(0, grossCogsSar - cnCostReversed);
    const totalCommSar = commissions.reduce(
      (s, c) => s + Number(c.total_eligible_commission_sar || 0),
      0
    );
    const realizedFxDiffSar = supplierPayments.reduce(
      (s, p) => s + Number(p.fx_variance_sar || 0),
      0
    );

    // Include Manual GL Operating Expenses (51xx+) if posted
    let glOpexSar = 0;
    let glCashDr = 0;
    let glCashCr = 0;
    glEntries.forEach((entry) => {
      (entry.lines || []).forEach((l) => {
        const code = String(l.account_code || '');
        const dr = Number(l.debit || 0);
        const cr = Number(l.credit || 0);
        // All cash, bank & petty-cash accounts (1010–1099)
        if (code.length === 4 && code >= '1010' && code <= '1099') {
          glCashDr += dr;
          glCashCr += cr;
        }
        // Operating expenses 51xx–59xx (salaries, rent, depreciation, ...). COGS (50xx), FX (5130)
        // and commissions (5140/5280) are excluded because they are subtracted separately above.
        if (code.startsWith('5') && !code.startsWith('50') && !['5130', '5140', '5280'].includes(code)) {
          glOpexSar += dr - cr;
        }
      });
    });

    const netProfitSar = netRevenueSar - netCogsSar - totalCommSar - realizedFxDiffSar - glOpexSar;
    const netMarginPct = netRevenueSar > 0 ? (netProfitSar / netRevenueSar) * 100 : 0;

    // 2. Bank & Cash Position (Use GL 1010/1020 balance if entries exist, else sub-ledger net cash)
    const subLedgerCash =
      receipts.reduce((s, r) => s + Number(r.amount_sar || 0), 0) -
      supplierPayments.reduce((s, p) => s + Number(p.amount_sar || 0), 0);
    const bankCashSar = glEntries.length > 0 ? glCashDr - glCashCr : subLedgerCash;

    // 3. Warehouse Inventory Valuation (WAC)
    const goodsItems = items.filter((i) => i.item_type === 'Goods');
    const inventoryValueSar = goodsItems.reduce(
      (s, it) =>
        s + Number(it.stock_on_hand || 0) * Number(it.avg_cost_sar || it.purchase_price || 0),
      0
    );
    const lowStockCount = goodsItems.filter((it) => Number(it.stock_on_hand || 0) <= 0).length;

    // 4. Net VAT Payable
    const recoverableInputVatSar = purchaseOrders
      .filter((p) => p.is_ksa_vat_recoverable !== false)
      .reduce((s, p) => s + Number(p.input_vat_sar || 0), 0);
    const netVatPayableSar = totalVatOutputSar - recoverableInputVatSar;

    // 5. MEP vs IT Division Breakdown (Map SO/Inquiry division onto Invoices)
    const soDivMap = {};
    salesOrders.forEach((so) => {
      soDivMap[so.so_number] = so.division || 'MEP';
    });
    const inqDivMap = {};
    inquiries.forEach((inq) => {
      inqDivMap[inq.clientName] = inq.division || 'MEP';
    });

    let mepRev = 0;
    let itRev = 0;
    invoices.forEach((inv) => {
      const div =
        inv.division ||
        soDivMap[inv.so_number] ||
        inqDivMap[inv.client_name] ||
        'MEP';
      if (String(div).toUpperCase().includes('IT')) itRev += Number(inv.subtotal_sar || 0);
      else mepRev += Number(inv.subtotal_sar || 0);
    });

    const mepInquiries = inquiries.filter((i) => !String(i.division || '').toUpperCase().includes('IT')).length;
    const itInquiries = inquiries.filter((i) => String(i.division || '').toUpperCase().includes('IT')).length;

    // 6. AR & AP Aging Buckets
    const arBuckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 0 };
    invoices.forEach((inv) => {
      const open = Math.max(0, Number(inv.grand_total_sar || 0) - Number(inv.paid_amount_sar || 0));
      if (open <= 0.01) return;
      const d = getDaysOld(inv.issued_at || inv.created_at);
      const b = d <= 30 ? '0-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+';
      arBuckets[b] += open;
      arBuckets.total += open;
    });

    const apBuckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 0 };
    purchaseOrders.forEach((po) => {
      const open = Math.max(0, Number(po.total_landed_sar || 0) - Number(po.paid_amount_sar || 0));
      if (open <= 0.01) return;
      const d = getDaysOld(po.created_at);
      const b = d <= 30 ? '0-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+';
      apBuckets[b] += open;
      apBuckets.total += open;
    });

    return {
      netRevenueSar,
      netProfitSar,
      netMarginPct,
      bankCashSar,
      inventoryValueSar,
      goodsCount: goodsItems.length,
      lowStockCount,
      netVatPayableSar,
      mepRev,
      itRev,
      mepInquiries,
      itInquiries,
      arBuckets,
      apBuckets,
    };
  }, [
    inquiries,
    salesOrders,
    invoices,
    creditNotes,
    purchaseOrders,
    receipts,
    supplierPayments,
    items,
    commissions,
    glEntries,
  ]);

  const totalDivRev = Math.max(1, kpis.mepRev + kpis.itRev);
  const mepSharePct = kpis.mepRev + kpis.itRev > 0 ? (kpis.mepRev / totalDivRev) * 100 : 50;
  const itSharePct = kpis.mepRev + kpis.itRev > 0 ? (kpis.itRev / totalDivRev) * 100 : 50;

  return (
    <div className="space-y-5">
      {/* Executive Welcome & Quick Actions Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-sm">
        <div>
          <div className="text-xs font-semibold text-blue-300 uppercase tracking-wider">
            CEO Executive Command Center • {company.nameEn}
          </div>
          <h1 className="text-lg sm:text-xl font-bold mt-1">
            Welcome back, {profile?.full_name || 'Executive Director'}
          </h1>
          <p className="text-xs text-slate-300 mt-1">
            Live financial, division margin, warehouse valuation, and ZATCA VAT telemetry synced across all modules.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            onClick={() => onNavigate('1. Sales & Fulfillment', 'sales_inquiries')}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> New Sales Inquiry
          </button>
          <button
            onClick={() => onNavigate('2. Finance & Collections', 'fin_statements')}
            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Scale className="w-4 h-4 text-emerald-400" /> P&amp;L &amp; Balance Sheet
          </button>
          <button
            onClick={() => onNavigate('2. Finance & Collections', 'fin_vat_return')}
            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-amber-300" /> ZATCA VAT Return
          </button>
        </div>
      </div>

      {/* 4 Primary CEO KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div
          onClick={() => onNavigate('2. Finance & Collections', 'fin_deal_pnl')}
          className="bg-white border border-slate-200 hover:border-blue-400 rounded-2xl p-5 cursor-pointer transition shadow-sm"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Net Revenue &amp; Margin</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-2">
            SAR {formatSAR(kpis.netRevenueSar)}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-slate-500">Net Profit: SAR {formatSAR(kpis.netProfitSar)}</span>
            <span
              className={`px-2 py-0.5 rounded-full font-bold ${
                kpis.netMarginPct >= 15
                  ? 'bg-emerald-50 text-emerald-700'
                  : kpis.netMarginPct >= 0
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-rose-50 text-rose-700'
              }`}
            >
              {kpis.netMarginPct.toFixed(1)}%
            </span>
          </div>
        </div>

        <div
          onClick={() => onNavigate('2. Finance & Collections', 'fin_gl')}
          className="bg-white border border-slate-200 hover:border-blue-400 rounded-2xl p-5 cursor-pointer transition shadow-sm"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Bank &amp; Cash Position (GL)</span>
            <Landmark className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-2">
            SAR {formatSAR(kpis.bankCashSar)}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Accounts 1010 Petty Cash + 1020 Main Bank
          </div>
        </div>

        <div
          onClick={() => onNavigate('4. Items & Services Catalog', 'cat_inventory')}
          className="bg-white border border-slate-200 hover:border-blue-400 rounded-2xl p-5 cursor-pointer transition shadow-sm"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Warehouse Inventory Value</span>
            <Package className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-2">
            SAR {formatSAR(kpis.inventoryValueSar)}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-slate-500">{kpis.goodsCount} Stocked SKUs (WAC)</span>
            {kpis.lowStockCount > 0 && (
              <span className="text-amber-700 font-semibold">{kpis.lowStockCount} Zero-Stock</span>
            )}
          </div>
        </div>

        <div
          onClick={() => onNavigate('2. Finance & Collections', 'fin_vat_return')}
          className="bg-white border border-slate-200 hover:border-blue-400 rounded-2xl p-5 cursor-pointer transition shadow-sm"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Net ZATCA VAT Position</span>
            <Receipt className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 mt-2">
            SAR {formatSAR(kpis.netVatPayableSar)}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {kpis.netVatPayableSar >= 0 ? 'Net Payable to ZATCA (15%)' : 'Input VAT Credit Carryforward'}
          </div>
        </div>
      </div>

      {/* Division Revenue Split (MEP vs IT) + AR/AP Aging Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: MEP vs IT Division Performance */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" /> Division Revenue &amp; Pipeline (MEP vs. IT &amp; ELV)
              </h3>
              <p className="text-xs text-slate-500">Net invoiced revenue and active inquiry split by business unit</p>
            </div>
            <button
              onClick={() => onNavigate('1. Sales & Fulfillment', 'sales_invoices')}
              className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
            >
              View Invoices →
            </button>
          </div>

          {/* Visual Proportion Bar */}
          <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden flex">
            <div
              style={{ width: `${mepSharePct}%` }}
              className="bg-blue-600 transition-all"
              title={`MEP Division: ${mepSharePct.toFixed(1)}%`}
            />
            <div
              style={{ width: `${itSharePct}%` }}
              className="bg-emerald-500 transition-all"
              title={`IT & ELV Division: ${itSharePct.toFixed(1)}%`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-100">
              <div className="flex items-center justify-between font-bold text-blue-900">
                <span>MEP Contracting &amp; Supply</span>
                <span>{mepSharePct.toFixed(0)}%</span>
              </div>
              <div className="text-base font-bold text-slate-900 mt-1.5">
                SAR {formatSAR(kpis.mepRev)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {kpis.mepInquiries} Active RFQs / Quotes
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-100">
              <div className="flex items-center justify-between font-bold text-emerald-900">
                <span>IT &amp; ELV Solutions</span>
                <span>{itSharePct.toFixed(0)}%</span>
              </div>
              <div className="text-base font-bold text-slate-900 mt-1.5">
                SAR {formatSAR(kpis.itRev)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {kpis.itInquiries} Active RFQs / Quotes
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: AR vs AP Aging Snapshot */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Accounts Receivable (AR) vs. Accounts Payable (AP) Aging
              </h3>
              <p className="text-xs text-slate-500">Open customer collections vs. supplier commitments by overdue bucket</p>
            </div>
            <button
              onClick={() => onNavigate('2. Finance & Collections', 'fin_aging')}
              className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
            >
              Full Aging →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-2.5">Ledger</th>
                  <th className="p-2.5 text-right">0–30d</th>
                  <th className="p-2.5 text-right">31–60d</th>
                  <th className="p-2.5 text-right">61–90d</th>
                  <th className="p-2.5 text-right text-rose-600">90+d</th>
                  <th className="p-2.5 text-right font-bold">Total Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                <tr>
                  <td className="p-2.5 font-sans font-bold text-emerald-800 flex items-center gap-1">
                    <ArrowDownRight className="w-3.5 h-3.5" /> AR (Inflow)
                  </td>
                  <td className="p-2.5 text-right">{formatSAR(kpis.arBuckets['0-30'])}</td>
                  <td className="p-2.5 text-right">{formatSAR(kpis.arBuckets['31-60'])}</td>
                  <td className="p-2.5 text-right">{formatSAR(kpis.arBuckets['61-90'])}</td>
                  <td className="p-2.5 text-right text-rose-600 font-bold">{formatSAR(kpis.arBuckets['90+'])}</td>
                  <td className="p-2.5 text-right font-bold text-slate-900">
                    SAR {formatSAR(kpis.arBuckets.total)}
                  </td>
                </tr>
                <tr>
                  <td className="p-2.5 font-sans font-bold text-amber-800 flex items-center gap-1">
                    <ArrowUpRight className="w-3.5 h-3.5" /> AP (Outflow)
                  </td>
                  <td className="p-2.5 text-right">{formatSAR(kpis.apBuckets['0-30'])}</td>
                  <td className="p-2.5 text-right">{formatSAR(kpis.apBuckets['31-60'])}</td>
                  <td className="p-2.5 text-right">{formatSAR(kpis.apBuckets['61-90'])}</td>
                  <td className="p-2.5 text-right text-rose-600 font-bold">{formatSAR(kpis.apBuckets['90+'])}</td>
                  <td className="p-2.5 text-right font-bold text-slate-900">
                    SAR {formatSAR(kpis.apBuckets.total)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}