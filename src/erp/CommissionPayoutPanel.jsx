import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, X } from 'lucide-react';
import { formatSAR } from './erpEngine';

// Commission statement + payout run (migration 0007).
//   commission_statement view: eligible / unlocked (expensed) / paid / payable / overpaid per salesperson
//   post_commission_payout: Dr 2300 Commission payable / Cr bank-cash (10xx) or 2200 (payroll)
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const payable = (c) => r2(Number(c.unlocked_commission_sar || 0) - Number(c.paid_out_sar || 0));
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

export function CommissionPayoutPanel({ supabase, commissions = [], glAccounts = [], canPay = false, onRefresh, lang = 'en' }) {
  const L = (en, ar) => (lang === 'ar' ? ar : en);
  const [statement, setStatement] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [missing, setMissing] = useState(false);
  const [runFor, setRunFor] = useState(null); // salesman row
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const [st, po] = await Promise.all([
      supabase.from('commission_statement').select('*').order('salesman_name'),
      supabase.from('commission_payouts').select('*').order('payout_date', { ascending: false }).limit(50),
    ]);
    if (st.error && /commission_statement|PGRST205|does not exist/i.test(st.error.message)) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setStatement(st.data || []);
    setPayouts(po.data || []);
  }, [supabase]);
  useEffect(() => {
    load();
  }, [load, commissions]);

  if (missing) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900">
        {L('Commission payouts need database update 0007_commissions.sql.', 'صرف العمولات يتطلب تحديث قاعدة البيانات 0007.')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {msg && (
        <div className={`rounded-2xl p-3 text-xs font-semibold flex items-start justify-between gap-3 ${msg.type === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

      {statement.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <div className="px-4 pt-3 text-xs font-bold text-slate-600">{L('Commission statement', 'كشف العمولات')}</div>
          <table className="w-full text-xs">
            <thead className="text-slate-500 text-left">
              <tr>
                <th className="p-3">{L('Salesperson', 'المندوب')}</th>
                <th className="p-3 text-right">{L('Earned', 'المستحقة')}</th>
                <th className="p-3 text-right">{L('Unlocked (collected)', 'المحررة (المحصلة)')}</th>
                <th className="p-3 text-right">{L('Paid', 'المدفوعة')}</th>
                <th className="p-3 text-right">{L('Payable now', 'المستحقة الآن')}</th>
                {canPay && <th className="p-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {statement.map((s) => (
                <tr key={s.salesman_id || 'none'}>
                  <td className="p-3 font-semibold">{s.salesman_name || L('Unassigned', 'غير محدد')}</td>
                  <td className="p-3 text-right">SAR {formatSAR(s.eligible_sar)}</td>
                  <td className="p-3 text-right">SAR {formatSAR(s.unlocked_sar)}</td>
                  <td className="p-3 text-right">SAR {formatSAR(s.paid_sar)}</td>
                  <td className="p-3 text-right font-bold">
                    <span className="text-emerald-700">SAR {formatSAR(s.payable_sar)}</span>
                    {Number(s.overpaid_sar) > 0 && (
                      <div className="text-[10px] text-rose-700 font-semibold">{L('Overpaid', 'مدفوع بالزيادة')} SAR {formatSAR(s.overpaid_sar)}</div>
                    )}
                  </td>
                  {canPay && (
                    <td className="p-3 text-right">
                      {Number(s.payable_sar) > 0 && s.salesman_id && (
                        <button type="button" onClick={() => setRunFor(s)} className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold cursor-pointer inline-flex items-center gap-1">
                          <Banknote className="w-3.5 h-3.5" /> {L('Pay out', 'صرف')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payouts.length > 0 && (
        <details className="bg-white border border-slate-200 rounded-2xl p-3 text-xs">
          <summary className="font-bold text-slate-600 cursor-pointer">{L('Payout history', 'سجل الصرف')} ({payouts.length})</summary>
          <table className="w-full mt-2">
            <tbody className="divide-y divide-slate-100">
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 font-mono font-semibold">{p.payout_number}</td>
                  <td className="py-2">{p.salesman_name}</td>
                  <td className="py-2">{p.payout_date}</td>
                  <td className="py-2">{p.paid_from_account_code === '2200' ? L('Via payroll', 'عبر الرواتب') : p.paid_from_account_code}</td>
                  <td className="py-2 text-slate-500">{p.reference}</td>
                  <td className="py-2 text-right font-bold">SAR {formatSAR(p.total_sar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {runFor && (
        <PayoutModal
          L={L}
          salesman={runFor}
          rows={commissions.filter((c) => c.salesman_id === runFor.salesman_id && payable(c) > 0)}
          glAccounts={glAccounts}
          onClose={() => setRunFor(null)}
          onSubmit={async (f) => {
            const { data, error } = await supabase.rpc('post_commission_payout', {
              p_salesman_id: runFor.salesman_id,
              p_commission_ids: f.ids,
              p_pay_from: f.payFrom,
              p_reference: f.reference,
              p_date: f.date,
            });
            if (error) return setMsg({ type: 'error', text: error.message });
            setMsg({ type: 'ok', text: `${data.payout_number}: SAR ${formatSAR(data.total_sar)} paid to ${data.salesman_name} (journal ${data.journal_voucher_number}).` });
            setRunFor(null);
            load();
            onRefresh && onRefresh();
          }}
        />
      )}
    </div>
  );
}

function PayoutModal({ L, salesman, rows, glAccounts, onClose, onSubmit }) {
  const sources = useMemo(() => {
    const cash = glAccounts.filter((a) => String(a.account_code).startsWith('10') && a.account_type === 'Asset' && a.is_active !== false);
    const list = cash.length ? cash : [{ account_code: '1020', account_name_en: 'Bank - Main Current Account (SAR)' }];
    return [...list, { account_code: '2200', account_name_en: 'Accrued Expenses — pay through payroll' }];
  }, [glAccounts]);
  const [selected, setSelected] = useState(() => Object.fromEntries(rows.map((r) => [r.id, true])));
  const [payFrom, setPayFrom] = useState(sources.find((s) => s.account_code === '1020')?.account_code || sources[0].account_code);
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const ids = rows.filter((r) => selected[r.id]).map((r) => r.id);
  const total = r2(rows.filter((r) => selected[r.id]).reduce((s, r) => s + payable(r), 0));

  return (
    <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl max-w-2xl w-full p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto text-xs">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="font-bold text-base">{L(`Commission payout — ${salesman.salesman_name}`, `صرف عمولة — ${salesman.salesman_name}`)}</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <table className="w-full border border-slate-200 rounded-xl">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="p-2 w-8" />
              <th className="p-2">{L('Invoice', 'الفاتورة')}</th>
              <th className="p-2">{L('Client', 'العميل')}</th>
              <th className="p-2 text-right">{L('Unlocked', 'المحررة')}</th>
              <th className="p-2 text-right">{L('Already paid', 'مدفوعة سابقاً')}</th>
              <th className="p-2 text-right">{L('Pay now', 'تُصرف الآن')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="p-2"><input type="checkbox" checked={!!selected[r.id]} onChange={(e) => setSelected({ ...selected, [r.id]: e.target.checked })} /></td>
                <td className="p-2 font-mono">{r.invoice_number}</td>
                <td className="p-2">{r.client_name}</td>
                <td className="p-2 text-right">{formatSAR(r.unlocked_commission_sar)}</td>
                <td className="p-2 text-right">{formatSAR(r.paid_out_sar)}</td>
                <td className="p-2 text-right font-bold">{formatSAR(payable(r))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid sm:grid-cols-3 gap-3">
          <select value={payFrom} onChange={(e) => setPayFrom(e.target.value)} className="border border-slate-300 rounded-xl px-3 py-2 bg-white sm:col-span-2" aria-label="Pay from">
            {sources.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} - {a.account_name_en}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-slate-300 rounded-xl px-3 py-2" />
        </div>
        <input placeholder={L('Reference (transfer no. / payroll month)', 'المرجع (رقم التحويل / شهر الرواتب)')} value={reference} onChange={(e) => setReference(e.target.value)} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
        <button
          type="button"
          disabled={saving || ids.length === 0}
          onClick={async () => {
            if (!window.confirm(`Approve and post a commission payout of SAR ${formatSAR(total)} to ${salesman.salesman_name}?`)) return;
            setSaving(true);
            await onSubmit({ ids, payFrom, reference, date });
            setSaving(false);
          }}
          className="w-full py-2.5 rounded-xl bg-emerald-600 disabled:bg-slate-300 text-white font-semibold cursor-pointer"
        >
          {saving ? L('Posting…', 'جارٍ الترحيل…') : L(`Approve & pay SAR ${formatSAR(total)}`, `اعتماد وصرف ${formatSAR(total)} ريال`)}
        </button>
      </div>
    </div>
  );
}
