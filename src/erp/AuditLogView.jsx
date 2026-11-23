import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';

// Who changed what, from public.audit_log (migration 0003). Read-only; admin / ceo / finance.
const PAGE = 100;

const TABLES = [
  'invoices', 'credit_notes', 'customer_receipts', 'gl_journal_entries', 'supplier_payments', 'expense_vouchers',
  'purchase_orders', 'sales_orders', 'delivery_notes', 'inquiries', 'customers', 'vendors', 'items',
  'commission_ledger', 'fixed_assets', 'gl_budgets', 'bank_reconciliations', 'gl_accounts', 'gl_period_locks',
  'app_settings', 'document_number_ranges', 'team_profiles', 'user_roles', 'custom_uoms',
];

const L = (lang, en, ar) => (lang === 'ar' ? ar : en);
const pretty = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const short = (v, n = 80) => {
  const s = pretty(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

export function AuditLogView({ supabase, teamProfiles = [], lang = 'en' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [open, setOpen] = useState({});
  const [filters, setFilters] = useState({ table: '', user: '', action: '', from: '', to: '', rowId: '' });

  const names = useMemo(() => Object.fromEntries(teamProfiles.map((p) => [p.id, p.full_name || p.email])), [teamProfiles]);

  const load = useCallback(
    async (beforeId = null) => {
      setLoading(true);
      setError('');
      let q = supabase.from('audit_log').select('*').order('id', { ascending: false }).limit(PAGE);
      if (filters.table) q = q.eq('table_name', filters.table);
      if (filters.user === '__system__') q = q.is('user_id', null);
      else if (filters.user) q = q.eq('user_id', filters.user);
      if (filters.action) q = q.eq('action', filters.action);
      if (filters.rowId.trim()) q = q.ilike('row_id', `%${filters.rowId.trim()}%`);
      if (filters.from) q = q.gte('at', `${filters.from}T00:00:00+03:00`);
      if (filters.to) q = q.lte('at', `${filters.to}T23:59:59.999+03:00`);
      if (beforeId) q = q.lt('id', beforeId);
      const { data, error: err } = await q;
      setLoading(false);
      if (err) {
        setError(/audit_log|PGRST205|does not exist/i.test(err.message)
          ? L(lang, 'The audit log is not installed yet. Run supabase/migrations/0003_audit_lock.sql.', 'سجل التدقيق غير مثبت بعد. شغّل ملف الترحيل 0003.')
          : err.message);
        return;
      }
      setRows((prev) => (beforeId ? [...prev, ...(data || [])] : data || []));
      setHasMore((data || []).length === PAGE);
    },
    [supabase, filters, lang]
  );

  useEffect(() => {
    load();
  }, [load]);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const input = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white';
  const actionTone = { INSERT: 'bg-emerald-50 text-emerald-700', UPDATE: 'bg-blue-50 text-blue-700', DELETE: 'bg-rose-50 text-rose-700' };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
            <History className="w-5 h-5 text-slate-500" /> {L(lang, 'Audit Log', 'سجل التدقيق')}
          </h2>
          <p className="text-xs text-slate-500">
            {L(lang, 'Every create, change and delete, with who did it and the before/after values. Read-only.', 'كل إنشاء وتعديل وحذف، مع المستخدم والقيم قبل وبعد. للقراءة فقط.')}
          </p>
        </div>
        <button type="button" onClick={() => load()} className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {L(lang, 'Refresh', 'تحديث')}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-3 grid grid-cols-2 sm:grid-cols-6 gap-2">
        <select value={filters.table} onChange={set('table')} className={input} aria-label="Table">
          <option value="">{L(lang, 'All records', 'كل السجلات')}</option>
          {TABLES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={filters.user} onChange={set('user')} className={input} aria-label="User">
          <option value="">{L(lang, 'All users', 'كل المستخدمين')}</option>
          <option value="__system__">{L(lang, 'System / SQL Editor', 'النظام / محرر SQL')}</option>
          {teamProfiles.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
        </select>
        <select value={filters.action} onChange={set('action')} className={input} aria-label="Action">
          <option value="">{L(lang, 'All actions', 'كل العمليات')}</option>
          <option value="INSERT">{L(lang, 'Created', 'إنشاء')}</option>
          <option value="UPDATE">{L(lang, 'Changed', 'تعديل')}</option>
          <option value="DELETE">{L(lang, 'Deleted', 'حذف')}</option>
        </select>
        <input value={filters.rowId} onChange={set('rowId')} placeholder={L(lang, 'Record id contains…', 'رقم السجل يحتوي…')} className={input} />
        <input type="date" value={filters.from} onChange={set('from')} className={input} aria-label="From" />
        <input type="date" value={filters.to} onChange={set('to')} className={input} aria-label="To" />
      </div>

      {error && <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 font-semibold">{error}</div>}

      {!error && rows.length === 0 && !loading && (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">{L(lang, 'No matching entries.', 'لا توجد سجلات مطابقة.')}</div>
      )}

      {rows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="p-3 w-6" />
                <th className="p-3">{L(lang, 'When', 'الوقت')}</th>
                <th className="p-3">{L(lang, 'User', 'المستخدم')}</th>
                <th className="p-3">{L(lang, 'Action', 'العملية')}</th>
                <th className="p-3">{L(lang, 'Record', 'السجل')}</th>
                <th className="p-3">{L(lang, 'Changed fields', 'الحقول المعدلة')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const isOpen = !!open[r.id];
                const keys = r.action === 'UPDATE' ? r.changed || [] : Object.keys(r.new_row || r.old_row || {});
                return (
                  <React.Fragment key={r.id}>
                    <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}>
                      <td className="p-3">{isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                      <td className="p-3 whitespace-nowrap">{new Date(r.at).toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB', { timeZone: 'Asia/Riyadh' })}</td>
                      <td className="p-3">
                        <div className="font-semibold">{r.user_id ? names[r.user_id] || r.user_id.slice(0, 8) : L(lang, 'System', 'النظام')}</div>
                        {r.user_role && <div className="text-[10px] text-slate-400">{r.user_role}</div>}
                      </td>
                      <td className="p-3"><span className={`px-2 py-0.5 rounded font-bold text-[10px] ${actionTone[r.action] || ''}`}>{r.action}</span></td>
                      <td className="p-3">
                        <div className="font-semibold">{r.table_name.replace(/_/g, ' ')}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{r.row_id}</div>
                      </td>
                      <td className="p-3 text-slate-600">{r.action === 'UPDATE' ? (r.changed || []).join(', ') : '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/60">
                        <td />
                        <td colSpan={5} className="p-3">
                          <table className="w-full text-[11px]">
                            <thead className="text-slate-400 text-left">
                              <tr>
                                <th className="py-1 pr-3 w-48">{L(lang, 'Field', 'الحقل')}</th>
                                {r.action !== 'INSERT' && <th className="py-1 pr-3">{L(lang, 'Before', 'قبل')}</th>}
                                {r.action !== 'DELETE' && <th className="py-1">{L(lang, 'After', 'بعد')}</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {keys.map((k) => (
                                <tr key={k} className="align-top">
                                  <td className="py-1 pr-3 font-mono text-slate-500">{k}</td>
                                  {r.action !== 'INSERT' && <td className="py-1 pr-3 text-rose-700 break-all" title={pretty(r.old_row?.[k])}>{short(r.old_row?.[k], 160)}</td>}
                                  {r.action !== 'DELETE' && <td className="py-1 text-emerald-700 break-all" title={pretty(r.new_row?.[k])}>{short(r.new_row?.[k], 160)}</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {hasMore && (
            <div className="p-3 text-center border-t border-slate-100">
              <button type="button" disabled={loading} onClick={() => load(rows[rows.length - 1].id)} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold cursor-pointer">
                {loading ? L(lang, 'Loading…', 'جارٍ التحميل…') : L(lang, 'Load older entries', 'تحميل سجلات أقدم')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
