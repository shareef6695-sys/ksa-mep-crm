import React, { useState, useMemo, useEffect } from 'react';
import { Printer, CheckCircle2, AlertTriangle, FileSpreadsheet, Scale } from 'lucide-react';
import { formatSAR } from './erpEngine';
import { tr } from '../ui/financeI18n';

export function FinancialStatementsView({ company, glAccounts, glEntries, supabase }) {
  const [activeReport, setActiveReport] = useState('pnl'); // pnl | bs
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [fromDate, setFromDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [useAllDates, setUseAllDates] = useState(true);

  // Per-account totals computed in the database over every journal line (0008 gl_account_activity).
  // null = not available (migration not applied / offline): fall back to summing the loaded journals.
  const [serverActivity, setServerActivity] = useState(null);
  const [source, setSource] = useState('browser');
  useEffect(() => {
    let alive = true;
    if (!supabase) return undefined;
    supabase
      .rpc('gl_account_activity', { p_from: useAllDates ? null : fromDate || null, p_to: useAllDates ? null : asOfDate || null })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error || !Array.isArray(data)) {
          setServerActivity(null);
          setSource('browser');
        } else {
          setServerActivity(data);
          setSource('database');
        }
      });
    return () => {
      alive = false;
    };
  }, [supabase, useAllDates, fromDate, asOfDate, glEntries.length]);

  const financialModel = useMemo(() => {
    // Initialize account map from Chart of Accounts
    const accMap = {};
    glAccounts.forEach((a) => {
      accMap[a.account_code] = {
        code: a.account_code,
        nameEn: a.account_name_en,
        nameAr: a.account_name_ar || '',
        type: a.account_type,
        normal: a.normal_balance,
        periodDr: 0,
        periodCr: 0,
        cumDr: 0,
        cumCr: 0,
      };
    });

    if (serverActivity) {
      serverActivity.forEach((r) => {
        accMap[r.account_code] = {
          code: r.account_code,
          nameEn: r.account_name_en,
          nameAr: r.account_name_ar || '',
          type: r.account_type,
          normal: r.normal_balance,
          periodDr: Number(r.period_dr) || 0,
          periodCr: Number(r.period_cr) || 0,
          cumDr: Number(r.cum_dr) || 0,
          cumCr: Number(r.cum_cr) || 0,
        };
      });
    }

    (serverActivity ? [] : glEntries).forEach((entry) => {
      const dt = (entry.entry_date || '').slice(0, 10);
      const inCum = useAllDates || !asOfDate || dt <= asOfDate;
      const inPeriod =
        useAllDates ||
        ((!fromDate || dt >= fromDate) && (!asOfDate || dt <= asOfDate));

      (entry.lines || []).forEach((l) => {
        const code = String(l.account_code);
        if (!accMap[code]) {
          const prefix = code.charAt(0);
          const inferredType =
            prefix === '1'
              ? 'Asset'
              : prefix === '2'
              ? 'Liability'
              : prefix === '3'
              ? 'Equity'
              : prefix === '4'
              ? 'Revenue'
              : 'Expense';
          accMap[code] = {
            code,
            nameEn: l.account_name || code,
            nameAr: '',
            type: inferredType,
            normal: ['Asset', 'Expense'].includes(inferredType) ? 'Debit' : 'Credit',
            periodDr: 0,
            periodCr: 0,
            cumDr: 0,
            cumCr: 0,
          };
        }
        const dr = Number(l.debit || 0);
        const cr = Number(l.credit || 0);
        if (inPeriod) {
          accMap[code].periodDr += dr;
          accMap[code].periodCr += cr;
        }
        if (inCum) {
          accMap[code].cumDr += dr;
          accMap[code].cumCr += cr;
        }
      });
    });

    const all = Object.values(accMap).sort((a, b) => a.code.localeCompare(b.code));

    // --- INCOME STATEMENT (PERIOD) ---
    const revenueAccounts = all
      .filter((a) => a.type === 'Revenue')
      .map((a) => ({
        ...a,
        netCredit: Number((a.periodCr - a.periodDr).toFixed(2)), // Contra-revenue 4090 will be negative
      }))
      .filter((a) => Math.abs(a.netCredit) > 0.004 || a.code === '4010' || a.code === '4020');

    const totalNetRevenue = Number(
      revenueAccounts.reduce((s, a) => s + a.netCredit, 0).toFixed(2)
    );

    const cogsAccounts = all
      .filter((a) => a.type === 'Expense' && a.code.startsWith('50'))
      .map((a) => ({
        ...a,
        netDebit: Number((a.periodDr - a.periodCr).toFixed(2)),
      }))
      .filter((a) => Math.abs(a.netDebit) > 0.004 || a.code === '5010');

    const totalCogs = Number(
      cogsAccounts.reduce((s, a) => s + a.netDebit, 0).toFixed(2)
    );

    const grossProfit = Number((totalNetRevenue - totalCogs).toFixed(2));
    const grossMarginPct = totalNetRevenue > 0 ? (grossProfit / totalNetRevenue) * 100 : 0;

    const opexAccounts = all
      .filter((a) => a.type === 'Expense' && !a.code.startsWith('50'))
      .map((a) => ({
        ...a,
        netDebit: Number((a.periodDr - a.periodCr).toFixed(2)),
      }))
      .filter((a) => Math.abs(a.netDebit) > 0.004);

    const totalOpex = Number(
      opexAccounts.reduce((s, a) => s + a.netDebit, 0).toFixed(2)
    );

    const netIncomePeriod = Number((grossProfit - totalOpex).toFixed(2));

    // --- BALANCE SHEET (CUMULATIVE AS OF DATE) ---
    // Cumulative P&L net income to close into Equity
    const cumRevenue = all
      .filter((a) => a.type === 'Revenue')
      .reduce((s, a) => s + (a.cumCr - a.cumDr), 0);
    const cumExpense = all
      .filter((a) => a.type === 'Expense')
      .reduce((s, a) => s + (a.cumDr - a.cumCr), 0);
    const cumNetIncome = Number((cumRevenue - cumExpense).toFixed(2));

    const currentAssets = all
      .filter((a) => a.type === 'Asset' && (a.code < '1400' || a.code.startsWith('211')))
      .map((a) => ({
        ...a,
        balance: Number((a.cumDr - a.cumCr).toFixed(2)),
      }))
      .filter((a) => Math.abs(a.balance) > 0.004 || ['1020', '1100', '1200'].includes(a.code));

    const nonCurrentAssets = all
      .filter((a) => a.type === 'Asset' && a.code >= '1400' && !a.code.startsWith('211'))
      .map((a) => ({
        ...a,
        balance: Number((a.cumDr - a.cumCr).toFixed(2)),
      }))
      .filter((a) => Math.abs(a.balance) > 0.004);

    const totalCurrentAssets = Number(
      currentAssets.reduce((s, a) => s + a.balance, 0).toFixed(2)
    );
    const totalNonCurrentAssets = Number(
      nonCurrentAssets.reduce((s, a) => s + a.balance, 0).toFixed(2)
    );
    const totalAssets = Number((totalCurrentAssets + totalNonCurrentAssets).toFixed(2));

    const liabilities = all
      .filter((a) => a.type === 'Liability')
      .map((a) => ({
        ...a,
        balance: Number((a.cumCr - a.cumDr).toFixed(2)),
      }))
      .filter((a) => Math.abs(a.balance) > 0.004 || ['2010', '2100'].includes(a.code));

    const totalLiabilities = Number(
      liabilities.reduce((s, a) => s + a.balance, 0).toFixed(2)
    );

    const equityAccounts = all
      .filter((a) => a.type === 'Equity')
      .map((a) => ({
        ...a,
        balance: Number((a.cumCr - a.cumDr).toFixed(2)),
      }))
      .filter((a) => Math.abs(a.balance) > 0.004 || a.code === '3010');

    const baseEquity = Number(
      equityAccounts.reduce((s, a) => s + a.balance, 0).toFixed(2)
    );
    const totalEquity = Number((baseEquity + cumNetIncome).toFixed(2));
    const totalLiabAndEquity = Number((totalLiabilities + totalEquity).toFixed(2));
    const bsDiff = Number((totalAssets - totalLiabAndEquity).toFixed(2));

    return {
      revenueAccounts,
      totalNetRevenue,
      cogsAccounts,
      totalCogs,
      grossProfit,
      grossMarginPct,
      opexAccounts,
      totalOpex,
      netIncomePeriod,
      currentAssets,
      nonCurrentAssets,
      totalCurrentAssets,
      totalNonCurrentAssets,
      totalAssets,
      liabilities,
      totalLiabilities,
      equityAccounts,
      cumNetIncome,
      totalEquity,
      totalLiabAndEquity,
      isBsBalanced: Math.abs(bsDiff) < 0.02,
      bsDiff,
    };
  }, [glAccounts, glEntries, useAllDates, fromDate, asOfDate, serverActivity]);

  return (
    <div className="space-y-4">
      {/* Header & Controls */}<div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">
            {tr("SOCPA Financial Statements • القوائم المالية")}
          </h2>
          <p className="text-xs text-slate-500">
            {tr("Real-time Income Statement (Profit & Loss) and Statement of Financial Position (Balance Sheet) powered directly by the General Ledger.")}
            <span className="ml-1 text-[11px] text-slate-400">
              {source === 'database' ? '• Totals computed in the database over every journal line.' : '• Totals computed from the journals loaded in this browser.'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveReport('pnl')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${
              activeReport === 'pnl'
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-slate-200 text-slate-700'
            }`}
          >
            Income Statement (P&amp;L)
          </button>
          <button
            onClick={() => setActiveReport('bs')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${
              activeReport === 'bs'
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-slate-200 text-slate-700'
            }`}
          >
            Balance Sheet
          </button>
          <button
            onClick={() => window.print()}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-4 h-4" /> {tr("Print Statement")}
          </button>
        </div>
      </div>

      {/* Period Filter Strip */}<div className="no-print bg-white border border-slate-200 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
          <input
            type="checkbox"
            checked={useAllDates}
            onChange={(e) => setUseAllDates(e.target.checked)}
          />
          {tr("Include All Posted GL Entries (Cumulative YTD)")}
        </label>

        {!useAllDates && (
          <div className="flex flex-wrap items-center gap-2">
            {activeReport === 'pnl' && (
              <>
                <span className="text-slate-500 font-semibold">{tr("From:")}</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2.5 py-1"
                />
              </>
            )}
            <span className="text-slate-500 font-semibold">{tr("As of:")}</span>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="border border-slate-300 rounded-lg px-2.5 py-1"
            />
          </div>
        )}
      </div>

      {/* REPORT 1: SOCPA INCOME STATEMENT (PROFIT & LOSS) */}
      {activeReport === 'pnl' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="bg-slate-900 text-white p-5 flex flex-wrap justify-between items-start gap-4">
            <div>
              {company?.logoUrl && (<img src={company.logoUrl} alt="Company Logo" className="h-11 max-w-[160px] object-contain bg-white rounded-lg p-1 mb-2" />)}`n              <div className="text-base font-bold">{company.nameEn}</div>
              <div className="text-sm text-blue-300 font-semibold">{company.nameAr}</div>
              <div className="text-[11px] text-slate-300 mt-1 font-mono">
                {tr("VAT TIN:")}{" "}{company.vatNumber} • CR: {company.crNumber}
              </div>
            </div>
            <div className="text-start sm:text-end">
              <div className="text-sm font-bold uppercase tracking-wide text-emerald-400">
                {tr("Statement of Profit or Loss (SOCPA)")}
              </div>
              <div className="text-xs text-slate-300">قائمة الربح أو الخسارة (بالريال السعودي)</div>
              <div className="text-[11px] text-slate-400 mt-1">
                {useAllDates ? 'Cumulative All Posted Periods' : `Period: ${fromDate} to ${asOfDate}`}
              </div>
            </div>
          </div>

          <table className="w-full text-start text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-3.5">{tr("GL Code")}</th>
                <th className="p-3.5">{tr("Account Description (EN / AR)")}</th>
                <th className="p-3.5 text-end">{tr("Amount (SAR)")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {/* REVENUE SECTION */}
              <tr className="bg-slate-100/70 font-bold text-slate-800">
                <td className="p-3" colSpan={3}>{tr("REVENUE / الإيرادات التشغيلية")}</td>
              </tr>
              {financialModel.revenueAccounts.map((acc) => (
                <tr key={acc.code}>
                  <td className="p-3 font-mono text-blue-700 font-semibold">{acc.code}</td>
                  <td className="p-3">
                    <span className="font-semibold text-slate-900">{acc.nameEn}</span>
                    {acc.nameAr && <span className="text-slate-400 ml-2">({acc.nameAr})</span>}
                  </td>
                  <td className={`p-3 text-end font-mono font-semibold ${acc.netCredit < 0 ? 'text-rose-600' : ''}`}>
                    {acc.netCredit < 0 ? `(${formatSAR(Math.abs(acc.netCredit))})` : formatSAR(acc.netCredit)}
                  </td>
                </tr>
              ))}
              <tr className="bg-blue-50/40 font-bold text-blue-950">
                <td className="p-3" colSpan={2}>{tr("Total Net Revenue / صافي الإيرادات")}</td>
                <td className="p-3 text-end font-mono">{tr("SAR")}{" "}{formatSAR(financialModel.totalNetRevenue)}</td>
              </tr>

              {/* COST OF SALES SECTION */}
              <tr className="bg-slate-100/70 font-bold text-slate-800">
                <td className="p-3" colSpan={3}>{tr("COST OF REVENUE / تكلفة الإيرادات")}</td>
              </tr>
              {financialModel.cogsAccounts.map((acc) => (
                <tr key={acc.code}>
                  <td className="p-3 font-mono text-blue-700 font-semibold">{acc.code}</td>
                  <td className="p-3">
                    <span className="font-semibold text-slate-900">{acc.nameEn}</span>
                    {acc.nameAr && <span className="text-slate-400 ml-2">({acc.nameAr})</span>}
                  </td>
                  <td className="p-3 text-end font-mono text-slate-700">({formatSAR(acc.netDebit)})</td>
                </tr>
              ))}
              <tr className="bg-emerald-50/60 font-bold text-emerald-950 text-sm">
                <td className="p-3.5" colSpan={2}>
                  GROSS PROFIT / إجمالي الربح ({financialModel.grossMarginPct.toFixed(1)}% Margin)
                </td>
                <td className="p-3.5 text-end font-mono">{tr("SAR")}{" "}{formatSAR(financialModel.grossProfit)}</td>
              </tr>

              {/* OPERATING EXPENSES SECTION */}
              <tr className="bg-slate-100/70 font-bold text-slate-800">
                <td className="p-3" colSpan={3}>{tr("GENERAL, ADMINISTRATIVE & SELLING EXPENSES / المصاريف العمومية والإدارية والبيعية")}</td>
              </tr>
              {financialModel.opexAccounts.length === 0 ? (
                <tr>
                  <td className="p-3 text-slate-400 italic" colSpan={3}>
                    {tr("No operating expense journal vouchers posted in this period.")}
                  </td>
                </tr>
              ) : (
                financialModel.opexAccounts.map((acc) => (
                  <tr key={acc.code}>
                    <td className="p-3 font-mono text-blue-700 font-semibold">{acc.code}</td>
                    <td className="p-3">
                      <span className="font-semibold text-slate-900">{acc.nameEn}</span>
                      {acc.nameAr && <span className="text-slate-400 ml-2">({acc.nameAr})</span>}
                    </td>
                    <td className="p-3 text-end font-mono text-slate-700">
                      {acc.netDebit >= 0 ? `(${formatSAR(acc.netDebit)})` : formatSAR(Math.abs(acc.netDebit))}
                    </td>
                  </tr>
                ))
              )}
              <tr className="font-bold text-slate-800">
                <td className="p-3" colSpan={2}>{tr("Total Operating Expenses / إجمالي المصاريف التشغيلية")}</td>
                <td className="p-3 text-end font-mono">({formatSAR(financialModel.totalOpex)})</td>
              </tr>

              {/* BOTTOM LINE NET INCOME */}
              <tr className="bg-slate-900 text-white text-sm font-bold">
                <td className="p-4" colSpan={2}>
                  {tr("NET INCOME (LOSS) FOR THE PERIOD / صافي الربح (الخسارة) للفترة")}
                </td>
                <td className={`p-4 text-end font-mono ${financialModel.netIncomePeriod >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  SAR {formatSAR(financialModel.netIncomePeriod)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* REPORT 2: SOCPA STATEMENT OF FINANCIAL POSITION (BALANCE SHEET) */}
      {activeReport === 'bs' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="bg-slate-900 text-white p-5 flex flex-wrap justify-between items-start gap-4">
            <div>
              {company?.logoUrl && (<img src={company.logoUrl} alt="Company Logo" className="h-11 max-w-[160px] object-contain bg-white rounded-lg p-1 mb-2" />)}`n              <div className="text-base font-bold">{company.nameEn}</div>
              <div className="text-sm text-blue-300 font-semibold">{company.nameAr}</div>
              <div className="text-[11px] text-slate-300 mt-1 font-mono">
                {tr("VAT TIN:")}{" "}{company.vatNumber} • CR: {company.crNumber}
              </div>
            </div>
            <div className="text-start sm:text-end">
              <div className="text-sm font-bold uppercase tracking-wide text-emerald-400">
                {tr("Statement of Financial Position (Balance Sheet)")}
              </div>
              <div className="text-xs text-slate-300">قائمة المركز المالي (الميزانية العمومية)</div>
              <div className="text-[11px] text-slate-400 mt-1">
                {tr("As of:")}{" "}{useAllDates ? new Date().toISOString().slice(0, 10) : asOfDate}
              </div>
            </div>
          </div>

          <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-bold text-slate-700">Accounting Equation Check (Assets = Liabilities + Equity):</span>
            {financialModel.isBsBalanced ? (
              <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
                <CheckCircle2 className="w-4 h-4" /> {tr("BALANCED (SAR")}{" "}{formatSAR(financialModel.totalAssets)})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-bold text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1 rounded-full">
                <AlertTriangle className="w-4 h-4" /> {tr("Variance: SAR")}{" "}{formatSAR(financialModel.bsDiff)}
              </span>
            )}
          </div>

          <table className="w-full text-start text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-3.5">{tr("GL Code")}</th>
                <th className="p-3.5">{tr("Account Title (EN / AR)")}</th>
                <th className="p-3.5 text-end">{tr("Balance (SAR)")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {/* ASSETS */}
              <tr className="bg-slate-100/80 font-bold text-slate-900">
                <td className="p-3" colSpan={3}>{tr("ASSETS / الأصول")}</td>
              </tr>
              {financialModel.currentAssets.map((acc) => (
                <tr key={acc.code}>
                  <td className="p-3 font-mono text-blue-700 font-semibold">{acc.code}</td>
                  <td className="p-3">
                    <span className="font-semibold">{acc.nameEn}</span>
                    {acc.nameAr && <span className="text-slate-400 ml-2">({acc.nameAr})</span>}
                  </td>
                  <td className="p-3 text-end font-mono font-semibold">{formatSAR(acc.balance)}</td>
                </tr>
              ))}
              {financialModel.nonCurrentAssets.map((acc) => (
                <tr key={acc.code}>
                  <td className="p-3 font-mono text-blue-700 font-semibold">{acc.code}</td>
                  <td className="p-3">
                    <span className="font-semibold">{acc.nameEn}</span>
                    {acc.nameAr && <span className="text-slate-400 ml-2">({acc.nameAr})</span>}
                  </td>
                  <td className="p-3 text-end font-mono font-semibold">{formatSAR(acc.balance)}</td>
                </tr>
              ))}
              <tr className="bg-blue-50/50 font-bold text-blue-950 text-sm">
                <td className="p-3.5" colSpan={2}>{tr("TOTAL ASSETS / إجمالي الأصول")}</td>
                <td className="p-3.5 text-end font-mono">{tr("SAR")}{" "}{formatSAR(financialModel.totalAssets)}</td>
              </tr>

              {/* LIABILITIES */}
              <tr className="bg-slate-100/80 font-bold text-slate-900">
                <td className="p-3" colSpan={3}>{tr("LIABILITIES / الالتزامات")}</td>
              </tr>
              {financialModel.liabilities.map((acc) => (
                <tr key={acc.code}>
                  <td className="p-3 font-mono text-blue-700 font-semibold">{acc.code}</td>
                  <td className="p-3">
                    <span className="font-semibold">{acc.nameEn}</span>
                    {acc.nameAr && <span className="text-slate-400 ml-2">({acc.nameAr})</span>}
                  </td>
                  <td className="p-3 text-end font-mono font-semibold">{formatSAR(acc.balance)}</td>
                </tr>
              ))}
              <tr className="font-bold text-slate-800">
                <td className="p-3" colSpan={2}>{tr("Total Liabilities / إجمالي الالتزامات")}</td>
                <td className="p-3 text-end font-mono">{tr("SAR")}{" "}{formatSAR(financialModel.totalLiabilities)}</td>
              </tr>

              {/* SHAREHOLDERS EQUITY */}
              <tr className="bg-slate-100/80 font-bold text-slate-900">
                <td className="p-3" colSpan={3}>SHAREHOLDERS&apos; EQUITY / حقوق الملكية</td>
              </tr>
              {financialModel.equityAccounts.map((acc) => (
                <tr key={acc.code}>
                  <td className="p-3 font-mono text-blue-700 font-semibold">{acc.code}</td>
                  <td className="p-3">
                    <span className="font-semibold">{acc.nameEn}</span>
                    {acc.nameAr && <span className="text-slate-400 ml-2">({acc.nameAr})</span>}
                  </td>
                  <td className="p-3 text-end font-mono font-semibold">{formatSAR(acc.balance)}</td>
                </tr>
              ))}
              <tr>
                <td className="p-3 font-mono text-emerald-700 font-semibold">3999</td>
                <td className="p-3 font-semibold text-emerald-800">
                  {tr("Current Period Net Income (Closed from P&L) / صافي ربح الفترة الحالية")}
                </td>
                <td className="p-3 text-end font-mono font-bold text-emerald-700">
                  {formatSAR(financialModel.cumNetIncome)}
                </td>
              </tr>
              <tr className="font-bold text-slate-800">
                <td className="p-3" colSpan={2}>Total Shareholders&apos; Equity / إجمالي حقوق الملكية</td>
                <td className="p-3 text-end font-mono">{tr("SAR")}{" "}{formatSAR(financialModel.totalEquity)}</td>
              </tr>

              {/* TOTAL LIABILITIES + EQUITY */}
              <tr className="bg-slate-900 text-white text-sm font-bold">
                <td className="p-4" colSpan={2}>
                  {tr("TOTAL LIABILITIES & SHAREHOLDERS' EQUITY / إجمالي الالتزامات وحقوق الملكية")}
                </td>
                <td className="p-4 text-end font-mono text-emerald-400">
                  {tr("SAR")}{" "}{formatSAR(financialModel.totalLiabAndEquity)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}