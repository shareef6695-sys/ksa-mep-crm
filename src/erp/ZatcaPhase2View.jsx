import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { callZatca } from '../lib/zatca';

// ZATCA Phase 2 onboarding and monitoring. The keys, CSR and CSIDs are made and kept by the `zatca` Edge Function;
// this screen only sends the company's choices and shows the state from public.zatca_egs_status.
const ENV_LABEL = {
  sandbox: 'Developer portal sandbox (test, fixed OTP)',
  simulation: 'Simulation (Fatoora simulation portal OTP)',
  production: 'Production (live Fatoora portal OTP)',
};

const newSerial = () => `1-Horizon ERP|2-1.0|3-${(crypto.randomUUID?.() || String(Date.now())).slice(0, 18)}`;

export function ZatcaPhase2View({ supabase, company, canOnboard, onChanged, lang = 'en' }) {
  const L = (en, ar) => (lang === 'ar' ? ar : en);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({
    environment: 'sandbox', otp: '', commonName: `${(company?.nameEn || 'EGS').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 30)}-EGS-1`,
    serialNumber: newSerial(), invoiceType: '1100', organizationUnit: '', location: [company?.buildingNo, company?.street, company?.city].filter(Boolean).join(' '),
    industry: 'MEP & IT Trading',
  });

  const load = useCallback(async () => {
    setError('');
    try {
      setState(await callZatca(supabase, 'status'));
    } catch (e) {
      setError(e.message);
    }
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (label, action, body) => {
    setBusy(label);
    setError('');
    setResult(null);
    try {
      const r = await callZatca(supabase, action, body);
      setResult(r);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const active = (state?.units || []).find((u) => u.is_active);
  const stuck = (state?.units || []).find((u) => !u.is_active && ['compliance', 'compliance_passed'].includes(u.status));
  const sellerGaps = [['vatNumber', 'VAT number'], ['crNumber', 'CR number'], ['buildingNo', 'building no.'], ['street', 'street'], ['district', 'district'], ['city', 'city'], ['postalCode', 'postal code']]
    .filter(([k]) => !String(company?.[k] || '').trim()).map(([, l]) => l);

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-600" /> {L('ZATCA Phase 2 (Fatoora integration)', 'المرحلة الثانية - الربط مع فاتورة')}</h2>
          <p className="text-slate-500">{L('B2B tax invoices are cleared by ZATCA before they are shared; B2C invoices are reported within 24 hours. Keys and certificates stay on the server.', 'تعتمد الفواتير الضريبية قبل مشاركتها ويبلغ عن المبسطة خلال 24 ساعة.')}</p>
        </div>
        <button type="button" onClick={load} className="px-3 py-1.5 rounded-lg border border-slate-300 flex items-center gap-1 cursor-pointer"><RefreshCw className="w-3.5 h-3.5" /> {L('Refresh', 'تحديث')}</button>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 whitespace-pre-wrap">{error}</div>}

      <div className={`rounded-2xl border p-4 ${active ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        {active ? (
          <div className="space-y-1">
            <div className="font-bold text-emerald-900">{L('Phase 2 active', 'المرحلة الثانية مفعلة')} — {ENV_LABEL[active.environment]}</div>
            <div className="text-emerald-800">EGS {active.csr_input?.commonName} • {L('documents signed', 'مستندات موقعة')}: {active.last_icv} • {L('certificate valid until', 'صلاحية الشهادة حتى')} {active.certificate_expires_at ? new Date(active.certificate_expires_at).toLocaleDateString() : '—'}</div>
            {active.environment !== 'production' && <div className="text-amber-800 font-semibold">{L('This is a test environment: invoices are not legally reported. Onboard Production before go-live.', 'بيئة اختبار: الفواتير لا تُبلغ رسمياً.')}</div>}
          </div>
        ) : (
          <div className="text-amber-900 font-semibold">{L('Phase 2 is not active. Invoices carry the Phase 1 QR only.', 'المرحلة الثانية غير مفعلة.')}</div>
        )}
        {state && (
          <div className="mt-2 flex flex-wrap gap-3 items-center">
            <span>{L('Waiting for ZATCA', 'بانتظار الهيئة')}: <strong>{state.queued}</strong></span>
            {(state.overdue_b2c || []).length > 0 && <span className="text-rose-700 font-bold">{L('B2C documents past the 24-hour reporting deadline', 'مستندات مبسطة تجاوزت 24 ساعة')}: {state.overdue_b2c.length}</span>}
            {active && state.queued > 0 && (
              <button type="button" disabled={!!busy} onClick={() => run('queue', 'process_queue', { limit: 50 })} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold cursor-pointer disabled:bg-slate-400">
                {busy === 'queue' ? L('Sending…', 'جارٍ الإرسال…') : L('Send queued documents now', 'إرسال المستندات الآن')}
              </button>
            )}
          </div>
        )}
      </div>

      {result?.results && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">{L('Document', 'المستند')}</th><th className="p-2.5">{L('Result', 'النتيجة')}</th><th className="p-2.5">{L('Messages', 'الرسائل')}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {result.results.map((r, i) => (
                <tr key={i}>
                  <td className="p-2.5 font-semibold">{r.document || r.doc}</td>
                  <td className="p-2.5">{r.ok || ['cleared', 'reported'].includes(r.status) ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : r.error || r.ok === false || r.status === 'rejected' ? <XCircle className="w-4 h-4 text-rose-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />} {r.status || r.result || ''}</td>
                  <td className="p-2.5 text-slate-600">{[r.error, ...(r.errors || []).map((x) => x.message || x), ...(r.warnings || []).map((x) => `⚠ ${x.message || x}`)].filter(Boolean).join(' • ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result?.activated && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 font-semibold text-emerald-900">{L('Production CSID received. Phase 2 is now active.', 'تم استلام شهادة الإنتاج وتفعيل المرحلة الثانية.')}</div>}

      {stuck && canOnboard && (
        <div className="bg-white border border-amber-200 rounded-2xl p-4 space-y-2">
          <div className="font-bold">{L('Onboarding not finished', 'التسجيل لم يكتمل')}: {stuck.csr_input?.commonName} ({stuck.environment}) — {stuck.status === 'compliance_passed' ? L('compliance checks passed', 'اجتاز فحوص الامتثال') : L('compliance checks pending / failed', 'فحوص الامتثال لم تكتمل')}</div>
          {stuck.last_error && <div className="text-amber-800">{stuck.last_error}</div>}
          <div className="flex gap-2">
            <button type="button" disabled={!!busy} onClick={() => run('checks', 'compliance_checks', { egs_id: stuck.id })} className="px-3 py-1.5 rounded-lg border border-slate-300 font-semibold cursor-pointer">{busy === 'checks' ? '…' : L('Re-run compliance checks', 'إعادة فحوص الامتثال')}</button>
            <button type="button" disabled={!!busy || stuck.status !== 'compliance_passed'} onClick={() => run('activate', 'activate', { egs_id: stuck.id })} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold cursor-pointer disabled:bg-slate-300">{busy === 'activate' ? '…' : L('Get Production CSID and activate', 'طلب شهادة الإنتاج والتفعيل')}</button>
          </div>
        </div>
      )}

      {canOnboard ? (
        <form
          className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (active && !window.confirm(L('An EGS unit is already active. Onboarding a new one switches all new documents to it. Continue?', 'يوجد جهاز مفعل. متابعة؟'))) return;
            run('onboard', 'onboard', {
              environment: form.environment, otp: form.otp,
              csr: { commonName: form.commonName, serialNumber: form.serialNumber, invoiceType: form.invoiceType, organizationUnit: form.organizationUnit, location: form.location, industry: form.industry, organizationName: company?.nameEn },
            });
          }}
        >
          <div className="font-bold text-sm">{active ? L('Onboard a new EGS unit', 'تسجيل جهاز جديد') : L('Onboard this ERP with ZATCA', 'تسجيل النظام لدى الهيئة')}</div>
          {sellerGaps.length > 0 && <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-amber-900">{L('Complete the company profile first', 'أكمل ملف الشركة أولاً')}: {sellerGaps.join(', ')}.</div>}
          <ol className="list-decimal ms-5 text-slate-600 space-y-0.5">
            <li>{L('Log in to the Fatoora portal (fatoora.zatca.gov.sa) → Onboard new solution unit/device → generate an OTP (valid 1 hour). The developer-portal sandbox does not check the OTP: any 6 digits (e.g. 123345) work there.', 'ادخل بوابة فاتورة وأنشئ رمز OTP.')}</li>
            <li>{L('Enter it below. The server generates the key and CSR, gets the Compliance CSID, runs ZATCA\'s compliance checks (sample invoice, credit and debit notes) and requests the Production CSID.', 'يقوم الخادم بباقي الخطوات.')}</li>
          </ol>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block"><span className="block font-semibold mb-1">{L('Environment', 'البيئة')}</span>
              <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white">
                {Object.entries(ENV_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block"><span className="block font-semibold mb-1">OTP *</span>
              <input required inputMode="numeric" pattern="\d{6}" maxLength={6} value={form.otp} onChange={(e) => setForm({ ...form, otp: e.target.value.replace(/\D/g, '') })} className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono" placeholder="123456" />
            </label>
            <label className="block"><span className="block font-semibold mb-1">{L('Unit name (common name)', 'اسم الجهاز')} *</span>
              <input required maxLength={64} value={form.commonName} onChange={(e) => setForm({ ...form, commonName: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </label>
            <label className="block"><span className="block font-semibold mb-1">{L('EGS serial number', 'الرقم التسلسلي')} *</span>
              <input required maxLength={64} value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono" />
            </label>
            <label className="block"><span className="block font-semibold mb-1">{L('Documents this unit issues', 'نوع المستندات')}</span>
              <select value={form.invoiceType} onChange={(e) => setForm({ ...form, invoiceType: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white">
                <option value="1100">{L('B2B tax invoices and B2C simplified invoices (1100)', 'ضريبية ومبسطة (1100)')}</option>
                <option value="1000">{L('B2B tax invoices only (1000)', 'ضريبية فقط (1000)')}</option>
                <option value="0100">{L('B2C simplified invoices only (0100)', 'مبسطة فقط (0100)')}</option>
              </select>
            </label>
            <label className="block"><span className="block font-semibold mb-1">{L('Branch / organization unit (optional)', 'الفرع (اختياري)')}</span>
              <input maxLength={64} value={form.organizationUnit} onChange={(e) => setForm({ ...form, organizationUnit: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" placeholder={L('Default: first 10 digits of the VAT number', 'افتراضياً أول 10 أرقام')} />
            </label>
            <label className="block"><span className="block font-semibold mb-1">{L('Branch location', 'موقع الفرع')} *</span>
              <input required maxLength={64} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </label>
            <label className="block"><span className="block font-semibold mb-1">{L('Industry', 'النشاط')} *</span>
              <input required maxLength={64} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </label>
          </div>
          <button type="submit" disabled={!!busy || sellerGaps.length > 0} className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-semibold cursor-pointer disabled:bg-slate-300">
            {busy === 'onboard' ? L('Onboarding with ZATCA… (up to a minute)', 'جارٍ التسجيل…') : L('Onboard', 'تسجيل')}
          </button>
        </form>
      ) : (
        <div className="text-slate-500">{L('Only a System Administrator can onboard EGS units.', 'التسجيل لمسؤول النظام فقط.')}</div>
      )}

      {(state?.units || []).length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">{L('Unit', 'الجهاز')}</th><th className="p-2.5">{L('Environment', 'البيئة')}</th><th className="p-2.5">{L('Status', 'الحالة')}</th><th className="p-2.5 text-right">{L('Signed', 'موقعة')}</th><th className="p-2.5">{L('Created', 'أنشئ')}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {state.units.map((u) => (
                <tr key={u.id}><td className="p-2.5 font-semibold">{u.csr_input?.commonName}</td><td className="p-2.5">{u.environment}</td><td className="p-2.5">{u.is_active ? '● active' : u.status}</td><td className="p-2.5 text-right">{u.last_icv}</td><td className="p-2.5">{new Date(u.created_at).toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
