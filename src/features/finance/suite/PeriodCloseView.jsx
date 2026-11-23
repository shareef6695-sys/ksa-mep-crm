// PeriodCloseView (split from erp/FinanceSuiteViews.jsx, Prompt 15).
import { CalendarCheck, CheckCircle2, Lock, Unlock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatSAR } from '../../../erp/erpEngine';
import { Header, Notice, accLabel, activeEntries, btnDark, btnGhost, btnPrimary, inputCls, labelCls, lockError, num, r2, rpcOrThrow } from './shared';
import { tr } from '../../../ui/financeI18n';

const canManageFinance = (profile) => ['admin', 'ceo', 'finance'].includes(String(profile?.role_key || '').toLowerCase());

export function PeriodCloseView({ supabase, glAccounts = [], glEntries = [], lockDate = '', profile, onRefresh }) {
  const canManage = canManageFinance(profile);
  const [newLock, setNewLock] = useState(lockDate || '');
  const [fy, setFy] = useState(new Date().getFullYear() - 1);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [justClosed, setJustClosed] = useState(null);

  useEffect(() => setNewLock(lockDate || ''), [lockDate]);

  const saveLock = async (value) => {
    if (!canManage) return;
    setSaving(true);
    let { error } = await supabase.rpc('set_period_lock', { p_lock_date: value || null, p_reason: value ? 'Set from Period Lock screen' : 'Lock cleared from Period Lock screen' });
    if (error && /set_period_lock|PGRST202|Could not find the function/i.test(`${error.code} ${error.message}`)) {
      // migration 0003 not applied yet
      ({ error } = await supabase.from('app_settings').upsert({ key: 'gl_period_lock', value: { lockDate: value || '' } }, { onConflict: 'key' }));
    }
    setSaving(false);
    if (error) return setMsg({ type: 'error', text: `Could not update period lock: ${error.message}` });
    setMsg({ type: 'ok', text: value ? `Books locked up to and including ${value}.` : 'Period lock cleared — all dates are open for posting.' });
    onRefresh && onRefresh();
  };

  const alreadyClosed = useMemo(() => activeEntries(glEntries).some((e) => e.source_module === 'YEAR_END_CLOSE' && e.source_doc_number === `FY${fy}`), [glEntries, fy]);

  const preview = useMemo(() => {
    const accMap = {};
    glAccounts.forEach((a) => (accMap[a.account_code] = a));
    const bal = {};
    activeEntries(glEntries).forEach((e) => {
      if (String(e.entry_date || '').slice(0, 4) !== String(fy)) return;
      if (e.source_module === 'YEAR_END_CLOSE') return;
      (e.lines || []).forEach((l) => {
        const acc = accMap[l.account_code];
        const type = acc?.account_type || (String(l.account_code).startsWith('4') ? 'Revenue' : String(l.account_code).startsWith('5') ? 'Expense' : null);
        if (type !== 'Revenue' && type !== 'Expense') return;
        bal[l.account_code] = bal[l.account_code] || { code: String(l.account_code), name: acc?.account_name_en || l.account_name, type, net: 0 };
        bal[l.account_code].net += num(l.debit) - num(l.credit);
      });
    });
    const rows = Object.values(bal).filter((r) => Math.abs(r.net) >= 0.005).sort((a, b) => a.code.localeCompare(b.code));
    const revenue = -rows.filter((r) => r.type === 'Revenue').reduce((s, r) => s + r.net, 0);
    const expenses = rows.filter((r) => r.type === 'Expense').reduce((s, r) => s + r.net, 0);
    return { rows, revenue, expenses, netIncome: revenue - expenses };
  }, [glAccounts, glEntries, fy]);

  const closeYear = async () => {
    if (!canManage) return;
    const date = `${fy}-12-31`;
    if (alreadyClosed) return setMsg({ type: 'error', text: `FY${fy} has already been closed.` });
    const le = lockError(date, lockDate);
    if (le) return setMsg({ type: 'error', text: le });
    if (preview.rows.length === 0) return setMsg({ type: 'error', text: `No revenue or expense balances in FY${fy} to close.` });
    if (!window.confirm(`Post year-end closing journal for FY${fy}? Net ${preview.netIncome >= 0 ? 'profit' : 'loss'} of SAR ${formatSAR(Math.abs(preview.netIncome))} will move to 3020 Retained Earnings.`)) return;
    setSaving(true);
    try {
      const lines = preview.rows.map((r) => ({
        account_code: r.code,
        account_name: accLabel(glAccounts, r.code),
        debit: r.net < 0 ? r2(-r.net) : 0,
        credit: r.net > 0 ? r2(r.net) : 0,
        memo: `Close FY${fy}`,
      }));
      const ni = r2(preview.netIncome);
      if (ni > 0) lines.push({ account_code: '3020', account_name: accLabel(glAccounts, '3020'), debit: 0, credit: ni, memo: `FY${fy} net profit` });
      if (ni < 0) lines.push({ account_code: '3020', account_name: accLabel(glAccounts, '3020'), debit: Math.abs(ni), credit: 0, memo: `FY${fy} net loss` });
      await rpcOrThrow(supabase, 'post_journal', {
        p_kind: 'YEAR_END_CLOSE',
        p_entry_date: date,
        p_description: `Year-End Closing Entry FY${fy} — transfer P&L to Retained Earnings`,
        p_lines: lines.map(({ account_code, debit, credit, memo }) => ({ account_code, debit, credit, memo })),
        p_reference: `FY${fy}`,
      });
      setMsg({ type: 'ok', text: `FY${fy} closed. SAR ${formatSAR(Math.abs(ni))} transferred to Retained Earnings.` });
      setJustClosed(fy);
      onRefresh && onRefresh();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setSaving(false);
  };

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div className="space-y-4">
      <Header icon={CalendarCheck} title={tr("Period Lock & Year-End Close • إقفال الفترات والسنة المالية")} subtitle={tr("Prevent back-dated postings into closed periods and transfer the year's profit or loss to Retained Earnings.")} />

      <Notice msg={msg} onClear={() => setMsg(null)} />

      {!canManage && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 font-semibold">
          {tr("Read-only: only Admin, CEO, Finance or Manager roles can change the period lock or close a fiscal year.")}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          {lockDate ? <Lock className="w-5 h-5 text-rose-600" /> : <Unlock className="w-5 h-5 text-emerald-600" />}
          <div className="text-sm font-bold text-slate-900">
            {lockDate ? `Books are locked up to and including ${lockDate}` : 'No period lock — all dates are open'}
          </div>
        </div>
        <p className="text-xs text-slate-500">{tr("Journals, expenses, transfers, asset postings and closing entries dated on or before the lock date are refused.")}</p>
        {canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <div><label className={labelCls}>{tr("Lock books up to")}</label><input type="date" className={inputCls} value={newLock} onChange={(e) => setNewLock(e.target.value)} /></div>
            <button type="button" onClick={() => saveLock(newLock)} disabled={saving || !newLock} className={btnDark}><Lock className="w-4 h-4" /> {tr("Set Lock Date")}</button>
            {lockDate && <button type="button" onClick={() => saveLock('')} disabled={saving} className={btnGhost}><Unlock className="w-4 h-4" /> {tr("Clear Lock")}</button>}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{tr("Year-End Close")}</h3>
            <p className="text-xs text-slate-500">{tr("Zeroes every revenue & expense account for the year into 3020 Retained Earnings with a journal dated 31 December.")}</p>
          </div>
          <div className="flex items-end gap-2">
            <div><label className={labelCls}>{tr("Fiscal Year")}</label><select className={inputCls} value={fy} onChange={(e) => setFy(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>FY{y}</option>)}</select></div>
            {canManage && (
              <button type="button" onClick={closeYear} disabled={saving || alreadyClosed || preview.rows.length === 0} className={btnPrimary}>
                <CalendarCheck className="w-4 h-4" /> {alreadyClosed ? `FY${fy} Closed` : `Close FY${fy}`}
              </button>
            )}
          </div>
        </div>

        {alreadyClosed && <div className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> {tr("A YEAR_END_CLOSE journal for FY")}{fy}{" "}{tr("already exists.")}</div>}

        {canManage && (justClosed === fy || alreadyClosed) && (!lockDate || lockDate < `${fy}-12-31`) && (
          <div className="flex flex-wrap items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-900">
            {tr("Lock FY")}{fy}{" "}{tr("so nobody can post into it?")}
            <button type="button" onClick={() => saveLock(`${fy}-12-31`)} disabled={saving} className={btnDark}><Lock className="w-4 h-4" /> {tr("Lock up to")}{" "}{fy}-12-31</button>
          </div>
        )}

        <table className="w-full text-xs">
          <thead className="text-slate-400 border-b border-slate-100">
            <tr><th className="py-1 text-start">{tr("Account")}</th><th className="py-1 text-start">{tr("Type")}</th><th className="py-1 text-end">{tr("FY Balance")}</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {preview.rows.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-slate-400">{tr("No revenue or expense activity in FY")}{fy}.</td></tr>}
            {preview.rows.map((r) => (
              <tr key={r.code}>
                <td className="py-1.5"><span className="font-mono text-blue-700 mr-1.5">{r.code}</span>{r.name}</td>
                <td className="py-1.5">{r.type}</td>
                <td className="py-1.5 text-end font-mono">{r.net >= 0 ? `Dr ${formatSAR(r.net)}` : `Cr ${formatSAR(Math.abs(r.net))}`}</td>
              </tr>
            ))}
            {preview.rows.length > 0 && (
              <>
                <tr className="font-semibold border-t border-slate-200"><td className="py-1.5" colSpan={2}>{tr("Total Revenue")}</td><td className="py-1.5 text-end font-mono">{formatSAR(preview.revenue)}</td></tr>
                <tr className="font-semibold"><td className="py-1.5" colSpan={2}>{tr("Total Expenses")}</td><td className="py-1.5 text-end font-mono">{formatSAR(preview.expenses)}</td></tr>
                <tr className="font-bold"><td className="py-1.5" colSpan={2}>Net {preview.netIncome >= 0 ? tr('Profit') : tr('Loss')} → 3020 Retained Earnings</td><td className={`py-1.5 text-end font-mono ${preview.netIncome >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>SAR {formatSAR(Math.abs(preview.netIncome))}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
