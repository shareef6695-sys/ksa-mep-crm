import React, { useState } from 'react';
import { Hash, Save, CheckCircle2 } from 'lucide-react';

export function NumberRangesView({ supabase, ranges, onRefresh }) {
  const [edits, setEdits] = useState({});
  const [savedType, setSavedType] = useState('');

  const getRow = (r) => ({ ...r, ...(edits[r.doc_type] || {}) });

  const handleFieldChange = (docType, field, value) => {
    setEdits((prev) => ({
      ...prev,
      [docType]: {
        ...(prev[docType] || {}),
        [field]: value,
      },
    }));
  };

  const formatPreview = (row) => {
    const yr = new Date().getFullYear();
    const numStr = String(Number(row.next_number) || 1).padStart(Number(row.padding) || 4, '0');
    return row.include_year ? `${row.prefix}-${yr}-${numStr}` : `${row.prefix}-${numStr}`;
  };

  const handleSaveRow = async (r) => {
    const row = getRow(r);
    await supabase
      .from('document_number_ranges')
      .update({
        prefix: (row.prefix || '').trim().toUpperCase(),
        include_year: Boolean(row.include_year),
        padding: Math.min(8, Math.max(2, Number(row.padding) || 4)),
        next_number: Math.max(1, Number(row.next_number) || 1),
        reset_annually: Boolean(row.reset_annually),
        updated_at: new Date().toISOString(),
      })
      .eq('doc_type', r.doc_type);

    setSavedType(r.doc_type);
    setTimeout(() => setSavedType(''), 2500);
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base sm:text-lg font-bold text-slate-900">Document Number Ranges (ZATCA Sequential Audit Series)</h2>
        <p className="text-xs text-slate-500">
          Configure prefixes, zero-padding digits, annual year resets, and next starting counter for every master and transaction document.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="p-3">Document Type</th>
              <th className="p-3">Prefix</th>
              <th className="p-3 text-center">Include Year</th>
              <th className="p-3 text-center">Zero Digits</th>
              <th className="p-3 text-right">Next Counter</th>
              <th className="p-3 text-center">Annual Reset</th>
              <th className="p-3">Next Number Preview</th>
              <th className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ranges.map((r) => {
              const row = getRow(r);
              return (
                <tr key={r.doc_type} className="hover:bg-slate-50/70">
                  <td className="p-3 font-bold text-slate-900">{row.label}</td>
                  <td className="p-3">
                    <input
                      type="text"
                      maxLength={10}
                      value={row.prefix}
                      onChange={(e) => handleFieldChange(r.doc_type, 'prefix', e.target.value.toUpperCase())}
                      className="w-24 border border-slate-300 rounded-lg px-2 py-1 font-mono font-bold uppercase"
                    />
                  </td>
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={Boolean(row.include_year)}
                      onChange={(e) => handleFieldChange(r.doc_type, 'include_year', e.target.checked)}
                    />
                  </td>
                  <td className="p-3 text-center">
                    <input
                      type="number"
                      min="2"
                      max="8"
                      value={row.padding}
                      onChange={(e) => handleFieldChange(r.doc_type, 'padding', e.target.value)}
                      className="w-14 border border-slate-300 rounded-lg px-2 py-1 text-center font-mono"
                    />
                  </td>
                  <td className="p-3 text-right">
                    <input
                      type="number"
                      min="1"
                      value={row.next_number}
                      onChange={(e) => handleFieldChange(r.doc_type, 'next_number', e.target.value)}
                      className="w-24 border border-slate-300 rounded-lg px-2 py-1 text-right font-mono font-bold"
                    />
                  </td>
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={Boolean(row.reset_annually)}
                      onChange={(e) => handleFieldChange(r.doc_type, 'reset_annually', e.target.checked)}
                    />
                  </td>
                  <td className="p-3">
                    <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-mono font-bold">
                      {formatPreview(row)}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => handleSaveRow(r)}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-blue-600 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      {savedType === r.doc_type ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Saved</> : <><Save className="w-3.5 h-3.5" /> Save</>}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}