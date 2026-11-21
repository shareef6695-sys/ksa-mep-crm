import React, { useState, useMemo } from 'react';
import { BookOpen, Plus, Trash2, CheckCircle2, AlertTriangle, X, Scale } from 'lucide-react';
import { formatSAR } from './erpEngine';
import { downloadCsvFile } from './csvExport';

export function GeneralLedgerView({
  supabase,
  glAccounts,
  glEntries,
  profile,
  onRefresh,
}) {
  const [tab, setTab] = useState('journals'); // journals | coa | trial
  const [showJvModal, setShowJvModal] = useState(false);
  const [showCoaModal, setShowCoaModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Manual Journal Voucher Form
  const [jvForm, setJvForm] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    reference: '',
    description: '',
    lines: [
      { account_code: '5100', debit: '', credit: '', memo: '' },
      { account_code: '1020', debit: '', credit: '', memo: '' },
    ],
  });

  // New GL Account Form
  const [coaForm, setCoaForm] = useState({
    account_code: '',
    account_name_en: '',
    account_name_ar: '',
    account_type: 'Expense',
    normal_balance: 'Debit',
  });

  const jvTotals = useMemo(() => {
    const dr = jvForm.lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
    const cr = jvForm.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
    const diff = Number((dr - cr).toFixed(2));
    return { dr: Number(dr.toFixed(2)), cr: Number(cr.toFixed(2)), diff, isBalanced: dr > 0 && Math.abs(diff) < 0.005 };
  }, [jvForm.lines]);

  const updateLine = (idx, field, val) => {
    const next = [...jvForm.lines];
    next[idx] = { ...next[idx], [field]: val };
    if (field === 'debit' && parseFloat(val) > 0) next[idx].credit = '';
    if (field === 'credit' && parseFloat(val) > 0) next[idx].debit = '';
    setJvForm({ ...jvForm, lines: next });
  };

  const addLine = () => {
    setJvForm({
      ...jvForm,
      lines: [...jvForm.lines, { account_code: glAccounts[0]?.account_code || '1020', debit: '', credit: '', memo: '' }],
    });
  };

  const removeLine = (idx) => {
    if (jvForm.lines.length <= 2) return;
    setJvForm({ ...jvForm, lines: jvForm.lines.filter((_, i) => i !== idx) });
  };

  const handlePostJournal = async (e) => {
    e.preventDefault();
    if (!jvTotals.isBalanced) return;
    setSaving(true);

    try {
      const { data: jvNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'JOURNAL' });
      const cleanLines = jvForm.lines
        .filter((l) => (parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0)
        .map((l) => {
          const acc = glAccounts.find((a) => a.account_code === l.account_code);
          return {
            account_code: l.account_code,
            account_name: acc ? `${acc.account_code} - ${acc.account_name_en}` : l.account_code,
            debit: Number((parseFloat(l.debit) || 0).toFixed(2)),
            credit: Number((parseFloat(l.credit) || 0).toFixed(2)),
            memo: l.memo || '',
          };
        });

      await supabase.from('gl_journal_entries').insert({
        id: `jv-${Date.now()}`,
        voucher_number: jvNum,
        entry_date: jvForm.entry_date,
        reference: jvForm.reference,
        description: jvForm.description,
        lines: cleanLines,
        total_debit_sar: jvTotals.dr,
        total_credit_sar: jvTotals.cr,
        status: 'posted',
        posted_by: profile?.full_name || 'Accountant',
      });

      setShowJvModal(false);
      setJvForm({
        entry_date: new Date().toISOString().slice(0, 10),
        reference: '',
        description: '',
        lines: [
          { account_code: '5100', debit: '', credit: '', memo: '' },
          { account_code: '1020', debit: '', credit: '', memo: '' },
        ],
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAccount = async (e) => {
    e.preventDefault();
    if (!coaForm.account_code.trim() || !coaForm.account_name_en.trim()) return;
    setSaving(true);

    try {
      await supabase.from('gl_accounts').insert({
        account_code: coaForm.account_code.trim(),
        account_name_en: coaForm.account_name_en.trim(),
        account_name_ar: coaForm.account_name_ar.trim(),
        account_type: coaForm.account_type,
        normal_balance: ['Asset', 'Expense'].includes(coaForm.account_type) ? 'Debit' : 'Credit',
        is_system: false,
        is_active: true,
      });

      setShowCoaModal(false);
      setCoaForm({
        account_code: '',
        account_name_en: '',
        account_name_ar: '',
        account_type: 'Expense',
        normal_balance: 'Debit',
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  // Compute Trial Balance across all posted GL Journal Vouchers
  const trialBalance = useMemo(() => {
    const map = {};
    glAccounts.forEach((a) => {
      map[a.account_code] = { ...a, totalDr: 0, totalCr: 0 };
    });

    glEntries.forEach((entry) => {
      (entry.lines || []).forEach((l) => {
        if (!map[l.account_code]) {
          map[l.account_code] = {
            account_code: l.account_code,
            account_name_en: l.account_name,
            account_type: 'Other',
            totalDr: 0,
            totalCr: 0,
          };
        }
        map[l.account_code].totalDr += Number(l.debit || 0);
        map[l.account_code].totalCr += Number(l.credit || 0);
      });
    });

    const rows = Object.values(map).sort((a, b) => a.account_code.localeCompare(b.account_code));
    const grandDr = rows.reduce((s, r) => s + r.totalDr, 0);
    const grandCr = rows.reduce((s, r) => s + r.totalCr, 0);
    return { rows, grandDr, grandCr };
  }, [glAccounts, glEntries]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">General Ledger, Chart of Accounts &amp; Manual Journal Vouchers</h2>
          <p className="text-xs text-slate-500">
            Create custom GL accounts and post balanced double-entry Journal Vouchers (Opening Balances, Salaries, Rent, Bank Fees, VAT Remittance).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCoaModal(true)}
            className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> New GL Account
          </button>
          <button
            onClick={() => setShowJvModal(true)}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Post Manual Journal (JV)
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setTab('journals')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
            tab === 'journals' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'
          }`}
        >
          Journal Vouchers ({glEntries.length})
        </button>
        <button
          onClick={() => setTab('coa')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
            tab === 'coa' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'
          }`}
        >
          Chart of Accounts ({glAccounts.length})
        </button>
        <button
          onClick={() => setTab('trial')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
            tab === 'trial' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'
          }`}
        >
          Trial Balance (GL)
        </button>
      </div>

      {/* TAB 1: JOURNAL VOUCHERS LIST */}
      {tab === 'journals' && (
        <div className="space-y-3">
          {glEntries.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
              No Manual Journal Vouchers posted yet. Click <strong>Post Manual Journal (JV)</strong> to enter opening balances or operating expenses.
            </div>
          ) : (
            glEntries.map((jv) => (
              <div key={jv.id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded">
                        {jv.voucher_number}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">{jv.entry_date}</span>
                      {jv.reference && <span className="text-xs bg-slate-100 px-2 py-0.5 rounded">Ref: {jv.reference}</span>}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 mt-1">{jv.description}</h3>
                  </div>
                  <div className="text-right text-xs">
                    <div className="text-slate-400">Posted by {jv.posted_by}</div>
                    <div className="font-bold text-emerald-700">Balanced: SAR {formatSAR(jv.total_debit_sar)}</div>
                  </div>
                </div>

                <table className="w-full text-xs">
                  <thead className="text-slate-400 border-b border-slate-100">
                    <tr>
                      <th className="py-1 text-left">Account</th>
                      <th className="py-1 text-left">Line Memo</th>
                      <th className="py-1 text-right">Debit (SAR)</th>
                      <th className="py-1 text-right">Credit (SAR)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {(jv.lines || []).map((l, idx) => (
                      <tr key={idx}>
                        <td className="py-1.5 font-semibold text-slate-800">{l.account_name}</td>
                        <td className="py-1.5 text-slate-500">{l.memo || '—'}</td>
                        <td className="py-1.5 text-right font-mono">{Number(l.debit) > 0 ? formatSAR(l.debit) : '—'}</td>
                        <td className="py-1.5 text-right font-mono">{Number(l.credit) > 0 ? formatSAR(l.credit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 2: CHART OF ACCOUNTS */}
      {tab === 'coa' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-3">Code</th>
                <th className="p-3">Account Name (English)</th>
                <th className="p-3">Account Name (Arabic)</th>
                <th className="p-3">Category</th>
                <th className="p-3">Normal Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {glAccounts.map((acc) => (
                <tr key={acc.account_code} className="hover:bg-slate-50/70">
                  <td className="p-3 font-mono font-bold text-blue-700">{acc.account_code}</td>
                  <td className="p-3 font-bold text-slate-900">{acc.account_name_en}</td>
                  <td className="p-3 text-slate-600">{acc.account_name_ar || '—'}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded bg-slate-100 font-semibold text-[11px]">{acc.account_type}</span>
                  </td>
                  <td className="p-3 font-semibold text-slate-600">{acc.normal_balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 3: TRIAL BALANCE */}
      {tab === 'trial' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => downloadCsvFile(`Trial_Balance_${new Date().toISOString().slice(0, 10)}.csv`, ['Account Code', 'Account Name', 'Type', 'Total Debit (SAR)', 'Total Credit (SAR)', 'Net Balance (SAR)'], [...trialBalance.rows.map((r) => [r.account_code, r.account_name_en, r.account_type, r.totalDr.toFixed(2), r.totalCr.toFixed(2), (r.totalDr - r.totalCr).toFixed(2)]), ['', 'TRIAL BALANCE TOTALS', '', trialBalance.grandDr.toFixed(2), trialBalance.grandCr.toFixed(2), (trialBalance.grandDr - trialBalance.grandCr).toFixed(2)]])} className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold cursor-pointer">Export Trial Balance (Excel / CSV)</button>
          </div>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-3">Code</th>
                <th className="p-3">GL Account</th>
                <th className="p-3">Type</th>
                <th className="p-3 text-right">Total Debit (SAR)</th>
                <th className="p-3 text-right">Total Credit (SAR)</th>
                <th className="p-3 text-right">Net Balance (SAR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {trialBalance.rows.map((r) => {
                const net = r.totalDr - r.totalCr;
                return (
                  <tr key={r.account_code} className="hover:bg-slate-50/70">
                    <td className="p-3 font-mono font-bold text-blue-700">{r.account_code}</td>
                    <td className="p-3 font-semibold text-slate-900">{r.account_name_en}</td>
                    <td className="p-3 text-slate-500">{r.account_type}</td>
                    <td className="p-3 text-right font-mono">{formatSAR(r.totalDr)}</td>
                    <td className="p-3 text-right font-mono">{formatSAR(r.totalCr)}</td>
                    <td className="p-3 text-right font-mono font-bold">
                      {net >= 0 ? `Dr ${formatSAR(net)}` : `Cr ${formatSAR(Math.abs(net))}`}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-slate-900 text-white font-bold">
                <td className="p-3" colSpan={3}>TRIAL BALANCE TOTALS</td>
                <td className="p-3 text-right font-mono">SAR {formatSAR(trialBalance.grandDr)}</td>
                <td className="p-3 text-right font-mono">SAR {formatSAR(trialBalance.grandCr)}</td>
                <td className="p-3 text-right text-emerald-400">
                  {Math.abs(trialBalance.grandDr - trialBalance.grandCr) < 0.01 ? 'IN BALANCE' : 'OUT OF BALANCE'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* MODAL: CREATE NEW GL ACCOUNT */}
      {showCoaModal && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">Create Custom GL Account</h3>
              <button onClick={() => setShowCoaModal(false)}><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleCreateAccount} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Account Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 5150"
                    value={coaForm.account_code}
                    onChange={(e) => setCoaForm({ ...coaForm, account_code: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Account Category *</label>
                  <select
                    value={coaForm.account_type}
                    onChange={(e) => setCoaForm({ ...coaForm, account_type: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 bg-white font-semibold"
                  >
                    <option value="Asset">Asset (1xxx)</option>
                    <option value="Liability">Liability (2xxx)</option>
                    <option value="Equity">Equity (3xxx)</option>
                    <option value="Revenue">Revenue (4xxx)</option>
                    <option value="Expense">Expense (5xxx)</option>
                  </select>
                </div>
              </div>

              <input
                type="text"
                required
                placeholder="Account Name (English) * e.g. Marketing & Exhibitions"
                value={coaForm.account_name_en}
                onChange={(e) => setCoaForm({ ...coaForm, account_name_en: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5"
              />
              <input
                type="text"
                placeholder="Account Name (Arabic) e.g. مصاريف التسويق والمعارض"
                value={coaForm.account_name_ar}
                onChange={(e) => setCoaForm({ ...coaForm, account_name_ar: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5"
              />

              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer"
              >
                {saving ? 'Saving Account...' : 'Add to Chart of Accounts'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: POST MANUAL DOUBLE-ENTRY JOURNAL VOUCHER */}
      {showJvModal && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Scale className="w-4 h-4 text-blue-600" /> Post Manual Journal Voucher (Double-Entry)
              </h3>
              <button onClick={() => setShowJvModal(false)}><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handlePostJournal} className="space-y-3 text-xs">
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Posting Date *</label>
                  <input
                    type="date"
                    required
                    value={jvForm.entry_date}
                    onChange={(e) => setJvForm({ ...jvForm, entry_date: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Reference / Doc #</label>
                  <input
                    type="text"
                    placeholder="e.g. SADAD-VAT-Q3 / PAYROLL-NOV"
                    value={jvForm.reference}
                    onChange={(e) => setJvForm({ ...jvForm, reference: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Narration / Description *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Nov 2026 Staff Salaries & GOSI"
                    value={jvForm.description}
                    onChange={(e) => setJvForm({ ...jvForm, description: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700">Journal Lines (Debit must equal Credit)</span>
                  <button
                    type="button"
                    onClick={addLine}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold text-slate-800 cursor-pointer"
                  >
                    + Add Line
                  </button>
                </div>

                {jvForm.lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded-xl border border-slate-200">
                    <select
                      value={line.account_code}
                      onChange={(e) => updateLine(idx, 'account_code', e.target.value)}
                      className="col-span-5 border border-slate-300 rounded-lg px-2 py-1.5 bg-white font-semibold"
                    >
                      {glAccounts.map((acc) => (
                        <option key={acc.account_code} value={acc.account_code}>
                          {acc.account_code} — {acc.account_name_en}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Line memo"
                      value={line.memo}
                      onChange={(e) => updateLine(idx, 'memo', e.target.value)}
                      className="col-span-3 border border-slate-300 rounded-lg px-2 py-1.5 bg-white"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Debit SAR"
                      value={line.debit}
                      onChange={(e) => updateLine(idx, 'debit', e.target.value)}
                      className="col-span-2 border border-slate-300 rounded-lg px-2 py-1.5 text-right font-mono font-bold bg-white"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Credit SAR"
                      value={line.credit}
                      onChange={(e) => updateLine(idx, 'credit', e.target.value)}
                      className="col-span-2 border border-slate-300 rounded-lg px-2 py-1.5 text-right font-mono font-bold bg-white"
                    />
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-900 text-white font-mono text-xs">
                <div>Total Debit: <strong>SAR {formatSAR(jvTotals.dr)}</strong></div>
                <div>Total Credit: <strong>SAR {formatSAR(jvTotals.cr)}</strong></div>
                <div className={jvTotals.isBalanced ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {jvTotals.isBalanced ? 'BALANCED (READY TO POST)' : `Difference: SAR ${formatSAR(Math.abs(jvTotals.diff))}`}
                </div>
              </div>

              <button
                type="submit"
                disabled={saving || !jvTotals.isBalanced}
                className="w-full py-3 rounded-xl bg-blue-600 disabled:bg-slate-300 text-white font-semibold cursor-pointer"
              >
                {saving ? 'Posting Journal Voucher...' : 'Post Balanced Journal Voucher to GL'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}