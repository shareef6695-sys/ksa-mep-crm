// BankCashView (split from erp/FinanceSuiteViews.jsx, Prompt 15).
import { ArrowRightLeft, CheckCircle2, Download, Landmark, Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { downloadCsvFile } from '../../../erp/csvExport';
import { formatSAR } from '../../../erp/erpEngine';
import { Header, Modal, Notice, TabButton, accLabel, activeEntries, btnCsv, btnGhost, btnPrimary, cashAccountsOf, inputCls, isCashCode, labelCls, lockError, num, r2, rpcOrThrow, todayStr } from './shared';
import { tr } from '../../../ui/financeI18n';

export function BankCashView({ supabase, glAccounts = [], glEntries = [], bankReconciliations = [], profile, lockDate = '', onRefresh }) {
  const [tab, setTab] = useState('accounts'); // accounts | ledger | recon
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const cashAccounts = useMemo(() => cashAccountsOf(glAccounts, glEntries), [glAccounts, glEntries]);

  // All GL lines that hit cash/bank accounts, chronologically
  const cashLines = useMemo(() => {
    const rows = [];
    activeEntries(glEntries).forEach((e) =>
      (e.lines || []).forEach((l, idx) => {
        if (isCashCode(l.account_code)) {
          rows.push({
            key: `${e.id}:${idx}`,
            entryId: e.id,
            code: String(l.account_code),
            date: e.entry_date || String(e.created_at || '').slice(0, 10),
            voucher: e.voucher_number,
            description: e.description,
            memo: l.memo || '',
            source: e.source_module || 'MANUAL',
            debit: num(l.debit),
            credit: num(l.credit),
            createdAt: e.created_at || '',
          });
        }
      })
    );
    return rows.sort((a, b) => (a.date === b.date ? String(a.createdAt).localeCompare(String(b.createdAt)) : a.date.localeCompare(b.date)));
  }, [glEntries]);

  const balances = useMemo(() => {
    const b = {};
    cashAccounts.forEach((a) => (b[a.account_code] = 0));
    cashLines.forEach((l) => (b[l.code] = (b[l.code] || 0) + l.debit - l.credit));
    return b;
  }, [cashAccounts, cashLines]);
  const totalCash = Object.values(balances).reduce((s, v) => s + v, 0);

  /* ---------- Ledger ---------- */
  const [ledgerCode, setLedgerCode] = useState('');
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');
  const activeLedgerCode = ledgerCode || cashAccounts[0]?.account_code || '';

  const ledger = useMemo(() => {
    const lines = cashLines.filter((l) => l.code === activeLedgerCode);
    const opening = lines.filter((l) => ledgerFrom && l.date < ledgerFrom).reduce((s, l) => s + l.debit - l.credit, 0);
    let running = opening;
    const rows = lines
      .filter((l) => (!ledgerFrom || l.date >= ledgerFrom) && (!ledgerTo || l.date <= ledgerTo))
      .map((l) => {
        running += l.debit - l.credit;
        return { ...l, balance: running };
      });
    return { opening, rows, closing: running };
  }, [cashLines, activeLedgerCode, ledgerFrom, ledgerTo]);

  const exportLedger = () =>
    downloadCsvFile(
      `Cash_Ledger_${activeLedgerCode}_${todayStr()}.csv`,
      ['Date', 'Voucher', 'Description', 'Memo', 'Source', 'Debit (SAR)', 'Credit (SAR)', 'Balance (SAR)'],
      [
        ['', '', 'Opening Balance', '', '', '', '', ledger.opening.toFixed(2)],
        ...ledger.rows.map((r) => [r.date, r.voucher, r.description, r.memo, r.source, r.debit.toFixed(2), r.credit.toFixed(2), r.balance.toFixed(2)]),
      ]
    );

  /* ---------- Transfer ---------- */
  const [showTransfer, setShowTransfer] = useState(false);
  const [tf, setTf] = useState({ from: '', to: '', amount: '', date: todayStr(), ref: '' });

  const submitTransfer = async (e) => {
    e.preventDefault();
    const amount = r2(tf.amount);
    const from = tf.from || cashAccounts[0]?.account_code;
    const to = tf.to || cashAccounts[1]?.account_code;
    if (!from || !to || from === to) return setMsg({ type: 'error', text: tr('Choose two different cash/bank accounts.') });
    if (amount <= 0) return setMsg({ type: 'error', text: tr('Transfer amount must be greater than zero.') });
    const le = lockError(tf.date, lockDate);
    if (le) return setMsg({ type: 'error', text: le });
    setSaving(true);
    try {
      const jv = await rpcOrThrow(supabase, 'post_journal', {
        p_kind: 'BANK_TRANSFER',
        p_entry_date: tf.date,
        p_description: `Bank/Cash Transfer {doc}: ${accLabel(glAccounts, from)} → ${accLabel(glAccounts, to)}`,
        p_lines: [
          { account_code: to, debit: amount, credit: 0, memo: tf.ref || 'Transfer in' },
          { account_code: from, debit: 0, credit: amount, memo: tf.ref || 'Transfer out' },
        ],
      });
      const docNo = jv.source_doc_number;
      setMsg({ type: 'ok', text: `Transfer ${docNo} of SAR ${formatSAR(amount)} posted to the General Ledger.` });
      setShowTransfer(false);
      setTf({ from: '', to: '', amount: '', date: todayStr(), ref: '' });
      onRefresh && onRefresh();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setSaving(false);
  };

  /* ---------- Reconciliation ---------- */
  const [recCode, setRecCode] = useState('');
  const [recDate, setRecDate] = useState(todayStr());
  const [recBalance, setRecBalance] = useState('');
  const [ticked, setTicked] = useState({});
  const [chargeAmt, setChargeAmt] = useState('');
  const activeRecCode = recCode || cashAccounts.find((a) => a.account_code !== '1010')?.account_code || cashAccounts[0]?.account_code || '';

  const lockedKeys = useMemo(() => {
    const set = new Set();
    (bankReconciliations || [])
      .filter((r) => r.account_code === activeRecCode && r.status === 'completed')
      .forEach((r) => (Array.isArray(r.cleared_keys) ? r.cleared_keys : []).forEach((k) => set.add(k)));
    return set;
  }, [bankReconciliations, activeRecCode]);

  // Load an existing draft for this account when the account changes
  useEffect(() => {
    const draft = (bankReconciliations || [])
      .filter((r) => r.account_code === activeRecCode && r.status === 'draft')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    const next = {};
    if (draft) {
      (draft.cleared_keys || []).forEach((k) => (next[k] = true));
      setRecDate(draft.statement_date || todayStr());
      setRecBalance(String(draft.statement_balance ?? ''));
    }
    setTicked(next);
  }, [activeRecCode, bankReconciliations]);

  const recModel = useMemo(() => {
    const lines = cashLines.filter((l) => l.code === activeRecCode && l.date <= recDate);
    const isCleared = (k) => lockedKeys.has(k) || !!ticked[k];
    const book = lines.reduce((s, l) => s + l.debit - l.credit, 0);
    const cleared = lines.filter((l) => isCleared(l.key)).reduce((s, l) => s + l.debit - l.credit, 0);
    const uncleared = lines.filter((l) => !isCleared(l.key));
    const unclearedDeposits = uncleared.reduce((s, l) => s + l.debit, 0);
    const unclearedPayments = uncleared.reduce((s, l) => s + l.credit, 0);
    const stmt = num(recBalance);
    return { lines, book, cleared, unclearedDeposits, unclearedPayments, difference: r2(stmt - cleared), isCleared };
  }, [cashLines, activeRecCode, recDate, lockedKeys, ticked, recBalance]);

  const saveRecon = async (status) => {
    if (!activeRecCode) return;
    if (status === 'completed' && Math.abs(recModel.difference) >= 0.01) {
      return setMsg({ type: 'error', text: `Cannot complete: difference of SAR ${formatSAR(recModel.difference)} remains. Tick cleared items or post a bank charge adjustment.` });
    }
    setSaving(true);
    const keys = recModel.lines.filter((l) => !lockedKeys.has(l.key) && ticked[l.key]).map((l) => l.key);
    const existingDraft = (bankReconciliations || []).find((r) => r.account_code === activeRecCode && r.status === 'draft');
    const row = {
      id: existingDraft?.id || `brec-${Date.now()}`,
      account_code: activeRecCode,
      statement_date: recDate,
      statement_balance: r2(recBalance),
      cleared_keys: keys,
      book_balance: r2(recModel.book),
      difference: recModel.difference,
      status,
      reconciled_by: profile?.full_name || 'Finance',
    };
    const { error } = await supabase.from('bank_reconciliations').upsert(row);
    setSaving(false);
    if (error) return setMsg({ type: 'error', text: `Could not save reconciliation: ${error.message}` });
    setMsg({ type: 'ok', text: status === 'completed' ? `Reconciliation for ${accLabel(glAccounts, activeRecCode)} as of ${recDate} completed.` : 'Reconciliation draft saved.' });
    if (status === 'completed') setTicked({});
    onRefresh && onRefresh();
  };

  const postBankCharge = async () => {
    const amount = r2(chargeAmt);
    if (amount <= 0) return setMsg({ type: 'error', text: tr('Enter a bank charge amount greater than zero.') });
    const le = lockError(recDate, lockDate);
    if (le) return setMsg({ type: 'error', text: le });
    setSaving(true);
    try {
      const jv = await rpcOrThrow(supabase, 'post_journal', {
        p_kind: 'BANK_CHARGE',
        p_entry_date: recDate,
        p_description: `Bank charges per statement ${recDate} (${accLabel(glAccounts, activeRecCode)})`,
        p_lines: [
          { account_code: '5130', debit: amount, credit: 0, memo: 'Bank charges (reconciliation adjustment)' },
          { account_code: activeRecCode, debit: 0, credit: amount, memo: 'Bank charges' },
        ],
      });
      const docNo = jv.source_doc_number;
      setChargeAmt('');
      setMsg({ type: 'ok', text: `Bank charge ${docNo} of SAR ${formatSAR(amount)} posted. Tick it as cleared once it appears.` });
      onRefresh && onRefresh();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setSaving(false);
  };

  const recHistory = (bankReconciliations || [])
    .filter((r) => r.account_code === activeRecCode)
    .sort((a, b) => String(b.statement_date).localeCompare(String(a.statement_date)));

  return (
    <div className="space-y-4">
      <Header icon={Landmark} title={tr("Bank & Cash Management • إدارة البنوك والنقدية")} subtitle={tr("Live GL balances for every cash & bank account, account ledgers, inter-account transfers and bank statement reconciliation.")}>
        <button type="button" onClick={() => setShowTransfer(true)} className={btnPrimary} disabled={cashAccounts.length < 2}>
          <ArrowRightLeft className="w-4 h-4" /> {tr("Bank / Cash Transfer")}
        </button>
      </Header>

      <Notice msg={msg} onClear={() => setMsg(null)} />

      <div className="no-print flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <TabButton active={tab === 'accounts'} onClick={() => setTab('accounts')}>Accounts ({cashAccounts.length})</TabButton>
        <TabButton active={tab === 'ledger'} onClick={() => setTab('ledger')}>{tr("Account Ledger")}</TabButton>
        <TabButton active={tab === 'recon'} onClick={() => setTab('recon')}>{tr("Bank Reconciliation")}</TabButton>
      </div>

      {cashAccounts.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          {tr("No cash or bank accounts (codes 1010–1099) found in the Chart of Accounts. Add them under General Ledger → Chart of Accounts.")}
        </div>
      )}

      {tab === 'accounts' && cashAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cashAccounts.map((a) => (
              <button
                type="button"
                key={a.account_code}
                onClick={() => { setLedgerCode(a.account_code); setTab('ledger'); }}
                className="text-start bg-white border border-slate-200 hover:border-blue-400 rounded-2xl p-4 shadow-sm cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{a.account_code}</span>
                  <Landmark className="w-4 h-4 text-slate-400" />
                </div>
                <div className="mt-2 text-sm font-bold text-slate-900">{a.account_name_en}</div>
                {a.account_name_ar && <div className="text-xs text-slate-500">{a.account_name_ar}</div>}
                <div className={`mt-3 text-lg font-mono font-bold ${(balances[a.account_code] || 0) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  SAR {formatSAR(balances[a.account_code] || 0)}
                </div>
              </button>
            ))}
          </div>
          <div className="bg-slate-900 text-white rounded-2xl px-5 py-4 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide">{tr("Total Cash & Bank Liquidity • إجمالي السيولة")}</span>
            <span className="font-mono font-bold text-lg text-emerald-400">{tr("SAR")}{" "}{formatSAR(totalCash)}</span>
          </div>
        </div>
      )}

      {tab === 'ledger' && cashAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="no-print flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-2xl p-4">
            <div className="min-w-[220px]">
              <label className={labelCls}>{tr("Account")}</label>
              <select className={inputCls} value={activeLedgerCode} onChange={(e) => setLedgerCode(e.target.value)}>
                {cashAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name_en}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>{tr("From")}</label><input type="date" className={inputCls} value={ledgerFrom} onChange={(e) => setLedgerFrom(e.target.value)} /></div>
            <div><label className={labelCls}>{tr("To")}</label><input type="date" className={inputCls} value={ledgerTo} onChange={(e) => setLedgerTo(e.target.value)} /></div>
            <button type="button" onClick={exportLedger} className={btnCsv}><Download className="w-4 h-4" /> {tr("Export CSV")}</button>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
            <table className="w-full text-start text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3">{tr("Date")}</th><th className="p-3">{tr("Voucher")}</th><th className="p-3">{tr("Description")}</th><th className="p-3">{tr("Source")}</th>
                  <th className="p-3 text-end">{tr("Debit (In)")}</th><th className="p-3 text-end">{tr("Credit (Out)")}</th><th className="p-3 text-end">{tr("Balance")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-slate-50/60 font-semibold">
                  <td className="p-3" colSpan={6}>{tr("Opening Balance")}</td>
                  <td className="p-3 text-end font-mono">{formatSAR(ledger.opening)}</td>
                </tr>
                {ledger.rows.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-slate-400">{tr("No transactions in this period.")}</td></tr>
                )}
                {ledger.rows.map((r) => (
                  <tr key={r.key} className="hover:bg-slate-50/70">
                    <td className="p-3 whitespace-nowrap">{r.date}</td>
                    <td className="p-3 font-mono text-blue-700">{r.voucher}</td>
                    <td className="p-3"><div className="font-semibold text-slate-800">{r.description}</div>{r.memo && <div className="text-slate-400">{r.memo}</div>}</td>
                    <td className="p-3"><span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold">{r.source}</span></td>
                    <td className="p-3 text-end font-mono text-emerald-700">{r.debit > 0 ? formatSAR(r.debit) : '—'}</td>
                    <td className="p-3 text-end font-mono text-rose-600">{r.credit > 0 ? formatSAR(r.credit) : '—'}</td>
                    <td className="p-3 text-end font-mono font-bold">{formatSAR(r.balance)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-900 text-white font-bold">
                  <td className="p-3" colSpan={6}>{tr("Closing Balance")}</td>
                  <td className="p-3 text-end font-mono text-emerald-400">{tr("SAR")}{" "}{formatSAR(ledger.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'recon' && cashAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="no-print grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white border border-slate-200 rounded-2xl p-4">
            <div>
              <label className={labelCls}>{tr("Bank Account")}</label>
              <select className={inputCls} value={activeRecCode} onChange={(e) => setRecCode(e.target.value)}>
                {cashAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name_en}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>{tr("Statement Date")}</label><input type="date" className={inputCls} value={recDate} onChange={(e) => setRecDate(e.target.value)} /></div>
            <div><label className={labelCls}>{tr("Statement Ending Balance (SAR)")}</label><input type="number" step="0.01" className={inputCls} value={recBalance} onChange={(e) => setRecBalance(e.target.value)} placeholder="0.00" /></div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              ['Book Balance (GL)', recModel.book, 'text-slate-900'],
              ['Cleared Balance', recModel.cleared, 'text-blue-700'],
              ['Uncleared Deposits', recModel.unclearedDeposits, 'text-emerald-700'],
              ['Uncleared Payments', recModel.unclearedPayments, 'text-rose-600'],
              ['Difference', recModel.difference, Math.abs(recModel.difference) < 0.01 ? 'text-emerald-700' : 'text-amber-600'],
            ].map(([label, val, cls]) => (
              <div key={label} className="bg-white border border-slate-200 rounded-2xl p-3.5">
                <div className="text-[11px] font-semibold text-slate-500">{label}</div>
                <div className={`mt-1 font-mono font-bold text-sm ${cls}`}>SAR {formatSAR(val)}</div>
              </div>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
            <table className="w-full text-start text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3 w-10">{tr("Cleared")}</th><th className="p-3">{tr("Date")}</th><th className="p-3">{tr("Voucher")}</th><th className="p-3">{tr("Description")}</th>
                  <th className="p-3 text-end">{tr("Deposit")}</th><th className="p-3 text-end">{tr("Payment")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recModel.lines.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-400">{tr("No GL lines for this account up to the statement date.")}</td></tr>}
                {recModel.lines.map((l) => {
                  const locked = lockedKeys.has(l.key);
                  return (
                    <tr key={l.key} className={recModel.isCleared(l.key) ? 'bg-emerald-50/40' : ''}>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={recModel.isCleared(l.key)}
                          onChange={(e) => setTicked({ ...ticked, [l.key]: e.target.checked })}
                          title={locked ? 'Cleared in a completed reconciliation' : 'Mark as cleared on the bank statement'}
                        />
                      </td>
                      <td className="p-3 whitespace-nowrap">{l.date}</td>
                      <td className="p-3 font-mono text-blue-700">{l.voucher}{locked && <Lock className="inline w-3 h-3 ml-1 text-slate-400" />}</td>
                      <td className="p-3">{l.description}</td>
                      <td className="p-3 text-end font-mono text-emerald-700">{l.debit > 0 ? formatSAR(l.debit) : '—'}</td>
                      <td className="p-3 text-end font-mono text-rose-600">{l.credit > 0 ? formatSAR(l.credit) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="no-print flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-end gap-2">
              <div>
                <label className={labelCls}>{tr("Bank charges on statement (SAR)")}</label>
                <input type="number" step="0.01" className={inputCls} value={chargeAmt} onChange={(e) => setChargeAmt(e.target.value)} placeholder="0.00" />
              </div>
              <button type="button" onClick={postBankCharge} disabled={saving} className={btnGhost}>{tr("Post Bank Charge (Dr 5130)")}</button>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => saveRecon('draft')} disabled={saving} className={btnGhost}>{tr("Save Draft")}</button>
              <button type="button" onClick={() => saveRecon('completed')} disabled={saving} className={btnPrimary}><CheckCircle2 className="w-4 h-4" /> {tr("Complete Reconciliation")}</button>
            </div>
          </div>

          {recHistory.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <h4 className="text-xs font-bold text-slate-700 mb-2">{tr("Reconciliation History —")}{" "}{accLabel(glAccounts, activeRecCode)}</h4>
              <table className="w-full text-xs">
                <thead className="text-slate-400 border-b border-slate-100">
                  <tr><th className="py-1 text-start">{tr("Statement Date")}</th><th className="py-1 text-end">{tr("Statement Bal.")}</th><th className="py-1 text-end">{tr("Book Bal.")}</th><th className="py-1 text-end">{tr("Difference")}</th><th className="py-1 text-start pl-3">{tr("Status")}</th><th className="py-1 text-start">{tr("By")}</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {recHistory.map((r) => (
                    <tr key={r.id}>
                      <td className="py-1.5">{r.statement_date}</td>
                      <td className="py-1.5 text-end font-mono">{formatSAR(r.statement_balance)}</td>
                      <td className="py-1.5 text-end font-mono">{formatSAR(r.book_balance)}</td>
                      <td className="py-1.5 text-end font-mono">{formatSAR(r.difference)}</td>
                      <td className="py-1.5 pl-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{r.status}</span></td>
                      <td className="py-1.5">{r.reconciled_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showTransfer && (
        <Modal title={tr("Bank / Cash Transfer")} onClose={() => setShowTransfer(false)}>
          <form onSubmit={submitTransfer} className="space-y-3">
            <div>
              <label className={labelCls}>{tr("From Account (Credit)")}</label>
              <select className={inputCls} value={tf.from || cashAccounts[0]?.account_code || ''} onChange={(e) => setTf({ ...tf, from: e.target.value })}>
                {cashAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name_en} (SAR {formatSAR(balances[a.account_code] || 0)})</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>{tr("To Account (Debit)")}</label>
              <select className={inputCls} value={tf.to || cashAccounts[1]?.account_code || ''} onChange={(e) => setTf({ ...tf, to: e.target.value })}>
                {cashAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name_en}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>{tr("Amount (SAR)")}</label><input type="number" step="0.01" min="0" required className={inputCls} value={tf.amount} onChange={(e) => setTf({ ...tf, amount: e.target.value })} /></div>
              <div><label className={labelCls}>{tr("Date")}</label><input type="date" required className={inputCls} value={tf.date} onChange={(e) => setTf({ ...tf, date: e.target.value })} /></div>
            </div>
            <div><label className={labelCls}>{tr("Reference / Memo")}</label><input className={inputCls} value={tf.ref} onChange={(e) => setTf({ ...tf, ref: e.target.value })} placeholder={tr("e.g. Cash deposit slip #123")} /></div>
            <button type="submit" disabled={saving} className={`${btnPrimary} w-full justify-center py-2.5`}>{saving ? tr('Posting…') : tr('Post Transfer to GL')}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Expense Vouchers                                                 */
/* ------------------------------------------------------------------ */
