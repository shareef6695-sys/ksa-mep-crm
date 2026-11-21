import React, { useState, useMemo, useEffect } from 'react';
import {
  Landmark, ArrowRightLeft, Plus, X, CheckCircle2, AlertTriangle, Receipt, Ban,
  Building, Calculator, Target, Printer, Download, Lock, Unlock, CalendarCheck, FileText, Scale,
} from 'lucide-react';
import { formatSAR } from './erpEngine';
import { downloadCsvFile } from './csvExport';
import { postAutoJournal } from './glEngine';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const todayStr = () => new Date().toISOString().slice(0, 10);
const r2 = (n) => Number((Number(n) || 0).toFixed(2));
const num = (v) => Number(v) || 0;

const isCashCode = (code) => {
  const c = String(code || '');
  return c.length === 4 && c >= '1010' && c <= '1099';
};

const accLabel = (glAccounts, code) => {
  const acc = (glAccounts || []).find((a) => a.account_code === String(code));
  return acc ? `${acc.account_code} - ${acc.account_name_en}` : String(code);
};

const activeEntries = (glEntries) => (glEntries || []).filter((e) => e.status !== 'void');

const lockError = (date, lockDate) => {
  if (!date) return 'Please choose an entry date.';
  if (lockDate && date <= lockDate) {
    return `The accounting period is locked up to ${lockDate}. Choose a date after ${lockDate} or ask Finance/Admin to change the period lock.`;
  }
  return '';
};

const nextDocNumber = async (supabase, docType, fallbackPrefix) => {
  try {
    const { data } = await supabase.rpc('next_doc_number', { p_doc_type: docType });
    if (data) return data;
  } catch (_e) {
    // fall through to fallback
  }
  return `${fallbackPrefix}-${Date.now().toString().slice(-6)}`;
};

const postJournalOrThrow = async (args) => {
  const jv = await postAutoJournal(args);
  if (!jv) throw new Error('Journal could not be posted: the entry is unbalanced or zero, or the GL table is unavailable.');
  return jv;
};

const canManageFinance = (profile) =>
  ['admin', 'ceo', 'finance', 'manager'].includes(String(profile?.role_key || '').toLowerCase()) ||
  ['Admin', 'CEO', 'Finance'].includes(profile?.role);

const monthKey = (dateStr) => String(dateStr || '').slice(0, 7);
const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const lastDayOfMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${ym}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const inputCls = 'w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'block text-[11px] font-semibold text-slate-600 mb-1';
const btnPrimary = 'px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50';
const btnDark = 'px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50';
const btnGhost = 'px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50';
const btnCsv = 'px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer';

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4 no-print">
      <div className={`bg-white rounded-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} p-6 space-y-4 max-h-[92vh] overflow-y-auto`}>
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="font-bold text-base text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Notice({ msg, onClear }) {
  if (!msg) return null;
  const isErr = msg.type === 'error';
  return (
    <div className={`no-print flex items-start justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs font-semibold ${isErr ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
      <span className="flex items-center gap-2">
        {isErr ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
        {msg.text}
      </span>
      {onClear && <button type="button" onClick={onClear} className="cursor-pointer"><X className="w-4 h-4" /></button>}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${active ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
    >
      {children}
    </button>
  );
}

function Header({ icon: Icon, title, subtitle, children }) {
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-start gap-2.5">
        {Icon && <Icon className="w-5 h-5 text-blue-600 mt-0.5" />}
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

const cashAccountsOf = (glAccounts, glEntries) => {
  const map = {};
  (glAccounts || []).forEach((a) => {
    if (a.account_type === 'Asset' && isCashCode(a.account_code)) map[a.account_code] = a;
  });
  activeEntries(glEntries).forEach((e) =>
    (e.lines || []).forEach((l) => {
      if (isCashCode(l.account_code) && !map[l.account_code]) {
        map[l.account_code] = { account_code: l.account_code, account_name_en: l.account_name || l.account_code, account_type: 'Asset' };
      }
    })
  );
  return Object.values(map).sort((a, b) => a.account_code.localeCompare(b.account_code));
};

/* ------------------------------------------------------------------ */
/* 1. Bank & Cash Management                                           */
/* ------------------------------------------------------------------ */

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
    if (!from || !to || from === to) return setMsg({ type: 'error', text: 'Choose two different cash/bank accounts.' });
    if (amount <= 0) return setMsg({ type: 'error', text: 'Transfer amount must be greater than zero.' });
    const le = lockError(tf.date, lockDate);
    if (le) return setMsg({ type: 'error', text: le });
    setSaving(true);
    try {
      const docNo = await nextDocNumber(supabase, 'BANK_TXN', 'BT');
      await postJournalOrThrow({
        supabase,
        entryDate: tf.date,
        sourceModule: 'BANK_TRANSFER',
        sourceDocNumber: docNo,
        description: `Bank/Cash Transfer ${docNo}: ${accLabel(glAccounts, from)} → ${accLabel(glAccounts, to)}`,
        postedBy: profile?.full_name || 'Finance',
        lines: [
          { account_code: to, account_name: accLabel(glAccounts, to), debit: amount, credit: 0, memo: tf.ref || 'Transfer in' },
          { account_code: from, account_name: accLabel(glAccounts, from), debit: 0, credit: amount, memo: tf.ref || 'Transfer out' },
        ],
      });
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
    if (amount <= 0) return setMsg({ type: 'error', text: 'Enter a bank charge amount greater than zero.' });
    const le = lockError(recDate, lockDate);
    if (le) return setMsg({ type: 'error', text: le });
    setSaving(true);
    try {
      const docNo = await nextDocNumber(supabase, 'BANK_TXN', 'BT');
      await postJournalOrThrow({
        supabase,
        entryDate: recDate,
        sourceModule: 'BANK_CHARGE',
        sourceDocNumber: docNo,
        description: `Bank charges per statement ${recDate} (${accLabel(glAccounts, activeRecCode)})`,
        postedBy: profile?.full_name || 'Finance',
        lines: [
          { account_code: '5130', account_name: accLabel(glAccounts, '5130'), debit: amount, credit: 0, memo: 'Bank charges (reconciliation adjustment)' },
          { account_code: activeRecCode, account_name: accLabel(glAccounts, activeRecCode), debit: 0, credit: amount, memo: 'Bank charges' },
        ],
      });
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
      <Header icon={Landmark} title="Bank & Cash Management • إدارة البنوك والنقدية" subtitle="Live GL balances for every cash & bank account, account ledgers, inter-account transfers and bank statement reconciliation.">
        <button type="button" onClick={() => setShowTransfer(true)} className={btnPrimary} disabled={cashAccounts.length < 2}>
          <ArrowRightLeft className="w-4 h-4" /> Bank / Cash Transfer
        </button>
      </Header>

      <Notice msg={msg} onClear={() => setMsg(null)} />

      <div className="no-print flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <TabButton active={tab === 'accounts'} onClick={() => setTab('accounts')}>Accounts ({cashAccounts.length})</TabButton>
        <TabButton active={tab === 'ledger'} onClick={() => setTab('ledger')}>Account Ledger</TabButton>
        <TabButton active={tab === 'recon'} onClick={() => setTab('recon')}>Bank Reconciliation</TabButton>
      </div>

      {cashAccounts.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          No cash or bank accounts (codes 1010–1099) found in the Chart of Accounts. Add them under General Ledger → Chart of Accounts.
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
                className="text-left bg-white border border-slate-200 hover:border-blue-400 rounded-2xl p-4 shadow-sm cursor-pointer"
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
            <span className="text-xs font-semibold uppercase tracking-wide">Total Cash & Bank Liquidity • إجمالي السيولة</span>
            <span className="font-mono font-bold text-lg text-emerald-400">SAR {formatSAR(totalCash)}</span>
          </div>
        </div>
      )}

      {tab === 'ledger' && cashAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="no-print flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-2xl p-4">
            <div className="min-w-[220px]">
              <label className={labelCls}>Account</label>
              <select className={inputCls} value={activeLedgerCode} onChange={(e) => setLedgerCode(e.target.value)}>
                {cashAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name_en}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>From</label><input type="date" className={inputCls} value={ledgerFrom} onChange={(e) => setLedgerFrom(e.target.value)} /></div>
            <div><label className={labelCls}>To</label><input type="date" className={inputCls} value={ledgerTo} onChange={(e) => setLedgerTo(e.target.value)} /></div>
            <button type="button" onClick={exportLedger} className={btnCsv}><Download className="w-4 h-4" /> Export CSV</button>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3">Date</th><th className="p-3">Voucher</th><th className="p-3">Description</th><th className="p-3">Source</th>
                  <th className="p-3 text-right">Debit (In)</th><th className="p-3 text-right">Credit (Out)</th><th className="p-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-slate-50/60 font-semibold">
                  <td className="p-3" colSpan={6}>Opening Balance</td>
                  <td className="p-3 text-right font-mono">{formatSAR(ledger.opening)}</td>
                </tr>
                {ledger.rows.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-slate-400">No transactions in this period.</td></tr>
                )}
                {ledger.rows.map((r) => (
                  <tr key={r.key} className="hover:bg-slate-50/70">
                    <td className="p-3 whitespace-nowrap">{r.date}</td>
                    <td className="p-3 font-mono text-blue-700">{r.voucher}</td>
                    <td className="p-3"><div className="font-semibold text-slate-800">{r.description}</div>{r.memo && <div className="text-slate-400">{r.memo}</div>}</td>
                    <td className="p-3"><span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold">{r.source}</span></td>
                    <td className="p-3 text-right font-mono text-emerald-700">{r.debit > 0 ? formatSAR(r.debit) : '—'}</td>
                    <td className="p-3 text-right font-mono text-rose-600">{r.credit > 0 ? formatSAR(r.credit) : '—'}</td>
                    <td className="p-3 text-right font-mono font-bold">{formatSAR(r.balance)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-900 text-white font-bold">
                  <td className="p-3" colSpan={6}>Closing Balance</td>
                  <td className="p-3 text-right font-mono text-emerald-400">SAR {formatSAR(ledger.closing)}</td>
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
              <label className={labelCls}>Bank Account</label>
              <select className={inputCls} value={activeRecCode} onChange={(e) => setRecCode(e.target.value)}>
                {cashAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name_en}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Statement Date</label><input type="date" className={inputCls} value={recDate} onChange={(e) => setRecDate(e.target.value)} /></div>
            <div><label className={labelCls}>Statement Ending Balance (SAR)</label><input type="number" step="0.01" className={inputCls} value={recBalance} onChange={(e) => setRecBalance(e.target.value)} placeholder="0.00" /></div>
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
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3 w-10">Cleared</th><th className="p-3">Date</th><th className="p-3">Voucher</th><th className="p-3">Description</th>
                  <th className="p-3 text-right">Deposit</th><th className="p-3 text-right">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recModel.lines.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-400">No GL lines for this account up to the statement date.</td></tr>}
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
                      <td className="p-3 text-right font-mono text-emerald-700">{l.debit > 0 ? formatSAR(l.debit) : '—'}</td>
                      <td className="p-3 text-right font-mono text-rose-600">{l.credit > 0 ? formatSAR(l.credit) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="no-print flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-end gap-2">
              <div>
                <label className={labelCls}>Bank charges on statement (SAR)</label>
                <input type="number" step="0.01" className={inputCls} value={chargeAmt} onChange={(e) => setChargeAmt(e.target.value)} placeholder="0.00" />
              </div>
              <button type="button" onClick={postBankCharge} disabled={saving} className={btnGhost}>Post Bank Charge (Dr 5130)</button>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => saveRecon('draft')} disabled={saving} className={btnGhost}>Save Draft</button>
              <button type="button" onClick={() => saveRecon('completed')} disabled={saving} className={btnPrimary}><CheckCircle2 className="w-4 h-4" /> Complete Reconciliation</button>
            </div>
          </div>

          {recHistory.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <h4 className="text-xs font-bold text-slate-700 mb-2">Reconciliation History — {accLabel(glAccounts, activeRecCode)}</h4>
              <table className="w-full text-xs">
                <thead className="text-slate-400 border-b border-slate-100">
                  <tr><th className="py-1 text-left">Statement Date</th><th className="py-1 text-right">Statement Bal.</th><th className="py-1 text-right">Book Bal.</th><th className="py-1 text-right">Difference</th><th className="py-1 text-left pl-3">Status</th><th className="py-1 text-left">By</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {recHistory.map((r) => (
                    <tr key={r.id}>
                      <td className="py-1.5">{r.statement_date}</td>
                      <td className="py-1.5 text-right font-mono">{formatSAR(r.statement_balance)}</td>
                      <td className="py-1.5 text-right font-mono">{formatSAR(r.book_balance)}</td>
                      <td className="py-1.5 text-right font-mono">{formatSAR(r.difference)}</td>
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
        <Modal title="Bank / Cash Transfer" onClose={() => setShowTransfer(false)}>
          <form onSubmit={submitTransfer} className="space-y-3">
            <div>
              <label className={labelCls}>From Account (Credit)</label>
              <select className={inputCls} value={tf.from || cashAccounts[0]?.account_code || ''} onChange={(e) => setTf({ ...tf, from: e.target.value })}>
                {cashAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name_en} (SAR {formatSAR(balances[a.account_code] || 0)})</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>To Account (Debit)</label>
              <select className={inputCls} value={tf.to || cashAccounts[1]?.account_code || ''} onChange={(e) => setTf({ ...tf, to: e.target.value })}>
                {cashAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name_en}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Amount (SAR)</label><input type="number" step="0.01" min="0" required className={inputCls} value={tf.amount} onChange={(e) => setTf({ ...tf, amount: e.target.value })} /></div>
              <div><label className={labelCls}>Date</label><input type="date" required className={inputCls} value={tf.date} onChange={(e) => setTf({ ...tf, date: e.target.value })} /></div>
            </div>
            <div><label className={labelCls}>Reference / Memo</label><input className={inputCls} value={tf.ref} onChange={(e) => setTf({ ...tf, ref: e.target.value })} placeholder="e.g. Cash deposit slip #123" /></div>
            <button type="submit" disabled={saving} className={`${btnPrimary} w-full justify-center py-2.5`}>{saving ? 'Posting…' : 'Post Transfer to GL'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Expense Vouchers                                                 */
/* ------------------------------------------------------------------ */

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

export function ExpenseVouchersView({ supabase, glAccounts = [], expenses = [], vendors = [], profile, lockDate = '', onRefresh }) {
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
    if (!expCode) return setMsg({ type: 'error', text: 'No Expense accounts in the Chart of Accounts.' });
    if (net <= 0) return setMsg({ type: 'error', text: 'Net amount must be greater than zero.' });
    if (!form.payee.trim()) return setMsg({ type: 'error', text: 'Payee is required.' });
    const le = lockError(form.expense_date, lockDate);
    if (le) return setMsg({ type: 'error', text: le });

    setSaving(true);
    try {
      const vNo = await nextDocNumber(supabase, 'EXPENSE', 'EXP');
      const recoverable = form.vat_applied && form.vat_recoverable;
      const expenseDebit = recoverable ? net : total;
      const lines = [
        { account_code: expCode, account_name: accLabel(glAccounts, expCode), debit: expenseDebit, credit: 0, memo: form.description || form.payee },
      ];
      if (recoverable && vat > 0) lines.push({ account_code: '1150', account_name: accLabel(glAccounts, '1150'), debit: vat, credit: 0, memo: 'Input VAT 15% recoverable' });
      lines.push({ account_code: form.paid_from_account_code, account_name: accLabel(glAccounts, form.paid_from_account_code), debit: 0, credit: total, memo: `${form.payee} ${form.payment_reference || ''}`.trim() });

      const jv = await postJournalOrThrow({
        supabase,
        entryDate: form.expense_date,
        sourceModule: 'EXPENSE',
        sourceDocNumber: vNo,
        description: `Expense Voucher ${vNo} - ${form.payee}${form.description ? ` (${form.description})` : ''}`,
        postedBy: profile?.full_name || 'Finance',
        lines,
      });

      const { error } = await supabase.from('expense_vouchers').insert({
        id: `exp-${Date.now()}`,
        voucher_number: vNo,
        expense_date: form.expense_date,
        payee: form.payee.trim(),
        vendor_id: form.vendor_id || null,
        expense_account_code: expCode,
        description: form.description,
        division: form.division,
        amount_sar: net,
        vat_sar: vat,
        total_sar: total,
        vat_recoverable: recoverable,
        paid_from_account_code: form.paid_from_account_code,
        payment_reference: form.payment_reference,
        status: 'posted',
        journal_voucher_number: jv.voucher_number,
        posted_by: profile?.full_name || 'Finance',
      });
      if (error) throw new Error(`GL posted (${jv.voucher_number}) but the voucher record failed to save: ${error.message}`);

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
      const expDebit = exp.vat_recoverable ? num(exp.amount_sar) : num(exp.total_sar);
      const lines = [
        { account_code: exp.paid_from_account_code, account_name: accLabel(glAccounts, exp.paid_from_account_code), debit: num(exp.total_sar), credit: 0, memo: `Reversal of ${exp.voucher_number}` },
        { account_code: exp.expense_account_code, account_name: accLabel(glAccounts, exp.expense_account_code), debit: 0, credit: expDebit, memo: `Reversal of ${exp.voucher_number}` },
      ];
      if (exp.vat_recoverable && num(exp.vat_sar) > 0) lines.push({ account_code: '1150', account_name: accLabel(glAccounts, '1150'), debit: 0, credit: num(exp.vat_sar), memo: 'Input VAT reversal' });
      await postJournalOrThrow({
        supabase,
        entryDate: date,
        sourceModule: 'EXPENSE_VOID',
        sourceDocNumber: exp.voucher_number,
        description: `VOID Expense Voucher ${exp.voucher_number} - ${exp.payee}`,
        postedBy: profile?.full_name || 'Finance',
        lines,
      });
      const { error } = await supabase.from('expense_vouchers').update({ status: 'void' }).eq('id', exp.id);
      if (error) throw new Error(`Reversal posted but status update failed: ${error.message}`);
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
      <Header icon={Receipt} title="Expense Vouchers & Petty Cash • سندات المصروفات" subtitle="Record operating expenses (rent, salaries, fuel, utilities, government fees) with recoverable 15% input VAT — auto-posted to the GL.">
        <button type="button" onClick={exportCsv} className={btnCsv}><Download className="w-4 h-4" /> Export CSV</button>
        <button type="button" onClick={() => setShowModal(true)} className={btnPrimary}><Plus className="w-4 h-4" /> New Expense Voucher</button>
      </Header>

      <Notice msg={msg} onClear={() => setMsg(null)} />

      <div className="no-print flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-2xl p-4">
        <div>
          <label className={labelCls}>Month</label>
          <select className={inputCls} value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
            <option value="">All months</option>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="min-w-[200px]">
          <label className={labelCls}>Expense Account</label>
          <select className={inputCls} value={fAccount} onChange={(e) => setFAccount(e.target.value)}>
            <option value="">All accounts</option>
            {expenseAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name_en}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Division</label>
          <select className={inputCls} value={fDivision} onChange={(e) => setFDivision(e.target.value)}>
            <option value="">All</option><option value="MEP">MEP</option><option value="IT & ELV">IT &amp; ELV</option><option value="Shared">Shared</option>
          </select>
        </div>
      </div>

      {byAccount.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <h4 className="text-xs font-bold text-slate-700 mb-2">Totals by Expense Account (excluding voided)</h4>
          <table className="w-full text-xs">
            <thead className="text-slate-400 border-b border-slate-100">
              <tr><th className="py-1 text-left">Account</th><th className="py-1 text-right">Vouchers</th><th className="py-1 text-right">Net</th><th className="py-1 text-right">VAT</th><th className="py-1 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {byAccount.map(([code, v]) => (
                <tr key={code}>
                  <td className="py-1.5 font-semibold">{accLabel(glAccounts, code)}</td>
                  <td className="py-1.5 text-right">{v.count}</td>
                  <td className="py-1.5 text-right font-mono">{formatSAR(v.net)}</td>
                  <td className="py-1.5 text-right font-mono">{formatSAR(v.vat)}</td>
                  <td className="py-1.5 text-right font-mono font-bold">{formatSAR(v.total)}</td>
                </tr>
              ))}
              <tr className="font-bold border-t border-slate-200">
                <td className="py-1.5">TOTAL</td><td />
                <td className="py-1.5 text-right font-mono">{formatSAR(grand.net)}</td>
                <td className="py-1.5 text-right font-mono">{formatSAR(grand.vat)}</td>
                <td className="py-1.5 text-right font-mono">SAR {formatSAR(grand.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="p-3">Voucher</th><th className="p-3">Date</th><th className="p-3">Payee</th><th className="p-3">Account</th><th className="p-3">Division</th>
              <th className="p-3 text-right">Net</th><th className="p-3 text-right">VAT</th><th className="p-3 text-right">Total</th><th className="p-3">Paid From</th><th className="p-3">Status</th><th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 && <tr><td colSpan={11} className="p-8 text-center text-slate-400">No expense vouchers yet. Click <strong>New Expense Voucher</strong> to record one.</td></tr>}
            {filtered.map((x) => (
              <tr key={x.id} className={x.status === 'void' ? 'opacity-50 line-through' : 'hover:bg-slate-50/70'}>
                <td className="p-3 font-mono font-bold text-blue-700">{x.voucher_number}<div className="text-[10px] text-slate-400 no-underline">{x.journal_voucher_number}</div></td>
                <td className="p-3 whitespace-nowrap">{x.expense_date}</td>
                <td className="p-3"><div className="font-semibold text-slate-800">{x.payee}</div>{x.description && <div className="text-slate-400">{x.description}</div>}</td>
                <td className="p-3">{accLabel(glAccounts, x.expense_account_code)}</td>
                <td className="p-3">{x.division}</td>
                <td className="p-3 text-right font-mono">{formatSAR(x.amount_sar)}</td>
                <td className="p-3 text-right font-mono">{formatSAR(x.vat_sar)}</td>
                <td className="p-3 text-right font-mono font-bold">{formatSAR(x.total_sar)}</td>
                <td className="p-3">{x.paid_from_account_code === '2010' ? 'On Credit (AP)' : accLabel(glAccounts, x.paid_from_account_code)}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${x.status === 'void' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>{x.status}</span></td>
                <td className="p-3">
                  {x.status !== 'void' && (
                    <button type="button" onClick={() => voidExpense(x)} disabled={saving} className="no-print text-rose-600 hover:text-rose-800 cursor-pointer" title="Void with reversing journal">
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
        <Modal title="New Expense Voucher" onClose={() => setShowModal(false)} wide>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={labelCls}>Date</label><input type="date" required className={inputCls} value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
              <div>
                <label className={labelCls}>Pick Vendor (optional)</label>
                <select
                  className={inputCls}
                  value={form.vendor_id}
                  onChange={(e) => {
                    const v = vendors.find((x) => x.id === e.target.value);
                    setForm({ ...form, vendor_id: e.target.value, payee: v ? v.name_en : form.payee });
                  }}
                >
                  <option value="">— Free-text payee —</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name_en}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2"><label className={labelCls}>Payee</label><input required className={inputCls} value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} placeholder="e.g. Saudi Electricity Co." /></div>
              <div>
                <label className={labelCls}>Expense Account</label>
                <select className={inputCls} value={form.expense_account_code || expenseAccounts[0]?.account_code || ''} onChange={(e) => setForm({ ...form, expense_account_code: e.target.value })}>
                  {expenseAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name_en}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Division</label>
                <select className={inputCls} value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })}>
                  <option value="Shared">Shared / Head Office</option><option value="MEP">MEP</option><option value="IT & ELV">IT &amp; ELV</option>
                </select>
              </div>
              <div className="sm:col-span-2"><label className={labelCls}>Description</label><input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Office electricity — October" /></div>
              <div><label className={labelCls}>Net Amount (SAR, excl. VAT)</label><input type="number" step="0.01" min="0" required className={inputCls} value={form.amount_sar} onChange={(e) => setForm({ ...form, amount_sar: e.target.value })} /></div>
              <div>
                <label className={labelCls}>Paid From</label>
                <select className={inputCls} value={form.paid_from_account_code} onChange={(e) => setForm({ ...form, paid_from_account_code: e.target.value })}>
                  {payFromOptions.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input type="checkbox" checked={form.vat_applied} onChange={(e) => setForm({ ...form, vat_applied: e.target.checked })} /> 15% VAT charged on this bill
              </label>
              <label className={`flex items-center gap-2 text-xs font-semibold ${form.vat_applied ? 'text-slate-700' : 'text-slate-300'}`}>
                <input type="checkbox" disabled={!form.vat_applied} checked={form.vat_recoverable} onChange={(e) => setForm({ ...form, vat_recoverable: e.target.checked })} /> Input VAT recoverable (valid tax invoice)
              </label>
              <div className="sm:col-span-2"><label className={labelCls}>Payment Reference</label><input className={inputCls} value={form.payment_reference} onChange={(e) => setForm({ ...form, payment_reference: e.target.value })} placeholder="Cheque / transfer / receipt #" /></div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1">
              <div className="flex justify-between"><span>Net</span><span className="font-mono">SAR {formatSAR(net)}</span></div>
              <div className="flex justify-between"><span>VAT 15%</span><span className="font-mono">SAR {formatSAR(vat)}</span></div>
              <div className="flex justify-between font-bold border-t border-slate-200 pt-1"><span>Total Paid</span><span className="font-mono">SAR {formatSAR(total)}</span></div>
            </div>
            <button type="submit" disabled={saving} className={`${btnPrimary} w-full justify-center py-2.5`}>{saving ? 'Posting…' : 'Post Expense Voucher'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Fixed Assets & Depreciation                                      */
/* ------------------------------------------------------------------ */

const assetMonthly = (a) => {
  const base = Math.max(0, num(a.cost_sar) - num(a.salvage_value_sar));
  const life = Math.max(1, num(a.useful_life_months));
  return base / life;
};

// Depreciation due for an asset from its next unposted month up to and including `period` (YYYY-MM)
const depreciationDue = (a, period) => {
  if (a.status !== 'active') return { amount: 0, months: 0 };
  const base = Math.max(0, num(a.cost_sar) - num(a.salvage_value_sar));
  let remaining = Math.max(0, base - num(a.accumulated_depreciation_sar));
  const start = a.last_depreciation_period ? addMonths(a.last_depreciation_period, 1) : addMonths(monthKey(a.acquisition_date), 1);
  const monthly = assetMonthly(a);
  let amount = 0;
  let months = 0;
  for (let m = start; m <= period && remaining > 0.004; m = addMonths(m, 1)) {
    const d = Math.min(monthly, remaining);
    amount += d;
    remaining -= d;
    months += 1;
  }
  return { amount: r2(amount), months };
};

const blankAsset = () => ({ name: '', category_account_code: '1500', acquisition_date: todayStr(), cost_sar: '', salvage_value_sar: '0', useful_life_months: '60', paid_from_account_code: '1020' });

export function FixedAssetsView({ supabase, glAccounts = [], fixedAssets = [], profile, lockDate = '', onRefresh }) {
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState(blankAsset());
  const [period, setPeriod] = useState(monthKey(todayStr()));
  const [disposeAsset, setDisposeAsset] = useState(null);
  const [disp, setDisp] = useState({ date: todayStr(), proceeds: '', account: '1020' });
  const [expanded, setExpanded] = useState(null);

  const cashOpts = useMemo(() => cashAccountsOf(glAccounts, []), [glAccounts]);
  const categoryOpts = useMemo(() => {
    const fromCoa = glAccounts.filter((a) => a.account_type === 'Asset' && a.account_code >= '1500' && a.account_code < '1590');
    return fromCoa.length ? fromCoa : [{ account_code: '1500', account_name_en: 'Fixed Assets – Equipment & Vehicles' }, { account_code: '1510', account_name_en: 'Fixed Assets – IT & Office Equipment' }];
  }, [glAccounts]);

  const register = async (e) => {
    e.preventDefault();
    const cost = r2(form.cost_sar);
    if (!form.name.trim() || cost <= 0) return setMsg({ type: 'error', text: 'Asset name and a cost greater than zero are required.' });
    if (num(form.salvage_value_sar) >= cost) return setMsg({ type: 'error', text: 'Salvage value must be less than cost.' });
    if (num(form.useful_life_months) < 1) return setMsg({ type: 'error', text: 'Useful life must be at least 1 month.' });
    const le = lockError(form.acquisition_date, lockDate);
    if (le) return setMsg({ type: 'error', text: le });
    setSaving(true);
    try {
      const code = await nextDocNumber(supabase, 'ASSET', 'FA');
      await postJournalOrThrow({
        supabase,
        entryDate: form.acquisition_date,
        sourceModule: 'ASSET',
        sourceDocNumber: code,
        description: `Fixed Asset Acquisition ${code} - ${form.name}`,
        postedBy: profile?.full_name || 'Finance',
        lines: [
          { account_code: form.category_account_code, account_name: accLabel(glAccounts, form.category_account_code), debit: cost, credit: 0, memo: form.name },
          { account_code: form.paid_from_account_code, account_name: accLabel(glAccounts, form.paid_from_account_code), debit: 0, credit: cost, memo: `Purchase of ${code}` },
        ],
      });
      const { error } = await supabase.from('fixed_assets').insert({
        id: `fa-${Date.now()}`,
        asset_code: code,
        name: form.name.trim(),
        category_account_code: form.category_account_code,
        acquisition_date: form.acquisition_date,
        cost_sar: cost,
        salvage_value_sar: r2(form.salvage_value_sar),
        useful_life_months: Math.round(num(form.useful_life_months)),
        depreciation_method: 'straight_line',
        accumulated_depreciation_sar: 0,
        last_depreciation_period: null,
        paid_from_account_code: form.paid_from_account_code,
        status: 'active',
      });
      if (error) throw new Error(`GL posted but the asset record failed to save: ${error.message}`);
      setMsg({ type: 'ok', text: `Asset ${code} registered and capitalised (SAR ${formatSAR(cost)}).` });
      setShowRegister(false);
      setForm(blankAsset());
      onRefresh && onRefresh();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setSaving(false);
  };

  const runPreview = useMemo(
    () => fixedAssets.map((a) => ({ asset: a, ...depreciationDue(a, period) })).filter((r) => r.amount > 0),
    [fixedAssets, period]
  );
  const runTotal = r2(runPreview.reduce((s, r) => s + r.amount, 0));

  const runDepreciation = async () => {
    if (runPreview.length === 0) return setMsg({ type: 'error', text: `No depreciation due up to ${period}.` });
    const entryDate = lastDayOfMonth(period);
    const le = lockError(entryDate, lockDate);
    if (le) return setMsg({ type: 'error', text: le });
    if (!window.confirm(`Post depreciation of SAR ${formatSAR(runTotal)} for ${runPreview.length} asset(s) up to ${period}?`)) return;
    setSaving(true);
    try {
      const docNo = await nextDocNumber(supabase, 'DEPRECIATION', 'DEP');
      const lines = [
        { account_code: '5270', account_name: accLabel(glAccounts, '5270'), debit: runTotal, credit: 0, memo: `Depreciation up to ${period}` },
        ...runPreview.map((r) => ({ account_code: '1590', account_name: accLabel(glAccounts, '1590'), debit: 0, credit: r.amount, memo: `${r.asset.asset_code} ${r.asset.name} (${r.months} mo)` })),
      ];
      await postJournalOrThrow({
        supabase,
        entryDate,
        sourceModule: 'DEPRECIATION',
        sourceDocNumber: docNo,
        description: `Monthly Depreciation Run ${docNo} — up to ${period}`,
        postedBy: profile?.full_name || 'Finance',
        lines,
      });
      for (const r of runPreview) {
        const a = r.asset;
        const nextAcc = r2(num(a.accumulated_depreciation_sar) + r.amount);
        const base = num(a.cost_sar) - num(a.salvage_value_sar);
        await supabase
          .from('fixed_assets')
          .update({ accumulated_depreciation_sar: nextAcc, last_depreciation_period: period, status: nextAcc >= base - 0.01 ? 'fully_depreciated' : 'active' })
          .eq('id', a.id);
      }
      setMsg({ type: 'ok', text: `Depreciation run ${docNo} posted: SAR ${formatSAR(runTotal)}.` });
      onRefresh && onRefresh();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setSaving(false);
  };

  const submitDisposal = async (e) => {
    e.preventDefault();
    const a = disposeAsset;
    const le = lockError(disp.date, lockDate);
    if (le) return setMsg({ type: 'error', text: le });
    const pending = depreciationDue(a, monthKey(disp.date));
    if (a.status === 'active' && pending.amount > 0 && !window.confirm(`SAR ${formatSAR(pending.amount)} depreciation is still unposted up to ${monthKey(disp.date)}. Dispose anyway (the gain/loss will absorb it)?`)) return;
    setSaving(true);
    try {
      const cost = num(a.cost_sar);
      const acc = num(a.accumulated_depreciation_sar);
      const proceeds = r2(disp.proceeds);
      const gain = r2(proceeds - (cost - acc));
      const lines = [];
      if (proceeds > 0) lines.push({ account_code: disp.account, account_name: accLabel(glAccounts, disp.account), debit: proceeds, credit: 0, memo: 'Disposal proceeds' });
      if (acc > 0) lines.push({ account_code: '1590', account_name: accLabel(glAccounts, '1590'), debit: r2(acc), credit: 0, memo: 'Remove accumulated depreciation' });
      if (gain < 0) lines.push({ account_code: '5100', account_name: accLabel(glAccounts, '5100'), debit: Math.abs(gain), credit: 0, memo: 'Loss on disposal' });
      lines.push({ account_code: a.category_account_code, account_name: accLabel(glAccounts, a.category_account_code), debit: 0, credit: r2(cost), memo: `Derecognise ${a.asset_code}` });
      if (gain > 0) lines.push({ account_code: '4900', account_name: accLabel(glAccounts, '4900'), debit: 0, credit: gain, memo: 'Gain on disposal' });
      await postJournalOrThrow({
        supabase,
        entryDate: disp.date,
        sourceModule: 'ASSET_DISPOSAL',
        sourceDocNumber: a.asset_code,
        description: `Disposal of Fixed Asset ${a.asset_code} - ${a.name}`,
        postedBy: profile?.full_name || 'Finance',
        lines,
      });
      const { error } = await supabase.from('fixed_assets').update({ status: 'disposed', disposal_date: disp.date, disposal_proceeds_sar: proceeds }).eq('id', a.id);
      if (error) throw new Error(`GL posted but asset status update failed: ${error.message}`);
      setMsg({ type: 'ok', text: `${a.asset_code} disposed. ${gain >= 0 ? 'Gain' : 'Loss'} of SAR ${formatSAR(Math.abs(gain))} recognised.` });
      setDisposeAsset(null);
      onRefresh && onRefresh();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setSaving(false);
  };

  const totals = fixedAssets.filter((a) => a.status !== 'disposed').reduce(
    (s, a) => ({ cost: s.cost + num(a.cost_sar), acc: s.acc + num(a.accumulated_depreciation_sar) }),
    { cost: 0, acc: 0 }
  );

  const exportCsv = () =>
    downloadCsvFile(
      `Fixed_Asset_Register_${todayStr()}.csv`,
      ['Asset Code', 'Name', 'Category', 'Acquired', 'Cost (SAR)', 'Salvage (SAR)', 'Life (months)', 'Monthly Dep. (SAR)', 'Accumulated (SAR)', 'NBV (SAR)', 'Last Period', 'Status'],
      fixedAssets.map((a) => [a.asset_code, a.name, accLabel(glAccounts, a.category_account_code), a.acquisition_date, num(a.cost_sar).toFixed(2), num(a.salvage_value_sar).toFixed(2), a.useful_life_months, assetMonthly(a).toFixed(2), num(a.accumulated_depreciation_sar).toFixed(2), (num(a.cost_sar) - num(a.accumulated_depreciation_sar)).toFixed(2), a.last_depreciation_period || '', a.status])
    );

  const schedule = (a) => {
    const rows = [];
    const base = Math.max(0, num(a.cost_sar) - num(a.salvage_value_sar));
    let acc = num(a.accumulated_depreciation_sar);
    let m = a.last_depreciation_period ? addMonths(a.last_depreciation_period, 1) : addMonths(monthKey(a.acquisition_date), 1);
    const monthly = assetMonthly(a);
    for (let i = 0; i < 12 && acc < base - 0.004; i += 1) {
      const d = Math.min(monthly, base - acc);
      acc += d;
      rows.push({ period: m, dep: d, acc, nbv: num(a.cost_sar) - acc });
      m = addMonths(m, 1);
    }
    return rows;
  };

  return (
    <div className="space-y-4">
      <Header icon={Building} title="Fixed Asset Register & Depreciation • سجل الأصول الثابتة" subtitle="Capitalise equipment, vehicles & IT assets, run straight-line monthly depreciation and record disposals with automatic gain/loss.">
        <button type="button" onClick={exportCsv} className={btnCsv}><Download className="w-4 h-4" /> Export CSV</button>
        <button type="button" onClick={() => setShowRegister(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Register Asset</button>
      </Header>

      <Notice msg={msg} onClear={() => setMsg(null)} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-semibold text-slate-500">Gross Cost (in use)</div><div className="mt-1 font-mono font-bold">SAR {formatSAR(totals.cost)}</div></div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-semibold text-slate-500">Accumulated Depreciation</div><div className="mt-1 font-mono font-bold text-rose-600">SAR {formatSAR(totals.acc)}</div></div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-semibold text-slate-500">Net Book Value</div><div className="mt-1 font-mono font-bold text-emerald-700">SAR {formatSAR(totals.cost - totals.acc)}</div></div>
      </div>

      <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div><label className={labelCls}>Depreciate up to (month)</label><input type="month" className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value)} /></div>
          <button type="button" onClick={runDepreciation} disabled={saving || runPreview.length === 0} className={btnDark}><Calculator className="w-4 h-4" /> Run Depreciation (SAR {formatSAR(runTotal)})</button>
          <span className="text-[11px] text-slate-500">Posts one journal: Dr 5270 Depreciation Expense / Cr 1590 Accumulated Depreciation, dated {lastDayOfMonth(period)}.</span>
        </div>
        {runPreview.length > 0 && (
          <div className="text-xs text-slate-600 flex flex-wrap gap-2">
            {runPreview.map((r) => <span key={r.asset.id} className="px-2 py-0.5 rounded bg-slate-100">{r.asset.asset_code}: {r.months} mo • SAR {formatSAR(r.amount)}</span>)}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="p-3">Asset</th><th className="p-3">Category</th><th className="p-3">Acquired</th><th className="p-3 text-right">Cost</th><th className="p-3 text-right">Monthly</th>
              <th className="p-3 text-right">Accumulated</th><th className="p-3 text-right">NBV</th><th className="p-3">Last Period</th><th className="p-3">Status</th><th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {fixedAssets.length === 0 && <tr><td colSpan={10} className="p-8 text-center text-slate-400">No fixed assets registered yet.</td></tr>}
            {fixedAssets.map((a) => (
              <React.Fragment key={a.id}>
                <tr className="hover:bg-slate-50/70 cursor-pointer" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                  <td className="p-3"><div className="font-mono font-bold text-blue-700">{a.asset_code}</div><div className="font-semibold text-slate-800">{a.name}</div></td>
                  <td className="p-3">{accLabel(glAccounts, a.category_account_code)}</td>
                  <td className="p-3 whitespace-nowrap">{a.acquisition_date}</td>
                  <td className="p-3 text-right font-mono">{formatSAR(a.cost_sar)}</td>
                  <td className="p-3 text-right font-mono">{formatSAR(assetMonthly(a))}</td>
                  <td className="p-3 text-right font-mono text-rose-600">{formatSAR(a.accumulated_depreciation_sar)}</td>
                  <td className="p-3 text-right font-mono font-bold">{formatSAR(num(a.cost_sar) - num(a.accumulated_depreciation_sar))}</td>
                  <td className="p-3">{a.last_depreciation_period || '—'}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${a.status === 'active' ? 'bg-emerald-100 text-emerald-800' : a.status === 'disposed' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-800'}`}>{a.status}</span></td>
                  <td className="p-3">
                    {a.status !== 'disposed' && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDisposeAsset(a); setDisp({ date: todayStr(), proceeds: '', account: cashOpts.find((c) => c.account_code === '1020')?.account_code || cashOpts[0]?.account_code || '1020' }); }}
                        className="no-print text-xs font-semibold text-rose-600 hover:text-rose-800 cursor-pointer"
                      >
                        Dispose
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === a.id && (
                  <tr className="bg-slate-50/60">
                    <td colSpan={10} className="p-3">
                      <div className="text-[11px] font-bold text-slate-600 mb-1">Upcoming schedule (next 12 months)</div>
                      {schedule(a).length === 0 ? (
                        <div className="text-slate-400">Fully depreciated or disposed.</div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                          {schedule(a).map((s) => (
                            <div key={s.period} className="bg-white border border-slate-200 rounded-lg p-2">
                              <div className="font-bold">{s.period}</div>
                              <div className="text-slate-500">Dep {formatSAR(s.dep)}</div>
                              <div className="text-slate-500">NBV {formatSAR(s.nbv)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {showRegister && (
        <Modal title="Register Fixed Asset" onClose={() => setShowRegister(false)} wide>
          <form onSubmit={register} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2"><label className={labelCls}>Asset Name</label><input required className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Toyota Hilux 2026 — Site Pickup" /></div>
              <div>
                <label className={labelCls}>Category (GL)</label>
                <select className={inputCls} value={form.category_account_code} onChange={(e) => setForm({ ...form, category_account_code: e.target.value })}>
                  {categoryOpts.map((c) => <option key={c.account_code} value={c.account_code}>{c.account_code} — {c.account_name_en}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Acquisition Date</label><input type="date" required className={inputCls} value={form.acquisition_date} onChange={(e) => setForm({ ...form, acquisition_date: e.target.value })} /></div>
              <div><label className={labelCls}>Cost (SAR, excl. VAT)</label><input type="number" step="0.01" min="0" required className={inputCls} value={form.cost_sar} onChange={(e) => setForm({ ...form, cost_sar: e.target.value })} /></div>
              <div><label className={labelCls}>Salvage Value (SAR)</label><input type="number" step="0.01" min="0" className={inputCls} value={form.salvage_value_sar} onChange={(e) => setForm({ ...form, salvage_value_sar: e.target.value })} /></div>
              <div><label className={labelCls}>Useful Life (months)</label><input type="number" min="1" required className={inputCls} value={form.useful_life_months} onChange={(e) => setForm({ ...form, useful_life_months: e.target.value })} /></div>
              <div>
                <label className={labelCls}>Paid From</label>
                <select className={inputCls} value={form.paid_from_account_code} onChange={(e) => setForm({ ...form, paid_from_account_code: e.target.value })}>
                  {cashOpts.map((c) => <option key={c.account_code} value={c.account_code}>{c.account_code} — {c.account_name_en}</option>)}
                  <option value="2010">2010 — On Credit (Accounts Payable)</option>
                </select>
              </div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-xs">Monthly straight-line depreciation: <strong className="font-mono">SAR {formatSAR(Math.max(0, num(form.cost_sar) - num(form.salvage_value_sar)) / Math.max(1, num(form.useful_life_months)))}</strong> — starts the month after acquisition.</div>
            <button type="submit" disabled={saving} className={`${btnPrimary} w-full justify-center py-2.5`}>{saving ? 'Posting…' : 'Capitalise Asset & Post to GL'}</button>
          </form>
        </Modal>
      )}

      {disposeAsset && (
        <Modal title={`Dispose ${disposeAsset.asset_code} — ${disposeAsset.name}`} onClose={() => setDisposeAsset(null)}>
          <form onSubmit={submitDisposal} className="space-y-3">
            <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1">
              <div className="flex justify-between"><span>Cost</span><span className="font-mono">SAR {formatSAR(disposeAsset.cost_sar)}</span></div>
              <div className="flex justify-between"><span>Accumulated depreciation</span><span className="font-mono">SAR {formatSAR(disposeAsset.accumulated_depreciation_sar)}</span></div>
              <div className="flex justify-between font-bold"><span>Net book value</span><span className="font-mono">SAR {formatSAR(num(disposeAsset.cost_sar) - num(disposeAsset.accumulated_depreciation_sar))}</span></div>
            </div>
            <div><label className={labelCls}>Disposal Date</label><input type="date" required className={inputCls} value={disp.date} onChange={(e) => setDisp({ ...disp, date: e.target.value })} /></div>
            <div><label className={labelCls}>Sale Proceeds (SAR, excl. VAT — 0 if scrapped)</label><input type="number" step="0.01" min="0" className={inputCls} value={disp.proceeds} onChange={(e) => setDisp({ ...disp, proceeds: e.target.value })} /></div>
            <div>
              <label className={labelCls}>Proceeds Received Into</label>
              <select className={inputCls} value={disp.account} onChange={(e) => setDisp({ ...disp, account: e.target.value })}>
                {cashOpts.map((c) => <option key={c.account_code} value={c.account_code}>{c.account_code} — {c.account_name_en}</option>)}
              </select>
            </div>
            <div className="text-xs font-semibold">
              {(() => {
                const g = num(disp.proceeds) - (num(disposeAsset.cost_sar) - num(disposeAsset.accumulated_depreciation_sar));
                return g >= 0 ? <span className="text-emerald-700">Gain on disposal: SAR {formatSAR(g)} (Cr 4900)</span> : <span className="text-rose-600">Loss on disposal: SAR {formatSAR(Math.abs(g))} (Dr 5100)</span>;
              })()}
            </div>
            <button type="submit" disabled={saving} className={`${btnPrimary} w-full justify-center py-2.5`}>{saving ? 'Posting…' : 'Post Disposal'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Budget vs Actual                                                 */
/* ------------------------------------------------------------------ */

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
      return setMsg({ type: 'error', text: 'Enter at least one budget amount.' });
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
      <Header icon={Target} title="Budget vs Actual • الموازنة مقابل الفعلي" subtitle="Set annual / monthly budgets per revenue & expense account and track year-to-date variance against posted GL actuals.">
        <button type="button" onClick={exportCsv} className={btnCsv}><Download className="w-4 h-4" /> Export CSV</button>
        <button type="button" onClick={save} disabled={saving || !dirty} className={btnPrimary}><CheckCircle2 className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Budget'}</button>
      </Header>

      <Notice msg={msg} onClear={() => setMsg(null)} />

      <div className="no-print flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-2xl p-4">
        <div>
          <label className={labelCls}>Fiscal Year</label>
          <select className={inputCls} value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>FY{y}</option>)}</select>
        </div>
        <div>
          <label className={labelCls}>YTD through</label>
          <select className={inputCls} value={throughMonth} onChange={(e) => setThroughMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={showMonths} onChange={(e) => setShowMonths(e.target.checked)} /> Edit monthly phasing</label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-semibold text-slate-500">YTD Revenue — Budget / Actual</div><div className="mt-1 font-mono font-bold text-sm">{formatSAR(revB)} / <span className={revA >= revB ? 'text-emerald-700' : 'text-rose-600'}>{formatSAR(revA)}</span></div></div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-semibold text-slate-500">YTD Expenses — Budget / Actual</div><div className="mt-1 font-mono font-bold text-sm">{formatSAR(expB)} / <span className={expA <= expB ? 'text-emerald-700' : 'text-rose-600'}>{formatSAR(expA)}</span></div></div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-semibold text-slate-500">YTD Net Profit — Budget / Actual</div><div className="mt-1 font-mono font-bold text-sm">{formatSAR(revB - expB)} / <span className={revA - expA >= revB - expB ? 'text-emerald-700' : 'text-rose-600'}>{formatSAR(revA - expA)}</span></div></div>
      </div>

      {plAccounts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">No Revenue or Expense accounts in the Chart of Accounts.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-3">Account</th>
                <th className="p-3 text-right">Annual Budget</th>
                {showMonths && MONTHS.map((m) => <th key={m} className="p-2 text-right">{m}</th>)}
                <th className="p-3 text-right">YTD Budget</th><th className="p-3 text-right">YTD Actual</th><th className="p-3 text-right">Variance</th><th className="p-3 text-right">%</th>
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
                    <td className="p-2 text-right">
                      <input type="number" step="0.01" className="w-28 border border-slate-300 rounded-lg px-2 py-1 text-right font-mono text-xs" value={drafts[r.a.account_code]?.annual ?? ''} onChange={(e) => setAnnual(r.a.account_code, num(e.target.value))} placeholder="0.00" />
                    </td>
                    {showMonths && r.d.months.map((v, i) => (
                      <td key={i} className="p-1 text-right">
                        <input type="number" step="0.01" className="w-20 border border-slate-200 rounded px-1 py-0.5 text-right font-mono text-[11px]" value={v || ''} onChange={(e) => setMonth(r.a.account_code, i, e.target.value)} />
                      </td>
                    ))}
                    <td className="p-3 text-right font-mono">{formatSAR(r.ytdBudget)}</td>
                    <td className="p-3 text-right font-mono">{formatSAR(r.ytdActual)}</td>
                    <td className={`p-3 text-right font-mono font-bold ${r.ytdBudget === 0 && r.ytdActual === 0 ? 'text-slate-400' : fav ? 'text-emerald-700' : 'text-rose-600'}`}>{fav ? '+' : '−'}{formatSAR(Math.abs(r.variance))}</td>
                    <td className="p-3 text-right">{r.pct === null ? '—' : `${r.pct.toFixed(1)}%`}</td>
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
      {rows.length === 0 && <tr><td className="p-3 pl-6 text-slate-400" colSpan={2}>No cash movements</td></tr>}
      {rows.map((r) => (
        <tr key={r.code}>
          <td className="p-2.5 pl-6"><span className="font-mono text-blue-700 mr-1.5">{r.code}</span>{r.nameEn}{r.nameAr && <span className="text-slate-400"> • {r.nameAr}</span>}</td>
          <td className={`p-2.5 text-right font-mono ${r.amount < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{r.amount < 0 ? `(${formatSAR(Math.abs(r.amount))})` : formatSAR(r.amount)}</td>
        </tr>
      ))}
      <tr className="font-bold border-t border-slate-200">
        <td className="p-3">Net cash from {title.toLowerCase()}</td>
        <td className="p-3 text-right font-mono">{total < 0 ? `(${formatSAR(Math.abs(total))})` : formatSAR(total)}</td>
      </tr>
    </>
  );

  return (
    <div className="space-y-4">
      <Header icon={ArrowRightLeft} title="Statement of Cash Flows • قائمة التدفقات النقدية" subtitle="Direct-method cash flow derived from every GL journal that touches cash & bank accounts (1010–1099).">
        <button type="button" onClick={exportCsv} className={btnCsv}><Download className="w-4 h-4" /> Export CSV</button>
        <button type="button" onClick={() => window.print()} className={btnDark}><Printer className="w-4 h-4" /> Print</button>
      </Header>

      <div className="no-print flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-2xl p-4">
        <div><label className={labelCls}>From</label><input type="date" className={inputCls} value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
        <div><label className={labelCls}>To</label><input type="date" className={inputCls} value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="bg-slate-900 text-white px-5 py-3.5 flex flex-wrap justify-between items-center gap-2 text-xs">
          <div className="flex items-center gap-3">
            {company?.logoUrl && <img src={company.logoUrl} alt="Company Logo" className="h-9 max-w-[130px] object-contain bg-white rounded p-0.5" />}
            <div>
              <div className="font-bold">{company?.nameEn} {company?.nameAr && <span className="font-normal">• {company.nameAr}</span>}</div>
              <div>VAT TIN: <span className="font-mono">{company?.vatNumber}</span></div>
            </div>
          </div>
          <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold">{fromDate} → {toDate}</span>
        </div>
        <table className="w-full text-left text-xs">
          <tbody className="divide-y divide-slate-100">
            <tr className="font-bold"><td className="p-3">Opening cash & bank balance • الرصيد الافتتاحي</td><td className="p-3 text-right font-mono">{formatSAR(model.opening)}</td></tr>
            <Section title="Operating Activities" titleAr="الأنشطة التشغيلية" rows={model.op} total={model.netOp} />
            <Section title="Investing Activities" titleAr="الأنشطة الاستثمارية" rows={model.inv} total={model.netInv} />
            <Section title="Financing Activities" titleAr="الأنشطة التمويلية" rows={model.fin} total={model.netFin} />
            {Math.abs(model.unallocated) >= 0.005 && <tr><td className="p-3 text-amber-700">Unallocated cash movements</td><td className="p-3 text-right font-mono">{formatSAR(model.unallocated)}</td></tr>}
            <tr className="font-bold bg-slate-50"><td className="p-3">Net increase / (decrease) in cash • صافي التغير</td><td className="p-3 text-right font-mono">{model.netChange < 0 ? `(${formatSAR(Math.abs(model.netChange))})` : formatSAR(model.netChange)}</td></tr>
            <tr className="bg-slate-900 text-white font-bold"><td className="p-3">Closing cash & bank balance • الرصيد الختامي</td><td className="p-3 text-right font-mono text-emerald-400">SAR {formatSAR(model.closing)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className={`text-xs font-semibold rounded-xl px-4 py-2.5 border ${Math.abs(model.diff) < 0.01 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
        <Scale className="inline w-4 h-4 mr-1" />
        Reconciliation check: GL cash & bank balance at {toDate} = SAR {formatSAR(model.closingGl)} — {Math.abs(model.diff) < 0.01 ? 'statement agrees with the General Ledger.' : `difference SAR ${formatSAR(model.diff)}.`}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Customer / Supplier Statements of Account                        */
/* ------------------------------------------------------------------ */

const norm = (s) => String(s || '').trim().toLowerCase();

export function PartyStatementsView({ company = {}, customers = [], vendors = [], invoices = [], creditNotes = [], receipts = [], purchaseOrders = [], supplierPayments = [] }) {
  const [side, setSide] = useState('customer');
  const [party, setParty] = useState('');
  const [fromDate, setFromDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [toDate, setToDate] = useState(todayStr());

  const isBilledPO = (p) => p.status === 'billed' || ['posted', 'paid'].includes(p.bill_status);

  const parties = useMemo(() => {
    const set = new Map();
    const add = (name) => {
      const n = String(name || '').trim();
      if (n && !set.has(norm(n))) set.set(norm(n), n);
    };
    if (side === 'customer') {
      customers.forEach((c) => add(c.name_en));
      invoices.forEach((i) => add(i.client_name));
      creditNotes.forEach((c) => add(c.client_name));
      receipts.forEach((r) => add(r.client_name));
    } else {
      vendors.forEach((v) => add(v.name_en));
      purchaseOrders.forEach((p) => add(p.supplier_name));
      supplierPayments.forEach((p) => add(p.supplier_name));
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [side, customers, vendors, invoices, creditNotes, receipts, purchaseOrders, supplierPayments]);

  const activeParty = parties.find((p) => p === party) || parties[0] || '';
  const master = side === 'customer' ? customers.find((c) => norm(c.name_en) === norm(activeParty)) : vendors.find((v) => norm(v.name_en) === norm(activeParty));

  const statement = useMemo(() => {
    const n = norm(activeParty);
    const tx = [];
    if (side === 'customer') {
      invoices.filter((i) => norm(i.client_name) === n).forEach((i) => tx.push({ date: String(i.issued_at || i.created_at || '').slice(0, 10), type: 'Tax Invoice', doc: i.invoice_number, desc: i.so_number ? `SO ${i.so_number}` : '', debit: num(i.grand_total_sar), credit: 0 }));
      creditNotes.filter((c) => norm(c.client_name) === n).forEach((c) => tx.push({ date: String(c.issued_at || c.created_at || '').slice(0, 10), type: 'Credit Note', doc: c.credit_note_number, desc: c.original_invoice_number ? `vs ${c.original_invoice_number}` : c.reason || '', debit: 0, credit: num(c.grand_total_sar) }));
      receipts.filter((r) => norm(r.client_name) === n).forEach((r) => tx.push({ date: String(r.received_at || r.created_at || '').slice(0, 10), type: 'Receipt', doc: r.receipt_number, desc: `${r.payment_method || ''} ${r.reference_no || ''} ${r.invoice_number ? `for ${r.invoice_number}` : ''}`.trim(), debit: 0, credit: num(r.amount_sar) }));
    } else {
      purchaseOrders.filter((p) => norm(p.supplier_name) === n && isBilledPO(p)).forEach((p) => tx.push({ date: String(p.billed_at || p.updated_at || p.created_at || '').slice(0, 10), type: 'Supplier Bill', doc: p.po_number, desc: `${p.currency || 'SAR'} goods + landed cost + VAT`, debit: 0, credit: num(p.goods_total_sar) + num(p.landed_cost_sar) + num(p.supplier_vat_sar) }));
      supplierPayments.filter((p) => norm(p.supplier_name) === n).forEach((p) => tx.push({ date: String(p.payment_date || p.created_at || '').slice(0, 10), type: 'Payment', doc: p.voucher_number, desc: `${p.payment_method || ''} ${p.bank_reference || ''} ${p.po_number ? `for ${p.po_number}` : ''}`.trim(), debit: num(p.amount_sar), credit: 0 }));
    }
    tx.sort((a, b) => a.date.localeCompare(b.date));
    const sign = side === 'customer' ? 1 : -1; // customer: receivable (Dr+), supplier: payable (Cr+)
    const opening = tx.filter((t) => t.date < fromDate).reduce((s, t) => s + sign * (t.debit - t.credit), 0);
    let bal = opening;
    const rows = tx
      .filter((t) => t.date >= fromDate && t.date <= toDate)
      .map((t) => {
        bal += sign * (t.debit - t.credit);
        return { ...t, balance: bal };
      });
    const totDr = rows.reduce((s, r) => s + r.debit, 0);
    const totCr = rows.reduce((s, r) => s + r.credit, 0);
    return { opening, rows, closing: bal, totDr, totCr };
  }, [side, activeParty, invoices, creditNotes, receipts, purchaseOrders, supplierPayments, fromDate, toDate]);

  const exportCsv = () =>
    downloadCsvFile(
      `Statement_${side}_${activeParty.replace(/[^A-Za-z0-9]+/g, '_')}_${toDate}.csv`,
      ['Date', 'Type', 'Document', 'Description', 'Debit (SAR)', 'Credit (SAR)', 'Balance (SAR)'],
      [['', '', '', 'Opening Balance', '', '', statement.opening.toFixed(2)], ...statement.rows.map((r) => [r.date, r.type, r.doc, r.desc, r.debit.toFixed(2), r.credit.toFixed(2), r.balance.toFixed(2)]), ['', '', '', 'Closing Balance', statement.totDr.toFixed(2), statement.totCr.toFixed(2), statement.closing.toFixed(2)]]
    );

  return (
    <div className="space-y-4">
      <Header icon={FileText} title="Statements of Account • كشوف الحسابات" subtitle="Running-balance customer and supplier statements with opening balance — print on A4 or export to Excel.">
        <button type="button" onClick={exportCsv} disabled={!activeParty} className={btnCsv}><Download className="w-4 h-4" /> Export CSV</button>
        <button type="button" onClick={() => window.print()} disabled={!activeParty} className={btnDark}><Printer className="w-4 h-4" /> Print A4</button>
      </Header>

      <div className="no-print flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-2xl p-4">
        <div className="flex gap-1.5">
          <TabButton active={side === 'customer'} onClick={() => { setSide('customer'); setParty(''); }}>Customer (AR)</TabButton>
          <TabButton active={side === 'supplier'} onClick={() => { setSide('supplier'); setParty(''); }}>Supplier (AP)</TabButton>
        </div>
        <div className="min-w-[240px]">
          <label className={labelCls}>{side === 'customer' ? 'Customer' : 'Supplier'}</label>
          <select className={inputCls} value={activeParty} onChange={(e) => setParty(e.target.value)}>
            {parties.length === 0 && <option value="">No parties found</option>}
            {parties.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div><label className={labelCls}>From</label><input type="date" className={inputCls} value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
        <div><label className={labelCls}>To</label><input type="date" className={inputCls} value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
      </div>

      {!activeParty ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">No {side === 'customer' ? 'customers' : 'suppliers'} with transactions yet.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-5 border-b border-slate-200 flex flex-wrap justify-between gap-4">
            <div className="flex items-start gap-3">
              {company?.logoUrl && <img src={company.logoUrl} alt="Company Logo" className="h-12 max-w-[150px] object-contain" />}
              <div className="text-xs">
                <div className="font-bold text-sm text-slate-900">{company?.nameEn}</div>
                {company?.nameAr && <div className="font-semibold text-slate-700">{company.nameAr}</div>}
                <div className="text-slate-500">VAT TIN: <span className="font-mono">{company?.vatNumber}</span></div>
              </div>
            </div>
            <div className="text-right text-xs">
              <div className="font-bold text-sm text-slate-900">STATEMENT OF ACCOUNT • كشف حساب</div>
              <div className="text-slate-500">{fromDate} → {toDate}</div>
              <div className="mt-2 font-bold text-slate-900">{activeParty}</div>
              {master?.vat_number && <div className="text-slate-500">VAT: <span className="font-mono">{master.vat_number}</span></div>}
              {(master?.customer_code || master?.vendor_code) && <div className="text-slate-500">{master.customer_code || master.vendor_code}</div>}
            </div>
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr><th className="p-3">Date</th><th className="p-3">Type</th><th className="p-3">Document</th><th className="p-3">Description</th><th className="p-3 text-right">Debit</th><th className="p-3 text-right">Credit</th><th className="p-3 text-right">Balance</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="font-semibold bg-slate-50/60"><td className="p-3" colSpan={6}>Opening Balance</td><td className="p-3 text-right font-mono">{formatSAR(statement.opening)}</td></tr>
              {statement.rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">No transactions in this period.</td></tr>}
              {statement.rows.map((r, i) => (
                <tr key={`${r.doc}-${i}`}>
                  <td className="p-3 whitespace-nowrap">{r.date}</td>
                  <td className="p-3">{r.type}</td>
                  <td className="p-3 font-mono text-blue-700">{r.doc}</td>
                  <td className="p-3 text-slate-500">{r.desc}</td>
                  <td className="p-3 text-right font-mono">{r.debit > 0 ? formatSAR(r.debit) : '—'}</td>
                  <td className="p-3 text-right font-mono">{r.credit > 0 ? formatSAR(r.credit) : '—'}</td>
                  <td className="p-3 text-right font-mono font-bold">{formatSAR(r.balance)}</td>
                </tr>
              ))}
              <tr className="bg-slate-900 text-white font-bold">
                <td className="p-3" colSpan={4}>{side === 'customer' ? 'Balance due from customer' : 'Balance payable to supplier'} • الرصيد المستحق</td>
                <td className="p-3 text-right font-mono">{formatSAR(statement.totDr)}</td>
                <td className="p-3 text-right font-mono">{formatSAR(statement.totCr)}</td>
                <td className="p-3 text-right font-mono text-emerald-400">SAR {formatSAR(statement.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 7. Period Lock & Year-End Close                                     */
/* ------------------------------------------------------------------ */

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
    const { error } = await supabase.from('app_settings').upsert({ key: 'gl_period_lock', value: { lockDate: value || '' } }, { onConflict: 'key' });
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
      await postJournalOrThrow({
        supabase,
        entryDate: date,
        sourceModule: 'YEAR_END_CLOSE',
        sourceDocNumber: `FY${fy}`,
        description: `Year-End Closing Entry FY${fy} — transfer P&L to Retained Earnings`,
        postedBy: profile?.full_name || 'Finance',
        lines,
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
      <Header icon={CalendarCheck} title="Period Lock & Year-End Close • إقفال الفترات والسنة المالية" subtitle="Prevent back-dated postings into closed periods and transfer the year's profit or loss to Retained Earnings." />

      <Notice msg={msg} onClear={() => setMsg(null)} />

      {!canManage && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 font-semibold">
          Read-only: only Admin, CEO, Finance or Manager roles can change the period lock or close a fiscal year.
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          {lockDate ? <Lock className="w-5 h-5 text-rose-600" /> : <Unlock className="w-5 h-5 text-emerald-600" />}
          <div className="text-sm font-bold text-slate-900">
            {lockDate ? `Books are locked up to and including ${lockDate}` : 'No period lock — all dates are open'}
          </div>
        </div>
        <p className="text-xs text-slate-500">Journals, expenses, transfers, asset postings and closing entries dated on or before the lock date are refused.</p>
        {canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <div><label className={labelCls}>Lock books up to</label><input type="date" className={inputCls} value={newLock} onChange={(e) => setNewLock(e.target.value)} /></div>
            <button type="button" onClick={() => saveLock(newLock)} disabled={saving || !newLock} className={btnDark}><Lock className="w-4 h-4" /> Set Lock Date</button>
            {lockDate && <button type="button" onClick={() => saveLock('')} disabled={saving} className={btnGhost}><Unlock className="w-4 h-4" /> Clear Lock</button>}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Year-End Close</h3>
            <p className="text-xs text-slate-500">Zeroes every revenue & expense account for the year into 3020 Retained Earnings with a journal dated 31 December.</p>
          </div>
          <div className="flex items-end gap-2">
            <div><label className={labelCls}>Fiscal Year</label><select className={inputCls} value={fy} onChange={(e) => setFy(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>FY{y}</option>)}</select></div>
            {canManage && (
              <button type="button" onClick={closeYear} disabled={saving || alreadyClosed || preview.rows.length === 0} className={btnPrimary}>
                <CalendarCheck className="w-4 h-4" /> {alreadyClosed ? `FY${fy} Closed` : `Close FY${fy}`}
              </button>
            )}
          </div>
        </div>

        {alreadyClosed && <div className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> A YEAR_END_CLOSE journal for FY{fy} already exists.</div>}

        {canManage && (justClosed === fy || alreadyClosed) && (!lockDate || lockDate < `${fy}-12-31`) && (
          <div className="flex flex-wrap items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-900">
            Lock FY{fy} so nobody can post into it?
            <button type="button" onClick={() => saveLock(`${fy}-12-31`)} disabled={saving} className={btnDark}><Lock className="w-4 h-4" /> Lock up to {fy}-12-31</button>
          </div>
        )}

        <table className="w-full text-xs">
          <thead className="text-slate-400 border-b border-slate-100">
            <tr><th className="py-1 text-left">Account</th><th className="py-1 text-left">Type</th><th className="py-1 text-right">FY Balance</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {preview.rows.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-slate-400">No revenue or expense activity in FY{fy}.</td></tr>}
            {preview.rows.map((r) => (
              <tr key={r.code}>
                <td className="py-1.5"><span className="font-mono text-blue-700 mr-1.5">{r.code}</span>{r.name}</td>
                <td className="py-1.5">{r.type}</td>
                <td className="py-1.5 text-right font-mono">{r.net >= 0 ? `Dr ${formatSAR(r.net)}` : `Cr ${formatSAR(Math.abs(r.net))}`}</td>
              </tr>
            ))}
            {preview.rows.length > 0 && (
              <>
                <tr className="font-semibold border-t border-slate-200"><td className="py-1.5" colSpan={2}>Total Revenue</td><td className="py-1.5 text-right font-mono">{formatSAR(preview.revenue)}</td></tr>
                <tr className="font-semibold"><td className="py-1.5" colSpan={2}>Total Expenses</td><td className="py-1.5 text-right font-mono">{formatSAR(preview.expenses)}</td></tr>
                <tr className="font-bold"><td className="py-1.5" colSpan={2}>Net {preview.netIncome >= 0 ? 'Profit' : 'Loss'} → 3020 Retained Earnings</td><td className={`py-1.5 text-right font-mono ${preview.netIncome >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>SAR {formatSAR(Math.abs(preview.netIncome))}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
