// BudgetVsActualView (split from erp/FinanceSuiteViews.jsx, Prompt 15).
import { CheckCircle2, Download, Target } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { downloadCsvFile } from '../../../erp/csvExport';
import { formatSAR } from '../../../erp/erpEngine';
import { Header, Notice, activeEntries, btnCsv, btnPrimary, inputCls, labelCls, num, r2 } from './shared';
import { tr } from '../../../ui/financeI18n';

const evenSplit = (annual) => {
  const a = r2(annual);
  const base = Math.floor((a / 12) * 100) / 100;
  const arr = Array(12).fill(base);
  arr[11] = r2(a - base * 11);
  return arr;
};

export function BudgetVsActualView({ supabase, glAccounts = [], glEntries = [], budgets = [], onRefresh }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [throughMonth, setThroughMonth] = useState(now.getMonth() + 1);
  const [drafts, setDrafts] = useState({});
  const [showMonths, setShowMonths] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [dirty, setDirty] = useState(false);

  const plAccounts = useMemo(
    () => glAccounts.filter((a) => a.account_type === 'Revenue' || a.account_type === 'Expense').sort((a, b) => a.account_code.localeCompare(b.account_code)),
    [glAccounts]
  );

  useEffect(() => {
    const next = {};
    budgets.filter((b) => Number(b.fiscal_year) === Number(year)).forEach((b) => {
      const months = Array.isArray(b.monthly_amounts) && b.monthly_amounts.length === 12 ? b.monthly_amounts.map(num) : evenSplit(b.annual_amount_sar);
      next[b.account_code] = { annual: num(b.annual_amount_sar), months, notes: b.notes || '' };
    });
    setDrafts(next);
    setDirty(false);
  }, [budgets, year]);

  useEffect(() => {
    setThroughMonth(Number(year) === now.getFullYear() ? now.getMonth() + 1 : 12);
  }, [year]);

  const actuals = useMemo(() => {
    const map = {};
    activeEntries(glEntries).forEach((e) => {
      if (e.source_module === 'YEAR_END_CLOSE') return;
      const d = e.entry_date || '';
      if (d.slice(0, 4) !== String(year)) return;
      const mIdx = Number(d.slice(5, 7)) - 1;
      (e.lines || []).forEach((l) => {
        map[l.account_code] = map[l.account_code] || Array(12).fill(0);
        map[l.account_code][mIdx] += num(l.debit) - num(l.credit); // debit-positive
      });
    });
    return map;
  }, [glEntries, year]);

  const rows = useMemo(
    () =>
      plAccounts.map((a) => {
        const isRev = a.account_type === 'Revenue';
        const d = drafts[a.account_code] || { annual: 0, months: Array(12).fill(0) };
        const act = (actuals[a.account_code] || Array(12).fill(0)).map((v) => (isRev ? -v : v));
        const ytdBudget = d.months.slice(0, throughMonth).reduce((s, v) => s + num(v), 0);
        const ytdActual = act.slice(0, throughMonth).reduce((s, v) => s + v, 0);
        const variance = isRev ? ytdActual - ytdBudget : ytdBudget - ytdActual; // positive = favourable
        const pct = ytdBudget ? (variance / Math.abs(ytdBudget)) * 100 : null;
        return { a, isRev, d, ytdBudget, ytdActual, variance, pct, annualActual: act.reduce((s, v) => s + v, 0) };
      }),
    [plAccounts, drafts, actuals, throughMonth]
  );

  const sum = (filterFn, key) => rows.filter(filterFn).reduce((s, r) => s + r[key], 0);
  const revB = sum((r) => r.isRev, 'ytdBudget');
  const revA = sum((r) => r.isRev, 'ytdActual');
  const expB = sum((r) => !r.isRev, 'ytdBudget');
  const expA = sum((r) => !r.isRev, 'ytdActual');

  const setAnnual = (code, val) => {
    setDrafts({ ...drafts, [code]: { ...(drafts[code] || {}), annual: val, months: evenSplit(val) } });
    setDirty(true);
  };
  const setMonth = (code, idx, val) => {
    const cur = drafts[code] || { annual: 0, months: Array(12).fill(0) };
    const months = [...cur.months];
    months[idx] = num(val);
    setDrafts({ ...drafts, [code]: { ...cur, months, annual: r2(months.reduce((s, v) => s + v, 0)) } });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    const payload = Object.entries(drafts).map(([code, d]) => ({
      id: `bud-${year}-${code}`,
      fiscal_year: Number(year),
      account_code: code,
      annual_amount_sar: r2(d.annual),
      monthly_amounts: (d.months || evenSplit(d.annual)).map(r2),
      notes: d.notes || '',
      updated_at: new Date().toISOString(),
    }));
    if (payload.length === 0) {
      setSaving(false);
      return setMsg({ type: 'error', text: tr('Enter at least one budget amount.') });
    }
    const { error } = await supabase.from('gl_budgets').upsert(payload, { onConflict: 'fiscal_year,account_code' });
    setSaving(false);
    if (error) return setMsg({ type: 'error', text: `Could not save budget: ${error.message}` });
    setMsg({ type: 'ok', text: `FY${year} budget saved (${payload.length} accounts).` });
    setDirty(false);
    onRefresh && onRefresh();
  };

  const exportCsv = () =>
    downloadCsvFile(
      `Budget_vs_Actual_FY${year}_M${throughMonth}.csv`,
      ['Code', 'Account', 'Type', 'Annual Budget', `YTD Budget (M1-M${throughMonth})`, 'YTD Actual', 'Variance (Fav +)', 'Variance %'],
      rows.map((r) => [r.a.account_code, r.a.account_name_en, r.a.account_type, r2(r.d.annual).toFixed(2), r.ytdBudget.toFixed(2), r.ytdActual.toFixed(2), r.variance.toFixed(2), r.pct === null ? '' : r.pct.toFixed(1)])
    );

  const years = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div className="space-y-4">
      <Header icon={Target} title={tr("Budget vs Actual • الموازنة مقابل الفعلي")} subtitle={tr("Set annual / monthly budgets per revenue & expense account and track year-to-date variance against posted GL actuals.")}>
        <button type="button" onClick={exportCsv} className={btnCsv}><Download className="w-4 h-4" /> {tr("Export CSV")}</button>
        <button type="button" onClick={save} disabled={saving || !dirty} className={btnPrimary}><CheckCircle2 className="w-4 h-4" /> {saving ? tr('Saving…') : tr('Save Budget')}</button>
      </Header>

      <Notice msg={msg} onClear={() => setMsg(null)} />

      <div className="no-print flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-2xl p-4">
        <div>
          <label className={labelCls}>{tr("Fiscal Year")}</label>
          <select className={inputCls} value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>FY{y}</option>)}</select>
        </div>
        <div>
          <label className={labelCls}>{tr("YTD through")}</label>
          <select className={inputCls} value={throughMonth} onChange={(e) => setThroughMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={showMonths} onChange={(e) => setShowMonths(e.target.checked)} /> {tr("Edit monthly phasing")}</label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-semibold text-slate-500">{tr("YTD Revenue — Budget / Actual")}</div><div className="mt-1 font-mono font-bold text-sm">{formatSAR(revB)} / <span className={revA >= revB ? 'text-emerald-700' : 'text-rose-600'}>{formatSAR(revA)}</span></div></div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-semibold text-slate-500">{tr("YTD Expenses — Budget / Actual")}</div><div className="mt-1 font-mono font-bold text-sm">{formatSAR(expB)} / <span className={expA <= expB ? 'text-emerald-700' : 'text-rose-600'}>{formatSAR(expA)}</span></div></div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-semibold text-slate-500">{tr("YTD Net Profit — Budget / Actual")}</div><div className="mt-1 font-mono font-bold text-sm">{formatSAR(revB - expB)} / <span className={revA - expA >= revB - expB ? 'text-emerald-700' : 'text-rose-600'}>{formatSAR(revA - expA)}</span></div></div>
      </div>

      {plAccounts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">{tr("No Revenue or Expense accounts in the Chart of Accounts.")}</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
          <table className="w-full text-start text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-3">{tr("Account")}</th>
                <th className="p-3 text-end">{tr("Annual Budget")}</th>
                {showMonths && MONTHS.map((m) => <th key={m} className="p-2 text-end">{m}</th>)}
                <th className="p-3 text-end">{tr("YTD Budget")}</th><th className="p-3 text-end">{tr("YTD Actual")}</th><th className="p-3 text-end">{tr("Variance")}</th><th className="p-3 text-end">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const fav = r.variance >= 0;
                return (
                  <tr key={r.a.account_code} className="hover:bg-slate-50/70">
                    <td className="p-3">
                      <span className="font-mono font-bold text-blue-700 mr-1.5">{r.a.account_code}</span>
                      <span className="font-semibold text-slate-800">{r.a.account_name_en}</span>
                      <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${r.isRev ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{r.a.account_type}</span>
                    </td>
                    <td className="p-2 text-end">
                      <input type="number" step="0.01" className="w-28 border border-slate-300 rounded-lg px-2 py-1 text-end font-mono text-xs" value={drafts[r.a.account_code]?.annual ?? ''} onChange={(e) => setAnnual(r.a.account_code, num(e.target.value))} placeholder="0.00" />
                    </td>
                    {showMonths && r.d.months.map((v, i) => (
                      <td key={i} className="p-1 text-end">
                        <input type="number" step="0.01" className="w-20 border border-slate-200 rounded px-1 py-0.5 text-end font-mono text-[11px]" value={v || ''} onChange={(e) => setMonth(r.a.account_code, i, e.target.value)} />
                      </td>
                    ))}
                    <td className="p-3 text-end font-mono">{formatSAR(r.ytdBudget)}</td>
                    <td className="p-3 text-end font-mono">{formatSAR(r.ytdActual)}</td>
                    <td className={`p-3 text-end font-mono font-bold ${r.ytdBudget === 0 && r.ytdActual === 0 ? 'text-slate-400' : fav ? 'text-emerald-700' : 'text-rose-600'}`}>{fav ? '+' : '−'}{formatSAR(Math.abs(r.variance))}</td>
                    <td className="p-3 text-end">{r.pct === null ? '—' : `${r.pct.toFixed(1)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Cash Flow Statement (direct method)                              */
/* ------------------------------------------------------------------ */
