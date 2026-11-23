import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatSAR } from './erpEngine';
import { downloadCsvFile } from './csvExport';
import { tr } from '../ui/financeI18n';

// ZATCA VAT return from the database (0009 vat_return): sales boxes by VAT category and exemption reason,
// purchases from POSTED bills / expenses / customs declarations / reverse charge, and a reconciliation of
// the return against the movement on GL 2100 (output VAT) and 1150 (input VAT) for the same period.
// `legacy` is rendered when the database function is not installed yet.
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function periodsFor(year, freq) {
  if (freq === 'monthly') return Array.from({ length: 12 }, (_, i) => ({ key: `${year}-${pad(i + 1)}`, from: `${year}-${pad(i + 1)}-01`, to: `${year}-${pad(i + 1)}-${lastDay(year, i + 1)}` }));
  return [1, 2, 3, 4].map((q) => ({ key: `${year}-Q${q}`, from: `${year}-${pad(q * 3 - 2)}-01`, to: `${year}-${pad(q * 3)}-${lastDay(year, q * 3)}` }));
}

export function VatReturnView({ supabase, legacy = null, lang = 'en' }) {
  const L = (en, ar) => (lang === 'ar' ? ar : en);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [freq, setFreq] = useState('quarterly');
  const periods = useMemo(() => periodsFor(year, freq), [year, freq]);
  const currentKey = freq === 'monthly' ? `${now.getFullYear()}-${pad(now.getMonth() + 1)}` : `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
  const [periodKey, setPeriodKey] = useState(currentKey);
  const period = periods.find((p) => p.key === periodKey) || periods[0];
  const [rows, setRows] = useState(null);
  const [state, setState] = useState('loading'); // loading | ok | missing | error
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setState('loading');
    supabase.rpc('vat_return', { p_from: period.from, p_to: period.to }).then(({ data, error: err }) => {
      if (!alive) return;
      if (err) {
        if (/vat_return|PGRST202|Could not find the function/i.test(`${err.code} ${err.message}`)) setState('missing');
        else {
          setError(err.message);
          setState('error');
        }
        return;
      }
      setRows(data || []);
      setState('ok');
    });
    return () => {
      alive = false;
    };
  }, [supabase, period.from, period.to]);

  if (state === 'missing') return legacy;

  const box = (b) => (rows || []).find((r) => r.box === b) || {};
  const returnRows = (rows || []).filter((r) => /^\d+$/.test(r.box));
  const diffOut = Number(box('GL-DIFF-OUT').vat_sar || 0);
  const diffIn = Number(box('GL-DIFF-IN').vat_sar || 0);
  const reconciled = Math.abs(diffOut) < 0.01 && Math.abs(diffIn) < 0.01;
  const net = Number(box('16').vat_sar || 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2"><Calculator className="w-5 h-5 text-slate-500" /> {L('ZATCA VAT Return', 'إقرار ضريبة القيمة المضافة')}</h2>
          <p className="text-xs text-slate-500">{L('Computed in the database from issued invoices and credit notes, posted bills, expenses and customs declarations — checked against the General Ledger.', 'محسوب في قاعدة البيانات ومطابق مع دفتر الأستاذ العام.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select value={freq} onChange={(e) => { setFreq(e.target.value); setPeriodKey(e.target.value === 'monthly' ? `${year}-${pad(now.getMonth() + 1)}` : `${year}-Q${Math.floor(now.getMonth() / 3) + 1}`); }} className="border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
            <option value="quarterly">{L('Quarterly', 'ربع سنوي')}</option>
            <option value="monthly">{L('Monthly', 'شهري')}</option>
          </select>
          <select value={year} onChange={(e) => { const y = Number(e.target.value); setYear(y); setPeriodKey(periodsFor(y, freq)[0].key); }} className="border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
            {[0, 1, 2, 3].map((d) => now.getFullYear() - d).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={period.key} onChange={(e) => setPeriodKey(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
            {periods.map((p) => <option key={p.key} value={p.key}>{p.key}</option>)}
          </select>
          <button type="button" disabled={state !== 'ok'}
            onClick={() => downloadCsvFile(`ZATCA_VAT_Return_${period.key}.csv`, ['Box', 'Description', 'Amount (SAR)', 'Adjustment (SAR)', 'VAT (SAR)'],
              (rows || []).map((r) => [r.box, r.label, r.amount_sar ?? '', r.adjustment_sar ?? '', r.vat_sar ?? '']))}
            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold cursor-pointer disabled:bg-slate-300">{tr("CSV")}</button>
        </div>
      </div>

      {state === 'error' && <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-xs text-rose-800">{error}</div>}
      {state === 'loading' && <div className="text-xs text-slate-500">{L('Calculating…', 'جارٍ الحساب…')}</div>}

      {state === 'ok' && (
        <>
          <div className={`rounded-2xl p-3 text-xs flex items-start gap-2 border ${reconciled ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
            {reconciled ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <div>
              {reconciled
                ? L('The return agrees with the General Ledger (2100 and 1150) for this period.', 'الإقرار مطابق لدفتر الأستاذ العام لهذه الفترة.')
                : L(`The return differs from the General Ledger: output VAT by SAR ${formatSAR(diffOut)}, input VAT by SAR ${formatSAR(diffIn)}. Usually a document without a journal, or a manual journal on 2100/1150 — check before filing.`,
                    `يوجد فرق مع دفتر الأستاذ: المخرجات ${formatSAR(diffOut)} والمدخلات ${formatSAR(diffIn)} ريال.`)}
              <div className="text-[11px] mt-0.5 opacity-80">{tr("GL 2100: SAR")}{" "}{formatSAR(box('GL-2100').vat_sar)} • GL 1150: SAR {formatSAR(box('GL-1150').vat_sar)}</div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 text-start">
                <tr>
                  <th className="p-3 w-12">{L('Box', 'الخانة')}</th>
                  <th className="p-3">{L('Description', 'البيان')}</th>
                  <th className="p-3 text-end">{L('Amount (SAR)', 'المبلغ')}</th>
                  <th className="p-3 text-end">{L('Adjustments', 'التعديلات')}</th>
                  <th className="p-3 text-end">{L('VAT (SAR)', 'الضريبة')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {returnRows.map((r) => {
                  const total = ['6', '12', '13', '16'].includes(r.box);
                  return (
                    <tr key={r.box} className={total ? 'bg-slate-50 font-bold' : ''}>
                      <td className="p-3 font-mono">{r.box}</td>
                      <td className="p-3">{tr(r.label)}</td>
                      <td className="p-3 text-end">{r.amount_sar === null ? '' : formatSAR(r.amount_sar)}</td>
                      <td className="p-3 text-end text-rose-700">{Number(r.adjustment_sar) ? formatSAR(r.adjustment_sar) : ''}</td>
                      <td className="p-3 text-end">{formatSAR(r.vat_sar)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={`rounded-2xl p-4 text-sm font-bold ${net >= 0 ? 'bg-blue-50 text-blue-900' : 'bg-emerald-50 text-emerald-900'}`}>
            {net >= 0 ? L('Net VAT payable to ZATCA', 'صافي الضريبة المستحقة') : L('Net VAT refundable / carried forward', 'رصيد ضريبي قابل للاسترداد')}: SAR {formatSAR(Math.abs(net))}
          </div>
          <p className="text-[11px] text-slate-400">
            {L('Boxes 11 (exempt purchases), 14 (corrections from previous periods) and 15 (credit carried forward) are not tracked yet — enter them on the Fatoora portal if they apply.',
               'الخانات 11 و14 و15 غير متتبعة بعد — أدخلها في بوابة فاتورة عند الحاجة.')}
          </p>
        </>
      )}
    </div>
  );
}
