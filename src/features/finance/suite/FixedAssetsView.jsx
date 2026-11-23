// FixedAssetsView (split from erp/FinanceSuiteViews.jsx, Prompt 15).
import { Building, Calculator, Download, Plus } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { downloadCsvFile } from '../../../erp/csvExport';
import { formatSAR } from '../../../erp/erpEngine';
import { Header, Modal, Notice, accLabel, addMonths, assetMonthly, btnCsv, btnDark, btnPrimary, cashAccountsOf, inputCls, labelCls, lockError, monthKey, num, r2, rpcOrThrow, todayStr } from './shared';
import { tr } from '../../../ui/financeI18n';

const lastDayOfMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${ym}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

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
    if (!form.name.trim() || cost <= 0) return setMsg({ type: 'error', text: tr('Asset name and a cost greater than zero are required.') });
    if (num(form.salvage_value_sar) >= cost) return setMsg({ type: 'error', text: tr('Salvage value must be less than cost.') });
    if (num(form.useful_life_months) < 1) return setMsg({ type: 'error', text: tr('Useful life must be at least 1 month.') });
    const le = lockError(form.acquisition_date, lockDate);
    if (le) return setMsg({ type: 'error', text: le });
    setSaving(true);
    try {
      const asset = await rpcOrThrow(supabase, 'post_fixed_asset', {
        p: {
          name: form.name.trim(),
          category_account_code: form.category_account_code,
          acquisition_date: form.acquisition_date,
          cost_sar: cost,
          salvage_value_sar: r2(form.salvage_value_sar),
          useful_life_months: Math.round(num(form.useful_life_months)),
          paid_from_account_code: form.paid_from_account_code,
        },
      });
      const code = asset.asset_code;
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
      const jv = await rpcOrThrow(supabase, 'post_depreciation_run', {
        p_period: period,
        p_assets: runPreview.map((r) => ({ id: r.asset.id, amount: r.amount, months: r.months })),
      });
      const docNo = jv.source_doc_number;
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
      const proceeds = r2(disp.proceeds);
      const gain = r2(proceeds - (num(a.cost_sar) - num(a.accumulated_depreciation_sar)));
      await rpcOrThrow(supabase, 'dispose_fixed_asset', { p_id: a.id, p_date: disp.date, p_proceeds: proceeds, p_account: disp.account });
      setMsg({ type: 'ok', text: `${a.asset_code} disposed. ${gain >= 0 ? tr('Gain') : tr('Loss')} of SAR ${formatSAR(Math.abs(gain))} recognised.` });
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
      <Header icon={Building} title={tr("Fixed Asset Register & Depreciation • سجل الأصول الثابتة")} subtitle={tr("Capitalise equipment, vehicles & IT assets, run straight-line monthly depreciation and record disposals with automatic gain/loss.")}>
        <button type="button" onClick={exportCsv} className={btnCsv}><Download className="w-4 h-4" /> {tr("Export CSV")}</button>
        <button type="button" onClick={() => setShowRegister(true)} className={btnPrimary}><Plus className="w-4 h-4" /> {tr("Register Asset")}</button>
      </Header>

      <Notice msg={msg} onClear={() => setMsg(null)} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-semibold text-slate-500">{tr("Gross Cost (in use)")}</div><div className="mt-1 font-mono font-bold">{tr("SAR")}{" "}{formatSAR(totals.cost)}</div></div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-semibold text-slate-500">{tr("Accumulated Depreciation")}</div><div className="mt-1 font-mono font-bold text-rose-600">{tr("SAR")}{" "}{formatSAR(totals.acc)}</div></div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-semibold text-slate-500">{tr("Net Book Value")}</div><div className="mt-1 font-mono font-bold text-emerald-700">{tr("SAR")}{" "}{formatSAR(totals.cost - totals.acc)}</div></div>
      </div>

      <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div><label className={labelCls}>{tr("Depreciate up to (month)")}</label><input type="month" className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value)} /></div>
          <button type="button" onClick={runDepreciation} disabled={saving || runPreview.length === 0} className={btnDark}><Calculator className="w-4 h-4" /> {tr("Run Depreciation (SAR")}{" "}{formatSAR(runTotal)})</button>
          <span className="text-[11px] text-slate-500">{tr("Posts one journal: Dr 5270 Depreciation Expense / Cr 1590 Accumulated Depreciation, dated")}{" "}{lastDayOfMonth(period)}.</span>
        </div>
        {runPreview.length > 0 && (
          <div className="text-xs text-slate-600 flex flex-wrap gap-2">
            {runPreview.map((r) => <span key={r.asset.id} className="px-2 py-0.5 rounded bg-slate-100">{r.asset.asset_code}: {r.months} mo • SAR {formatSAR(r.amount)}</span>)}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
        <table className="w-full text-start text-xs">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="p-3">{tr("Asset")}</th><th className="p-3">{tr("Category")}</th><th className="p-3">{tr("Acquired")}</th><th className="p-3 text-end">{tr("Cost")}</th><th className="p-3 text-end">{tr("Monthly")}</th>
              <th className="p-3 text-end">{tr("Accumulated")}</th><th className="p-3 text-end">{tr("NBV")}</th><th className="p-3">{tr("Last Period")}</th><th className="p-3">{tr("Status")}</th><th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {fixedAssets.length === 0 && <tr><td colSpan={10} className="p-8 text-center text-slate-400">{tr("No fixed assets registered yet.")}</td></tr>}
            {fixedAssets.map((a) => (
              <Fragment key={a.id}>
                <tr className="hover:bg-slate-50/70 cursor-pointer" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                  <td className="p-3"><div className="font-mono font-bold text-blue-700">{a.asset_code}</div><div className="font-semibold text-slate-800">{a.name}</div></td>
                  <td className="p-3">{accLabel(glAccounts, a.category_account_code)}</td>
                  <td className="p-3 whitespace-nowrap">{a.acquisition_date}</td>
                  <td className="p-3 text-end font-mono">{formatSAR(a.cost_sar)}</td>
                  <td className="p-3 text-end font-mono">{formatSAR(assetMonthly(a))}</td>
                  <td className="p-3 text-end font-mono text-rose-600">{formatSAR(a.accumulated_depreciation_sar)}</td>
                  <td className="p-3 text-end font-mono font-bold">{formatSAR(num(a.cost_sar) - num(a.accumulated_depreciation_sar))}</td>
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
                      <div className="text-[11px] font-bold text-slate-600 mb-1">{tr("Upcoming schedule (next 12 months)")}</div>
                      {schedule(a).length === 0 ? (
                        <div className="text-slate-400">{tr("Fully depreciated or disposed.")}</div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                          {schedule(a).map((s) => (
                            <div key={s.period} className="bg-white border border-slate-200 rounded-lg p-2">
                              <div className="font-bold">{s.period}</div>
                              <div className="text-slate-500">{tr("Dep")}{" "}{formatSAR(s.dep)}</div>
                              <div className="text-slate-500">{tr("NBV")}{" "}{formatSAR(s.nbv)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {showRegister && (
        <Modal title={tr("Register Fixed Asset")} onClose={() => setShowRegister(false)} wide>
          <form onSubmit={register} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2"><label className={labelCls}>{tr("Asset Name")}</label><input required className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tr("e.g. Toyota Hilux 2026 — Site Pickup")} /></div>
              <div>
                <label className={labelCls}>{tr("Category (GL)")}</label>
                <select className={inputCls} value={form.category_account_code} onChange={(e) => setForm({ ...form, category_account_code: e.target.value })}>
                  {categoryOpts.map((c) => <option key={c.account_code} value={c.account_code}>{c.account_code} — {c.account_name_en}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>{tr("Acquisition Date")}</label><input type="date" required className={inputCls} value={form.acquisition_date} onChange={(e) => setForm({ ...form, acquisition_date: e.target.value })} /></div>
              <div><label className={labelCls}>{tr("Cost (SAR, excl. VAT)")}</label><input type="number" step="0.01" min="0" required className={inputCls} value={form.cost_sar} onChange={(e) => setForm({ ...form, cost_sar: e.target.value })} /></div>
              <div><label className={labelCls}>{tr("Salvage Value (SAR)")}</label><input type="number" step="0.01" min="0" className={inputCls} value={form.salvage_value_sar} onChange={(e) => setForm({ ...form, salvage_value_sar: e.target.value })} /></div>
              <div><label className={labelCls}>{tr("Useful Life (months)")}</label><input type="number" min="1" required className={inputCls} value={form.useful_life_months} onChange={(e) => setForm({ ...form, useful_life_months: e.target.value })} /></div>
              <div>
                <label className={labelCls}>{tr("Paid From")}</label>
                <select className={inputCls} value={form.paid_from_account_code} onChange={(e) => setForm({ ...form, paid_from_account_code: e.target.value })}>
                  {cashOpts.map((c) => <option key={c.account_code} value={c.account_code}>{c.account_code} — {c.account_name_en}</option>)}
                  <option value="2010">{tr("2010 — On Credit (Accounts Payable)")}</option>
                </select>
              </div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-xs">{tr("Monthly straight-line depreciation:")} <strong className="font-mono">{tr("SAR")}{" "}{formatSAR(Math.max(0, num(form.cost_sar) - num(form.salvage_value_sar)) / Math.max(1, num(form.useful_life_months)))}</strong> {tr("— starts the month after acquisition.")}</div>
            <button type="submit" disabled={saving} className={`${btnPrimary} w-full justify-center py-2.5`}>{saving ? tr('Posting…') : tr('Capitalise Asset & Post to GL')}</button>
          </form>
        </Modal>
      )}

      {disposeAsset && (
        <Modal title={`Dispose ${disposeAsset.asset_code} — ${disposeAsset.name}`} onClose={() => setDisposeAsset(null)}>
          <form onSubmit={submitDisposal} className="space-y-3">
            <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1">
              <div className="flex justify-between"><span>{tr("Cost")}</span><span className="font-mono">{tr("SAR")}{" "}{formatSAR(disposeAsset.cost_sar)}</span></div>
              <div className="flex justify-between"><span>{tr("Accumulated depreciation")}</span><span className="font-mono">{tr("SAR")}{" "}{formatSAR(disposeAsset.accumulated_depreciation_sar)}</span></div>
              <div className="flex justify-between font-bold"><span>{tr("Net book value")}</span><span className="font-mono">{tr("SAR")}{" "}{formatSAR(num(disposeAsset.cost_sar) - num(disposeAsset.accumulated_depreciation_sar))}</span></div>
            </div>
            <div><label className={labelCls}>{tr("Disposal Date")}</label><input type="date" required className={inputCls} value={disp.date} onChange={(e) => setDisp({ ...disp, date: e.target.value })} /></div>
            <div><label className={labelCls}>{tr("Sale Proceeds (SAR, excl. VAT — 0 if scrapped)")}</label><input type="number" step="0.01" min="0" className={inputCls} value={disp.proceeds} onChange={(e) => setDisp({ ...disp, proceeds: e.target.value })} /></div>
            <div>
              <label className={labelCls}>{tr("Proceeds Received Into")}</label>
              <select className={inputCls} value={disp.account} onChange={(e) => setDisp({ ...disp, account: e.target.value })}>
                {cashOpts.map((c) => <option key={c.account_code} value={c.account_code}>{c.account_code} — {c.account_name_en}</option>)}
              </select>
            </div>
            <div className="text-xs font-semibold">
              {(() => {
                const g = num(disp.proceeds) - (num(disposeAsset.cost_sar) - num(disposeAsset.accumulated_depreciation_sar));
                return g >= 0 ? <span className="text-emerald-700">{tr("Gain on disposal: SAR")}{" "}{formatSAR(g)} (Cr 4900)</span> : <span className="text-rose-600">{tr("Loss on disposal: SAR")}{" "}{formatSAR(Math.abs(g))} (Dr 5100)</span>;
              })()}
            </div>
            <button type="submit" disabled={saving} className={`${btnPrimary} w-full justify-center py-2.5`}>{saving ? tr('Posting…') : tr('Post Disposal')}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Budget vs Actual                                                 */
/* ------------------------------------------------------------------ */
