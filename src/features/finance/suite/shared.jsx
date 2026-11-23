// Shared helpers of the Finance Suite screens (split from erp/FinanceSuiteViews.jsx, Prompt 15).
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

export const todayStr = () => new Date().toISOString().slice(0, 10);

export const r2 = (n) => Number((Number(n) || 0).toFixed(2));

export const num = (v) => Number(v) || 0;

export const isCashCode = (code) => {
  const c = String(code || '');
  return c.length === 4 && c >= '1010' && c <= '1099';
};

export const accLabel = (glAccounts, code) => {
  const acc = (glAccounts || []).find((a) => a.account_code === String(code));
  return acc ? `${acc.account_code} - ${acc.account_name_en}` : String(code);
};

export const activeEntries = (glEntries) => (glEntries || []).filter((e) => e.status !== 'void');

export const lockError = (date, lockDate) => {
  if (!date) return 'Please choose an entry date.';
  if (lockDate && date <= lockDate) {
    return `The accounting period is locked up to ${lockDate}. Choose a date after ${lockDate} or ask Finance/Admin to change the period lock.`;
  }
  return '';
};

// Every posting is one database function (0004_posting.sql): document + journal + side effects in one transaction.

export const rpcOrThrow = async (supabase, fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};


// Must match ACTION_ACCESS['finance.post'] in src/lib/permissions.js and the GL policies in 0002_roles_rls.sql

export const monthKey = (dateStr) => String(dateStr || '').slice(0, 7);

export const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const inputCls = 'w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

export const labelCls = 'block text-[11px] font-semibold text-slate-600 mb-1';

export const btnPrimary = 'px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50';

export const btnDark = 'px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50';

export const btnGhost = 'px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50';

export const btnCsv = 'px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer';

export function Modal({ title, onClose, children, wide = false }) {
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

export function Notice({ msg, onClear }) {
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

export function TabButton({ active, onClick, children }) {
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

export function Header({ icon: Icon, title, subtitle, children }) {
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

export const cashAccountsOf = (glAccounts, glEntries) => {
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

export const assetMonthly = (a) => {
  const base = Math.max(0, num(a.cost_sar) - num(a.salvage_value_sar));
  const life = Math.max(1, num(a.useful_life_months));
  return base / life;
};

// Depreciation due for an asset from its next unposted month up to and including `period` (YYYY-MM)
