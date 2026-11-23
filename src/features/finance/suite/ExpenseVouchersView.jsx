// ExpenseVouchersView (split from erp/FinanceSuiteViews.jsx, Prompt 15).
import { Ban, Download, Plus, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { downloadCsvFile } from '../../../erp/csvExport';
import { formatSAR } from '../../../erp/erpEngine';
import { Header, Modal, Notice, accLabel, btnCsv, btnPrimary, cashAccountsOf, inputCls, labelCls, lockError, monthKey, num, r2, rpcOrThrow, todayStr } from './shared';
import { tr } from '../../../ui/financeI18n';

const blankExpense = () => ({
  expense_date: todayStr(),
  payee: '',
  vendor_id: '',
  expense_account_code: '',
  description: '',
  division: 'Shared',
  amount_sar: '',
  vat_applied: true,
  vat_recoverable: true,
  paid_from_account_code: '1020',
  payment_reference: '',
});

export function ExpenseVouchersView({ supabase, glAccounts = [], expenses = [], vendors = [], projects = [], profile, lockDate = '', onRefresh }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankExpense());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [fMonth, setFMonth] = useState('');
  const [fAccount, setFAccount] = useState('');
  const [fDivision, setFDivision] = useState('');

  const expenseAccounts = useMemo(
    () => glAccounts.filter((a) => a.account_type === 'Expense').sort((a, b) => a.account_code.localeCompare(b.account_code)),
    [glAccounts]
  );
  const payFromOptions = useMemo(() => {
    const cash = cashAccountsOf(glAccounts, []);
    return [...cash.map((a) => ({ code: a.account_code, label: `${a.account_code} — ${a.account_name_en}` })), { code: '2010', label: '2010 — On Credit (Accounts Payable)' }];
  }, [glAccounts]);

  const net = r2(form.amount_sar);
  const vat = form.vat_applied ? r2(net * 0.15) : 0;
  const total = r2(net + vat);

  const submit = async (e) => {
    e.preventDefault();
    const expCode = form.expense_account_code || expenseAccounts[0]?.account_code;
    if (!expCode) return setMsg({ type: 'error', text: tr('No Expense accounts in the Chart of Accounts.') });
    if (net <= 0) return setMsg({ type: 'error', text: tr('Net amount must be greater than zero.') });
    if (!form.payee.trim()) return setMsg({ type: 'error', text: tr('Payee is required.') });
    const le = lockError(form.expense_date, lockDate);
    if (le) return setMsg({ type: 'error', text: le });

    setSaving(true);
    try {
      const ev = await rpcOrThrow(supabase, 'post_expense_voucher', {
        p: {
          expense_date: form.expense_date,
          payee: form.payee.trim(),
          vendor_id: form.vendor_id || null,
          expense_account_code: expCode,
          description: form.description,
          division: form.division,
          project_id: form.project_id || null,
          amount_sar: net,
          vat_applied: form.vat_applied,
          vat_recoverable: form.vat_applied && form.vat_recoverable,
          paid_from_account_code: form.paid_from_account_code,
          payment_reference: form.payment_reference,
        },
      });
      const vNo = ev.voucher_number;
      const jv = { voucher_number: ev.journal_voucher_number };
      setMsg({ type: 'ok', text: `Expense voucher ${vNo} posted (GL ${jv.voucher_number}) — SAR ${formatSAR(total)}.` });
      setShowModal(false);
      setForm(blankExpense());
      onRefresh && onRefresh();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setSaving(false);
  };

  const voidExpense = async (exp) => {
    if (!window.confirm(`Void expense voucher ${exp.voucher_number}? A reversing journal will be posted today.`)) return;
    const date = todayStr();
    const le = lockError(date, lockDate);
    if (le) return setMsg({ type: 'error', text: le });
    setSaving(true);
    try {
      await rpcOrThrow(supabase, 'void_expense_voucher', { p_id: exp.id, p_date: date });
      setMsg({ type: 'ok', text: `Expense voucher ${exp.voucher_number} voided and reversed in the GL.` });
      onRefresh && onRefresh();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setSaving(false);
  };

  const filtered = useMemo(
    () =>
      [...expenses]
        .filter((x) => (!fMonth || monthKey(x.expense_date) === fMonth) && (!fAccount || x.expense_account_code === fAccount) && (!fDivision || x.division === fDivision))
        .sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date))),
    [expenses, fMonth, fAccount, fDivision]
  );

  const byAccount = useMemo(() => {
    const m = {};
    filtered.filter((x) => x.status !== 'void').forEach((x) => {
      m[x.expense_account_code] = m[x.expense_account_code] || { net: 0, vat: 0, total: 0, count: 0 };
      m[x.expense_account_code].net += num(x.amount_sar);
      m[x.expense_account_code].vat += num(x.vat_sar);
      m[x.expense_account_code].total += num(x.total_sar);
      m[x.expense_account_code].count += 1;
    });
    return Object.entries(m).sort((a, b) => b[1].total - a[1].total);
  }, [filtered]);
  const grand = byAccount.reduce((s, [, v]) => ({ net: s.net + v.net, vat: s.vat + v.vat, total: s.total + v.total }), { net: 0, vat: 0, total: 0 });

  const months = useMemo(() => Array.from(new Set(expenses.map((x) => monthKey(x.expense_date)).filter(Boolean))).sort().reverse(), [expenses]);

  const exportCsv = () =>
    downloadCsvFile(
      `Expense_Vouchers_${fMonth || 'All'}.csv`,
      ['Voucher #', 'Date', 'Payee', 'Expense Account', 'Description', 'Division', 'Net (SAR)', 'VAT (SAR)', 'Total (SAR)', 'Paid From', 'Reference', 'Status', 'GL Voucher'],
      filtered.map((x) => [x.voucher_number, x.expense_date, x.payee, accLabel(glAccounts, x.expense_account_code), x.description, x.division, num(x.amount_sar).toFixed(2), num(x.vat_sar).toFixed(2), num(x.total_sar).toFixed(2), accLabel(glAccounts, x.paid_from_account_code), x.payment_reference, x.status, x.journal_voucher_number])
    );

  return (
    <div className="space-y-4">
      <Header icon={Receipt} title={tr("Expense Vouchers & Petty Cash • سندات المصروفات")} subtitle={tr("Record operating expenses (rent, salaries, fuel, utilities, government fees) with recoverable 15% input VAT — auto-posted to the GL.")}>
        <button type="button" onClick={exportCsv} className={btnCsv}><Download className="w-4 h-4" /> {tr("Export CSV")}</button>
        <button type="button" onClick={() => setShowModal(true)} className={btnPrimary}><Plus className="w-4 h-4" /> {tr("New Expense Voucher")}</button>
      </Header>

      <Notice msg={msg} onClear={() => setMsg(null)} />

      <div className="no-print flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-2xl p-4">
        <div>
          <label className={labelCls}>{tr("Month")}</label>
          <select className={inputCls} value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
            <option value="">{tr("All months")}</option>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="min-w-[200px]">
          <label className={labelCls}>{tr("Expense Account")}</label>
          <select className={inputCls} value={fAccount} onChange={(e) => setFAccount(e.target.value)}>
            <option value="">{tr("All accounts")}</option>
            {expenseAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name_en}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>{tr("Division")}</label>
          <select className={inputCls} value={fDivision} onChange={(e) => setFDivision(e.target.value)}>
            <option value="">{tr("All")}</option><option value="MEP">{tr("MEP")}</option><option value="IT & ELV">{tr("IT & ELV")}</option><option value="Shared">{tr("Shared")}</option>
          </select>
        </div>
      </div>

      {byAccount.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <h4 className="text-xs font-bold text-slate-700 mb-2">{tr("Totals by Expense Account (excluding voided)")}</h4>
          <table className="w-full text-xs">
            <thead className="text-slate-400 border-b border-slate-100">
              <tr><th className="py-1 text-start">{tr("Account")}</th><th className="py-1 text-end">{tr("Vouchers")}</th><th className="py-1 text-end">{tr("Net")}</th><th className="py-1 text-end">{tr("VAT")}</th><th className="py-1 text-end">{tr("Total")}</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {byAccount.map(([code, v]) => (
                <tr key={code}>
                  <td className="py-1.5 font-semibold">{accLabel(glAccounts, code)}</td>
                  <td className="py-1.5 text-end">{v.count}</td>
                  <td className="py-1.5 text-end font-mono">{formatSAR(v.net)}</td>
                  <td className="py-1.5 text-end font-mono">{formatSAR(v.vat)}</td>
                  <td className="py-1.5 text-end font-mono font-bold">{formatSAR(v.total)}</td>
                </tr>
              ))}
              <tr className="font-bold border-t border-slate-200">
                <td className="py-1.5">{tr("TOTAL")}</td><td />
                <td className="py-1.5 text-end font-mono">{formatSAR(grand.net)}</td>
                <td className="py-1.5 text-end font-mono">{formatSAR(grand.vat)}</td>
                <td className="py-1.5 text-end font-mono">{tr("SAR")}{" "}{formatSAR(grand.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
        <table className="w-full text-start text-xs">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="p-3">{tr("Voucher")}</th><th className="p-3">{tr("Date")}</th><th className="p-3">{tr("Payee")}</th><th className="p-3">{tr("Account")}</th><th className="p-3">{tr("Division")}</th>
              <th className="p-3 text-end">{tr("Net")}</th><th className="p-3 text-end">{tr("VAT")}</th><th className="p-3 text-end">{tr("Total")}</th><th className="p-3">{tr("Paid From")}</th><th className="p-3">{tr("Status")}</th><th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 && <tr><td colSpan={11} className="p-8 text-center text-slate-400">{tr("No expense vouchers yet. Click")} <strong>{tr("New Expense Voucher")}</strong> {tr("to record one.")}</td></tr>}
            {filtered.map((x) => (
              <tr key={x.id} className={x.status === 'void' ? 'opacity-50 line-through' : 'hover:bg-slate-50/70'}>
                <td className="p-3 font-mono font-bold text-blue-700">{x.voucher_number}<div className="text-[10px] text-slate-400 no-underline">{x.journal_voucher_number}</div></td>
                <td className="p-3 whitespace-nowrap">{x.expense_date}</td>
                <td className="p-3"><div className="font-semibold text-slate-800">{x.payee}</div>{x.description && <div className="text-slate-400">{x.description}</div>}</td>
                <td className="p-3">{accLabel(glAccounts, x.expense_account_code)}</td>
                <td className="p-3">{x.division}</td>
                <td className="p-3 text-end font-mono">{formatSAR(x.amount_sar)}</td>
                <td className="p-3 text-end font-mono">{formatSAR(x.vat_sar)}</td>
                <td className="p-3 text-end font-mono font-bold">{formatSAR(x.total_sar)}</td>
                <td className="p-3">{x.paid_from_account_code === '2010' ? 'On Credit (AP)' : accLabel(glAccounts, x.paid_from_account_code)}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${x.status === 'void' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>{x.status}</span></td>
                <td className="p-3">
                  {x.status !== 'void' && (
                    <button type="button" onClick={() => voidExpense(x)} disabled={saving} className="no-print text-rose-600 hover:text-rose-800 cursor-pointer" title={tr("Void with reversing journal")}>
                      <Ban className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title={tr("New Expense Voucher")} onClose={() => setShowModal(false)} wide>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={labelCls}>{tr("Date")}</label><input type="date" required className={inputCls} value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
              <div>
                <label className={labelCls}>{tr("Pick Vendor (optional)")}</label>
                <select
                  className={inputCls}
                  value={form.vendor_id}
                  onChange={(e) => {
                    const v = vendors.find((x) => x.id === e.target.value);
                    setForm({ ...form, vendor_id: e.target.value, payee: v ? v.name_en : form.payee });
                  }}
                >
                  <option value="">{tr("— Free-text payee —")}</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name_en}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2"><label className={labelCls}>{tr("Payee")}</label><input required className={inputCls} value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} placeholder={tr("e.g. Saudi Electricity Co.")} /></div>
              <div>
                <label className={labelCls}>{tr("Expense Account")}</label>
                <select className={inputCls} value={form.expense_account_code || expenseAccounts[0]?.account_code || ''} onChange={(e) => setForm({ ...form, expense_account_code: e.target.value })}>
                  {expenseAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name_en}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>{tr("Division")}</label>
                <select className={inputCls} value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })}>
                  <option value="Shared">{tr("Shared / Head Office")}</option><option value="MEP">{tr("MEP")}</option><option value="IT & ELV">{tr("IT & ELV")}</option>
                </select>
              </div>
              {projects.length > 0 && (
                <div>
                  <label className={labelCls}>{tr("Project (job cost)")}</label>
                  <select className={inputCls} value={form.project_id || ''} onChange={(e) => {
                    const pr = projects.find((x) => x.id === e.target.value);
                    setForm({ ...form, project_id: e.target.value, division: pr ? pr.division : form.division });
                  }}>
                    <option value="">{tr("— None —")}</option>
                    {projects.filter((x) => ['active', 'on_hold', 'completed'].includes(x.status)).map((x) => <option key={x.id} value={x.id}>{x.project_code} — {x.name}</option>)}
                  </select>
                </div>
              )}
              <div className="sm:col-span-2"><label className={labelCls}>{tr("Description")}</label><input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={tr("e.g. Office electricity — October")} /></div>
              <div><label className={labelCls}>{tr("Net Amount (SAR, excl. VAT)")}</label><input type="number" step="0.01" min="0" required className={inputCls} value={form.amount_sar} onChange={(e) => setForm({ ...form, amount_sar: e.target.value })} /></div>
              <div>
                <label className={labelCls}>{tr("Paid From")}</label>
                <select className={inputCls} value={form.paid_from_account_code} onChange={(e) => setForm({ ...form, paid_from_account_code: e.target.value })}>
                  {payFromOptions.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input type="checkbox" checked={form.vat_applied} onChange={(e) => setForm({ ...form, vat_applied: e.target.checked })} /> {tr("15% VAT charged on this bill")}
              </label>
              <label className={`flex items-center gap-2 text-xs font-semibold ${form.vat_applied ? 'text-slate-700' : 'text-slate-300'}`}>
                <input type="checkbox" disabled={!form.vat_applied} checked={form.vat_recoverable} onChange={(e) => setForm({ ...form, vat_recoverable: e.target.checked })} /> {tr("Input VAT recoverable (valid tax invoice)")}
              </label>
              <div className="sm:col-span-2"><label className={labelCls}>{tr("Payment Reference")}</label><input className={inputCls} value={form.payment_reference} onChange={(e) => setForm({ ...form, payment_reference: e.target.value })} placeholder={tr("Cheque / transfer / receipt #")} /></div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1">
              <div className="flex justify-between"><span>{tr("Net")}</span><span className="font-mono">{tr("SAR")}{" "}{formatSAR(net)}</span></div>
              <div className="flex justify-between"><span>{tr("VAT 15%")}</span><span className="font-mono">{tr("SAR")}{" "}{formatSAR(vat)}</span></div>
              <div className="flex justify-between font-bold border-t border-slate-200 pt-1"><span>{tr("Total Paid")}</span><span className="font-mono">{tr("SAR")}{" "}{formatSAR(total)}</span></div>
            </div>
            <button type="submit" disabled={saving} className={`${btnPrimary} w-full justify-center py-2.5`}>{saving ? tr('Posting…') : tr('Post Expense Voucher')}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Fixed Assets & Depreciation                                      */
/* ------------------------------------------------------------------ */
