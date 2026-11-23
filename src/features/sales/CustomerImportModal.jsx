import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, X, XCircle } from 'lucide-react';
import { buildImportPreview, TEMPLATE_HEADERS, toCsv } from '../../lib/customerImport';

const STATUS = {
  ready: { label: 'Ready', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  warning: { label: 'Import, complete later', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  duplicate: { label: 'Skip: duplicate', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  error: { label: 'Cannot import', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  ignored: { label: 'Not a customer', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

function download(filename, text) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Customers -> Import CSV. Reads a Zoho Books contacts export or the blank template, previews, then calls import_customers (0018). */
export function CustomerImportModal({ supabase, customers, onClose, onImported }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  // customers as they were when the file was chosen: after the import the list refreshes, and the preview / report
  // must keep describing this file, not mark every row as already imported
  const [existing, setExisting] = useState([]);

  const preview = useMemo(() => (text ? buildImportPreview(text, existing) : null), [text, existing]);
  const shown = preview ? preview.rows.filter((r) => !onlyIssues || r.status !== 'ready') : [];

  const readFile = (file) => {
    if (!file) return;
    setError('');
    setResult(null);
    if (file.size > 5 * 1024 * 1024) return setError('That file is larger than 5 MB. Split it into smaller files.');
    const reader = new FileReader();
    reader.onload = () => { setExisting(customers || []); setFileName(file.name); setText(String(reader.result || '')); };
    reader.onerror = () => setError('Could not read the file.');
    reader.readAsText(file, 'utf-8');
  };

  const runImport = async () => {
    if (!preview?.importable.length) return;
    setBusy(true);
    setError('');
    const { data, error: e } = await supabase.rpc('import_customers', { p_rows: preview.importable });
    setBusy(false);
    if (e) return setError(e.message);
    setResult(data);
    onImported?.();
  };

  // what each imported customer still needs, for completing the records afterwards
  const downloadReport = () => {
    const byRow = new Map((result?.results || []).map((r) => [r.row, r]));
    const rows = preview.rows.map((r) => {
      const res = byRow.get(r.row);
      return [r.row, r.customer?.name_en || '', res?.code || '', res?.status || (r.status === 'ignored' ? 'not a customer' : r.status === 'error' ? 'rejected' : r.status),
        [...(r.errors || []), ...(r.warnings || []), res?.reason, r.reason].filter(Boolean).join('; ')];
    });
    download(`customer-import-report-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['CSV row', 'Customer', 'Code', 'Result', 'To complete / reason'], rows));
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Import customers">
      <div className="bg-white w-full sm:max-w-5xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Import customers from CSV</h3>
            <p className="text-slate-500">Zoho Books contacts export or the blank template. Nothing is saved until you press Import.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-2.5">{error}</div>}

          {!result && (
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} data-testid="customer-import-file" />
              <button type="button" onClick={() => fileRef.current?.click()} className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-1.5">
                <FileUp className="w-4 h-4" /> {fileName ? 'Choose another file' : 'Choose CSV file'}
              </button>
              {fileName && <span className="text-slate-600 font-mono">{fileName}</span>}
              <button type="button" onClick={() => download('customers-template.csv', toCsv(TEMPLATE_HEADERS, [['Example Trading Co.', 'شركة مثال التجارية', 'B2B', '300000000000003', '4030000000', 'Mr. Ahmed', '0500000000', 'ap@example.sa', '1234', 'King Abdulaziz Rd', 'Al Rawdah', 'Jeddah', '23435', '5678', 'SA', '50000', 'Net 30']]))}
                className="ml-auto px-3 py-2 rounded-xl border border-slate-300 font-semibold flex items-center gap-1.5">
                <Download className="w-4 h-4" /> Blank template
              </button>
            </div>
          )}

          {preview && preview.format === 'unknown' && !result && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-2.5">
              The column names weren&apos;t recognised. Use the blank template&apos;s headers (name_en, vat_number, city, …) or a Zoho Books contacts export.
            </div>
          )}

          {preview && !result && (
            <>
              <div className="flex flex-wrap gap-2" data-testid="customer-import-summary">
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 font-semibold">{preview.summary.total} rows{preview.format === 'zoho' ? ' · Zoho Books export' : ''}</span>
                <span className="px-2.5 py-1 rounded-lg border bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold">{preview.summary.ready} ready</span>
                <span className="px-2.5 py-1 rounded-lg border bg-amber-50 text-amber-800 border-amber-200 font-semibold">{preview.summary.warning} import, complete later</span>
                {!!preview.summary.duplicate && <span className="px-2.5 py-1 rounded-lg border bg-slate-100 text-slate-600 font-semibold">{preview.summary.duplicate} duplicates skipped</span>}
                {!!preview.summary.error && <span className="px-2.5 py-1 rounded-lg border bg-rose-50 text-rose-700 border-rose-200 font-semibold">{preview.summary.error} cannot import</span>}
                {!!preview.summary.ignored && <span className="px-2.5 py-1 rounded-lg border bg-slate-100 text-slate-500 font-semibold">{preview.summary.ignored} not customers</span>}
                <label className="ml-auto flex items-center gap-1.5 text-slate-600">
                  <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only rows with issues
                </label>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2.5 py-2">Row</th><th className="px-2.5 py-2">Status</th><th className="px-2.5 py-2">Customer</th>
                      <th className="px-2.5 py-2">Type</th><th className="px-2.5 py-2">VAT</th><th className="px-2.5 py-2">Address</th>
                      <th className="px-2.5 py-2">Terms</th><th className="px-2.5 py-2">Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.row} className="border-t border-slate-100 align-top">
                        <td className="px-2.5 py-2 font-mono text-slate-400">{r.row}</td>
                        <td className="px-2.5 py-2"><span className={`px-2 py-0.5 rounded border whitespace-nowrap ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                        <td className="px-2.5 py-2 font-semibold text-slate-900">{r.customer?.name_en || <span className="text-slate-400">—</span>}
                          {r.customer?.name_ar && <div className="font-normal text-slate-500" dir="rtl">{r.customer.name_ar}</div>}</td>
                        <td className="px-2.5 py-2">{r.customer?.customer_type}</td>
                        <td className="px-2.5 py-2 font-mono">{r.customer?.vat_number || '—'}</td>
                        <td className="px-2.5 py-2 text-slate-600">{r.customer ? [r.customer.building_no, r.customer.street, r.customer.district, r.customer.city, r.customer.postal_code, r.customer.country !== 'SA' ? r.customer.country : ''].filter(Boolean).join(', ') || '—' : ''}</td>
                        <td className="px-2.5 py-2 whitespace-nowrap">{r.customer?.payment_terms}</td>
                        <td className="px-2.5 py-2 text-slate-600">{[...(r.errors || []), ...(r.warnings || []), r.reason].filter(Boolean).join(' · ')}</td>
                      </tr>
                    ))}
                    {!shown.length && <tr><td colSpan={8} className="px-2.5 py-6 text-center text-slate-400">No rows to show.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-slate-500">
                Customers are numbered automatically (CUST-…) and left unassigned to a salesman. Rows marked &ldquo;complete later&rdquo; are imported;
                ZATCA standard invoices need the buyer&apos;s VAT number and full national address, so complete those before invoicing them.
              </p>
            </>
          )}

          {result && (
            <div className="space-y-3" data-testid="customer-import-result">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-700"><CheckCircle2 className="w-5 h-5" /> Imported {result.inserted} customer{result.inserted === 1 ? '' : 's'}</div>
              <div className="flex flex-wrap gap-2">
                {!!result.skipped && <span className="px-2.5 py-1 rounded-lg bg-slate-100 font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {result.skipped} skipped (already in the ERP)</span>}
                {!!result.rejected && <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 font-semibold flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> {result.rejected} rejected</span>}
              </div>
              <p className="text-slate-600">Download the report for the list of customers that still need a VAT number, address or Arabic name.</p>
              <button type="button" onClick={downloadReport} className="px-3.5 py-2 rounded-xl border border-slate-300 font-semibold flex items-center gap-1.5">
                <Download className="w-4 h-4" /> Download import report
              </button>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-300 font-semibold">{result ? 'Close' : 'Cancel'}</button>
          {!result && (
            <button type="button" disabled={busy || !preview?.importable.length} onClick={runImport}
              className="px-5 py-2 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-40 flex items-center gap-1.5">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Import {preview?.importable.length || 0} customer{preview?.importable.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
