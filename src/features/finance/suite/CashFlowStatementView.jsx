// CashFlowStatementView (split from erp/FinanceSuiteViews.jsx, Prompt 15).
import { ArrowRightLeft, Download, Printer, Scale } from 'lucide-react';
import { useMemo, useState } from 'react';
import { downloadCsvFile } from '../../../erp/csvExport';
import { formatSAR } from '../../../erp/erpEngine';
import { Header, activeEntries, btnCsv, btnDark, inputCls, isCashCode, labelCls, num, r2, todayStr } from './shared';
import { tr } from '../../../ui/financeI18n';

const classifyCashFlow = (code, type) => {
  const c = String(code || '');
  if (type === 'Revenue' || type === 'Expense') return 'operating';
  if (type === 'Equity' || c.startsWith('3')) return 'financing';
  const p2 = c.slice(0, 2);
  if (p2 >= '15' && p2 <= '19') return 'investing';
  if (p2 >= '25' && p2 <= '29') return 'financing';
  if (c.startsWith('4') || c.startsWith('5')) return 'operating';
  return 'operating';
};

export function CashFlowStatementView({ company = {}, glAccounts = [], glEntries = [] }) {
  const [fromDate, setFromDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [toDate, setToDate] = useState(todayStr());

  const model = useMemo(() => {
    const accMap = {};
    glAccounts.forEach((a) => (accMap[a.account_code] = a));
    const sections = { operating: {}, investing: {}, financing: {} };
    let opening = 0;
    let closingGl = 0;
    let unallocated = 0;

    activeEntries(glEntries).forEach((e) => {
      const d = e.entry_date || '';
      const lines = e.lines || [];
      const cashNet = lines.filter((l) => isCashCode(l.account_code)).reduce((s, l) => s + num(l.debit) - num(l.credit), 0);
      if (d && d <= toDate) closingGl += cashNet;
      if (d && d < fromDate) {
        opening += cashNet;
        return;
      }
      if (!d || d > toDate || Math.abs(cashNet) < 0.005) return;

      const counter = lines.filter((l) => !isCashCode(l.account_code)).map((l) => ({ code: String(l.account_code), name: l.account_name, w: Math.abs(num(l.debit) - num(l.credit)) }));
      const totalW = counter.reduce((s, c) => s + c.w, 0);
      if (totalW <= 0) {
        unallocated += cashNet;
        return;
      }
      counter.forEach((c) => {
        if (c.w <= 0) return;
        const amt = (cashNet * c.w) / totalW;
        const acc = accMap[c.code];
        const sec = classifyCashFlow(c.code, acc?.account_type);
        const key = c.code;
        sections[sec][key] = sections[sec][key] || { code: c.code, nameEn: acc?.account_name_en || c.name || c.code, nameAr: acc?.account_name_ar || '', amount: 0 };
        sections[sec][key].amount += amt;
      });
    });

    const toRows = (obj) => Object.values(obj).filter((r) => Math.abs(r.amount) >= 0.005).sort((a, b) => a.code.localeCompare(b.code));
    const op = toRows(sections.operating);
    const inv = toRows(sections.investing);
    const fin = toRows(sections.financing);
    const tot = (rs) => rs.reduce((s, r) => s + r.amount, 0);
    const netOp = tot(op);
    const netInv = tot(inv);
    const netFin = tot(fin);
    const netChange = netOp + netInv + netFin + unallocated;
    const closing = opening + netChange;
    return { op, inv, fin, netOp, netInv, netFin, unallocated, netChange, opening, closing, closingGl, diff: r2(closing - closingGl) };
  }, [glAccounts, glEntries, fromDate, toDate]);

  const exportCsv = () => {
    const sec = (title, rs, total) => [[title, '', ''], ...rs.map((r) => ['', `${r.code} - ${r.nameEn}`, r.amount.toFixed(2)]), ['', `Net cash from ${title.toLowerCase()}`, total.toFixed(2)]];
    downloadCsvFile(`Cash_Flow_Statement_${fromDate}_to_${toDate}.csv`, ['Section', 'Line', 'Amount (SAR)'], [
      ['Opening cash & bank', '', model.opening.toFixed(2)],
      ...sec('Operating Activities', model.op, model.netOp),
      ...sec('Investing Activities', model.inv, model.netInv),
      ...sec('Financing Activities', model.fin, model.netFin),
      ['Net change in cash', '', model.netChange.toFixed(2)],
      ['Closing cash & bank', '', model.closing.toFixed(2)],
    ]);
  };

  const Section = ({ title, titleAr, rows, total }) => (
    <>
      <tr className="bg-slate-100"><td className="p-3 font-bold text-slate-800" colSpan={2}>{title} <span className="text-slate-500 font-semibold">• {titleAr}</span></td></tr>
      {rows.length === 0 && <tr><td className="p-3 pl-6 text-slate-400" colSpan={2}>{tr("No cash movements")}</td></tr>}
      {rows.map((r) => (
        <tr key={r.code}>
          <td className="p-2.5 pl-6"><span className="font-mono text-blue-700 mr-1.5">{r.code}</span>{r.nameEn}{r.nameAr && <span className="text-slate-400"> • {r.nameAr}</span>}</td>
          <td className={`p-2.5 text-end font-mono ${r.amount < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{r.amount < 0 ? `(${formatSAR(Math.abs(r.amount))})` : formatSAR(r.amount)}</td>
        </tr>
      ))}
      <tr className="font-bold border-t border-slate-200">
        <td className="p-3">{tr("Net cash from")}{" "}{title.toLowerCase()}</td>
        <td className="p-3 text-end font-mono">{total < 0 ? `(${formatSAR(Math.abs(total))})` : formatSAR(total)}</td>
      </tr>
    </>
  );

  return (
    <div className="space-y-4">
      <Header icon={ArrowRightLeft} title={tr("Statement of Cash Flows • قائمة التدفقات النقدية")} subtitle={tr("Direct-method cash flow derived from every GL journal that touches cash & bank accounts (1010–1099).")}>
        <button type="button" onClick={exportCsv} className={btnCsv}><Download className="w-4 h-4" /> {tr("Export CSV")}</button>
        <button type="button" onClick={() => window.print()} className={btnDark}><Printer className="w-4 h-4" /> {tr("Print")}</button>
      </Header>

      <div className="no-print flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-2xl p-4">
        <div><label className={labelCls}>{tr("From")}</label><input type="date" className={inputCls} value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
        <div><label className={labelCls}>{tr("To")}</label><input type="date" className={inputCls} value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="bg-slate-900 text-white px-5 py-3.5 flex flex-wrap justify-between items-center gap-2 text-xs">
          <div className="flex items-center gap-3">
            {company?.logoUrl && <img src={company.logoUrl} alt="Company Logo" className="h-9 max-w-[130px] object-contain bg-white rounded p-0.5" />}
            <div>
              <div className="font-bold">{company?.nameEn} {company?.nameAr && <span className="font-normal">• {company.nameAr}</span>}</div>
              <div>{tr("VAT TIN:")} <span className="font-mono">{company?.vatNumber}</span></div>
            </div>
          </div>
          <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold">{fromDate} → {toDate}</span>
        </div>
        <table className="w-full text-start text-xs">
          <tbody className="divide-y divide-slate-100">
            <tr className="font-bold"><td className="p-3">{tr("Opening cash & bank balance • الرصيد الافتتاحي")}</td><td className="p-3 text-end font-mono">{formatSAR(model.opening)}</td></tr>
            <Section title={tr("Operating Activities")} titleAr="الأنشطة التشغيلية" rows={model.op} total={model.netOp} />
            <Section title={tr("Investing Activities")} titleAr="الأنشطة الاستثمارية" rows={model.inv} total={model.netInv} />
            <Section title={tr("Financing Activities")} titleAr="الأنشطة التمويلية" rows={model.fin} total={model.netFin} />
            {Math.abs(model.unallocated) >= 0.005 && <tr><td className="p-3 text-amber-700">{tr("Unallocated cash movements")}</td><td className="p-3 text-end font-mono">{formatSAR(model.unallocated)}</td></tr>}
            <tr className="font-bold bg-slate-50"><td className="p-3">{tr("Net increase / (decrease) in cash • صافي التغير")}</td><td className="p-3 text-end font-mono">{model.netChange < 0 ? `(${formatSAR(Math.abs(model.netChange))})` : formatSAR(model.netChange)}</td></tr>
            <tr className="bg-slate-900 text-white font-bold"><td className="p-3">{tr("Closing cash & bank balance • الرصيد الختامي")}</td><td className="p-3 text-end font-mono text-emerald-400">{tr("SAR")}{" "}{formatSAR(model.closing)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className={`text-xs font-semibold rounded-xl px-4 py-2.5 border ${Math.abs(model.diff) < 0.01 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
        <Scale className="inline w-4 h-4 mr-1" />
        {tr("Reconciliation check: GL cash & bank balance at")}{" "}{toDate} = SAR {formatSAR(model.closingGl)} — {Math.abs(model.diff) < 0.01 ? 'statement agrees with the General Ledger.' : `difference SAR ${formatSAR(model.diff)}.`}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Customer / Supplier Statements of Account                        */
/* ------------------------------------------------------------------ */
