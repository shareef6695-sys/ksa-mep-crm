import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, X, XCircle } from 'lucide-react';
import { buildMasterPreview, ITEM_TEMPLATE_HEADERS, toCsv, VENDOR_TEMPLATE_HEADERS } from '../../lib/masterImport';

const STATUS = {
  ready: { label: 'Ready', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  warning: { label: 'Import, check later', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  duplicate: { label: 'Skip: duplicate', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  error: { label: 'Cannot import', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  ignored: { label: 'Not imported', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

const KINDS = {
  vendor: {
    title: 'Import vendors from CSV',
    noun: ['vendor', 'vendors'],
    rpc: 'import_vendors',
    templateName: 'vendors-template.csv',
    template: [VENDOR_TEMPLATE_HEADERS, ['Example Trading Est.', 'مؤسسة مثال التجارية', 'KSA', '300000000000003', '4030000000', 'Mr. Ahmed', '0500000000',
      'sales@example.sa', 'Saudi Arabia', 'Jeddah', '1234 King Abdulaziz Rd, Al Rawdah, 23435', 'SAR', 'Net 30', 'SA0000000000000000000000']],
    numbering: 'Vendors are numbered automatically (VEND-…).',
    columns: [
      ['Vendor', (r) => <>{r.name_en}{r.name_ar && <div className="font-normal text-slate-500" dir="rtl">{r.name_ar}</div>}</>],
      ['Origin', (r) => r.vendor_origin],
      ['VAT / Tax ID', (r) => <span className="font-mono">{r.vat_number || '—'}</span>],
      ['City', (r) => [r.city, r.vendor_origin !== 'KSA' ? r.country : ''].filter(Boolean).join(', ') || '—'],
      ['Currency / terms', (r) => `${r.default_currency} · ${r.payment_terms}`],
    ],
  },
  item: {
    title: 'Import items from CSV',
    noun: ['item', 'items'],
    rpc: 'import_items',
    templateName: 'items-template.csv',
    template: [ITEM_TEMPLATE_HEADERS, ['Goods', 'Example PVC Pipe 110mm', 'أنبوب بي في سي ١١٠ مم', 'MEP', 'MTR', '25.50', '18.00', 'SAR', 'S', '', 'Example Trading Est.', 'no']],
    numbering: 'Items are numbered automatically (ITM-… for goods, SRV-… for services).',
    columns: [
      ['Item', (r) => <span className="block max-w-[22rem]">{r.name_en}</span>],
      ['Type', (r) => r.item_type],
      ['Division', (r) => r.category],
      ['Unit', (r) => r.uom],
      ['Sell / buy', (r) => `${r.sales_price_sar.toFixed(2)} / ${r.purchase_price.toFixed(2)}`],
      ['VAT', (r) => r.zatca_vat_type],
    ],
  },
};

function download(filename, text) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Vendors / Items -> Import CSV. kind = 'vendor' | 'item'; calls import_vendors / import_items (0019). */
export function MasterImportModal({ kind, supabase, existing, onClose, onImported }) {
  const cfg = KINDS[kind];
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState('');
  const [snapshot, setSnapshot] = useState([]); // records in the ERP when the file was chosen
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const preview = useMemo(() => (text ? buildMasterPreview(kind, text, snapshot) : null), [kind, text, snapshot]);
  const shown = preview ? preview.rows.filter((r) => !onlyIssues || r.status !== 'ready') : [];
  const n = preview?.importable.length || 0;

  const readFile = (file) => {
    if (!file) return;
    setError('');
    setResult(null);
    if (file.size > 5 * 1024 * 1024) return setError('That file is larger than 5 MB. Split it into smaller files.');
    const reader = new FileReader();
    reader.onload = () => { setSnapshot(existing || []); setFileName(file.name); setText(String(reader.result || '')); };
    reader.onerror = () => setError('Could not read the file.');
    reader.readAsText(file, 'utf-8');
  };

  const runImport = async () => {
    if (!n) return;
    setBusy(true);
    setError('');
    const { data, error: e } = await supabase.rpc(cfg.rpc, { p_rows: preview.importable });
    setBusy(false);
    if (e) return setError(e.message);
    setResult(data);
    onImported?.();
  };

  const downloadReport = () => {
    const byRow = new Map((result?.results || []).map((r) => [r.row, r]));
    const rows = preview.rows.map((r) => {
      const res = byRow.get(r.row);
      return [r.row, r.record?.name_en || '', res?.code || '', res?.status || (r.status === 'error' ? 'rejected' : r.status),
        [...(r.errors || []), ...(r.warnings || []), res?.reason, r.reason].filter(Boolean).join('; ')];
    });
    download(`${cfg.noun[1]}-import-report-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['CSV row', 'Name', 'Code', 'Result', 'To check / reason'], rows));
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={cfg.title}>
      <div className="bg-white w-full sm:max-w-6xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{cfg.title}</h3>
            <p className="text-slate-500">Blank template or a Zoho Books export. Nothing is saved until you press Import.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-2.5">{error}</div>}

          {!result && (
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} data-testid={`${kind}-import-file`} />
              <button type="button" onClick={() => fileRef.current?.click()} className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-1.5">
                <FileUp className="w-4 h-4" /> {fileName ? 'Choose another file' : 'Choose CSV file'}
              </button>
              {fileName && <span className="text-slate-600 font-mono">{fileName}</span>}
              <button type="button" onClick={() => download(cfg.templateName, toCsv(...cfg.template.slice(0, 1), cfg.template.slice(1)))}
                className="ml-auto px-3 py-2 rounded-xl border border-slate-300 font-semibold flex items-center gap-1.5">
                <Download className="w-4 h-4" /> Blank template
              </button>
            </div>
          )}

          {preview && !result && (
            <>
              <div className="flex flex-wrap gap-2" data-testid={`${kind}-import-summary`}>
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 font-semibold">{preview.summary.total} rows{preview.format === 'zoho' ? ' · Zoho Books export' : ''}</span>
                <span className="px-2.5 py-1 rounded-lg border bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold">{preview.summary.ready} ready</span>
                <span className="px-2.5 py-1 rounded-lg border bg-amber-50 text-amber-800 border-amber-200 font-semibold">{preview.summary.warning} import, check later</span>
                {!!preview.summary.duplicate && <span className="px-2.5 py-1 rounded-lg border bg-slate-100 text-slate-600 font-semibold">{preview.summary.duplicate} duplicates skipped</span>}
                {!!preview.summary.error && <span className="px-2.5 py-1 rounded-lg border bg-rose-50 text-rose-700 border-rose-200 font-semibold">{preview.summary.error} cannot import</span>}
                {!!preview.summary.ignored && <span className="px-2.5 py-1 rounded-lg border bg-slate-100 text-slate-500 font-semibold">{preview.summary.ignored} not imported</span>}
                <label className="ml-auto flex items-center gap-1.5 text-slate-600">
                  <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only rows with issues
                </label>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2.5 py-2">Row</th><th className="px-2.5 py-2">Status</th>
                      {cfg.columns.map(([h]) => <th key={h} className="px-2.5 py-2">{h}</th>)}
                      <th className="px-2.5 py-2">Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.row} className="border-t border-slate-100 align-top">
                        <td className="px-2.5 py-2 font-mono text-slate-400">{r.row}</td>
                        <td className="px-2.5 py-2"><span className={`px-2 py-0.5 rounded border whitespace-nowrap ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                        {cfg.columns.map(([h, cell], j) => (
                          <td key={h} className={`px-2.5 py-2 ${j === 0 ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{r.record ? cell(r.record) : ''}</td>
                        ))}
                        <td className="px-2.5 py-2 text-slate-600">{[...(r.errors || []), ...(r.warnings || []), r.reason].filter(Boolean).join(' · ')}</td>
                      </tr>
                    ))}
                    {!shown.length && <tr><td colSpan={cfg.columns.length + 3} className="px-2.5 py-6 text-center text-slate-400">No rows to show.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-slate-500">{cfg.numbering} Rows marked &ldquo;check later&rdquo; are imported; the report lists what to review.</p>
            </>
          )}

          {result && (
            <div className="space-y-3" data-testid={`${kind}-import-result`}>
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-700"><CheckCircle2 className="w-5 h-5" /> Imported {result.inserted} {result.inserted === 1 ? cfg.noun[0] : cfg.noun[1]}</div>
              <div className="flex flex-wrap gap-2">
                {!!result.skipped && <span className="px-2.5 py-1 rounded-lg bg-slate-100 font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {result.skipped} skipped (already in the ERP)</span>}
                {!!result.rejected && <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 font-semibold flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> {result.rejected} rejected</span>}
              </div>
              <button type="button" onClick={downloadReport} className="px-3.5 py-2 rounded-xl border border-slate-300 font-semibold flex items-center gap-1.5">
                <Download className="w-4 h-4" /> Download import report
              </button>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-300 font-semibold">{result ? 'Close' : 'Cancel'}</button>
          {!result && (
            <button type="button" disabled={busy || !n} onClick={runImport}
              className="px-5 py-2 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-40 flex items-center gap-1.5">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Import {n} {n === 1 ? cfg.noun[0] : cfg.noun[1]}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
