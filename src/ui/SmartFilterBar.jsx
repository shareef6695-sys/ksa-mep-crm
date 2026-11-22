import React, { useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal, X, Download, ArrowUp, ArrowDown, Filter } from 'lucide-react';
import { downloadCsvFile } from '../erp/csvExport';

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */
const LABELS = {
  en: {
    search: 'Search',
    adapt: 'Adapt Filters',
    hide: 'Hide Filters',
    clear: 'Clear',
    items: 'Items',
    of: 'of',
    sortBy: 'Sort by',
    none: 'None',
    asc: 'Ascending',
    desc: 'Descending',
    export: 'Export',
    all: 'All',
    from: 'From',
    to: 'To',
    min: 'Min',
    max: 'Max',
    empty: 'No items match the current filters.',
    remove: 'Remove filter',
  },
  ar: {
    search: 'بحث',
    adapt: 'تخصيص عوامل التصفية',
    hide: 'إخفاء عوامل التصفية',
    clear: 'مسح',
    items: 'العناصر',
    of: 'من',
    sortBy: 'ترتيب حسب',
    none: 'بدون',
    asc: 'تصاعدي',
    desc: 'تنازلي',
    export: 'تصدير',
    all: 'الكل',
    from: 'من',
    to: 'إلى',
    min: 'الحد الأدنى',
    max: 'الحد الأقصى',
    empty: 'لا توجد عناصر مطابقة لعوامل التصفية الحالية.',
    remove: 'إزالة عامل التصفية',
  },
};
const tr = (lang) => LABELS[lang] || LABELS.en;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
// Reads nested keys like "customer.name_en" as well as flat keys
const getVal = (row, key) => {
  if (!row || !key) return undefined;
  if (!String(key).includes('.')) return row[key];
  return String(key)
    .split('.')
    .reduce((acc, k) => (acc === null || acc === undefined ? undefined : acc[k]), row);
};

// Normalises ISO timestamps and YYYY-MM-DD to a comparable YYYY-MM-DD string (local date)
const toDay = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const isEmptyFilterValue = (f, v) => {
  if (v === undefined || v === null) return true;
  if (f.type === 'daterange' || f.type === 'numberrange') return !v.from && !v.to && v.from !== 0 && v.to !== 0;
  return v === '';
};

const compareValues = (a, b) => {
  const aNull = a === null || a === undefined || a === '';
  const bNull = b === null || b === undefined || b === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const na = Number(a);
  const nb = Number(b);
  if (typeof a !== 'boolean' && !Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
    return na - nb;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

const readStorage = (storageKey) => {
  if (!storageKey) return null;
  try {
    const raw = window.localStorage.getItem(`smartfilter:${storageKey}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeStorage = (storageKey, state) => {
  if (!storageKey) return;
  try {
    window.localStorage.setItem(`smartfilter:${storageKey}`, JSON.stringify(state));
  } catch {
    // storage blocked (private mode / quota) — filtering still works in memory
  }
};

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */
export function useSmartFilter(rows, config = {}) {
  const { storageKey, searchKeys = [], filters = [], defaultSort = null } = config;
  const safeRows = Array.isArray(rows) ? rows : [];

  const initial = useMemo(() => {
    const saved = readStorage(storageKey);
    return {
      search: saved?.search || '',
      values: saved?.values && typeof saved.values === 'object' ? saved.values : {},
      sort: saved?.sort !== undefined ? saved.sort : defaultSort,
    };
    // initial state only (re-read when the list identity changes)
  }, [storageKey]);

  const [search, setSearch] = useState(initial.search);
  const [values, setValues] = useState(initial.values);
  const [sort, setSort] = useState(initial.sort);

  useEffect(() => {
    writeStorage(storageKey, { search, values, sort });
  }, [storageKey, search, values, sort]);

  // Auto-derive select options from distinct row values when none supplied
  const resolvedFilters = useMemo(
    () =>
      filters.map((f) => {
        if (f.type !== 'select' || (Array.isArray(f.options) && f.options.length > 0)) return f;
        const distinct = Array.from(
          new Set(
            safeRows
              .map((r) => getVal(r, f.key))
              .filter((v) => v !== null && v !== undefined && v !== '')
              .map((v) => String(v))
          )
        ).sort((a, b) => a.localeCompare(b));
        return { ...f, options: distinct.map((v) => ({ value: v, label: v.replace(/_/g, ' ') })) };
      }),
    [filters, safeRows]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = safeRows.filter((row) => {
      if (!row) return false;
      if (q) {
        const keys = searchKeys.length > 0 ? searchKeys : Object.keys(row);
        const hit = keys.some((k) => {
          const v = getVal(row, k);
          return v !== null && v !== undefined && typeof v !== 'object' && String(v).toLowerCase().includes(q);
        });
        if (!hit) return false;
      }
      for (const f of resolvedFilters) {
        const fv = values[f.key];
        if (isEmptyFilterValue(f, fv)) continue;
        const rv = getVal(row, f.key);
        if (f.type === 'select') {
          if (String(rv ?? '') !== String(fv)) return false;
        } else if (f.type === 'daterange') {
          const day = toDay(rv);
          if (!day) return false;
          if (fv.from && day < fv.from) return false;
          if (fv.to && day > fv.to) return false;
        } else if (f.type === 'numberrange') {
          const n = Number(rv);
          if (rv === null || rv === undefined || Number.isNaN(n)) return false;
          if (fv.from !== '' && fv.from !== undefined && fv.from !== null && n < Number(fv.from)) return false;
          if (fv.to !== '' && fv.to !== undefined && fv.to !== null && n > Number(fv.to)) return false;
        } else if (f.type === 'text') {
          if (!String(rv ?? '').toLowerCase().includes(String(fv).toLowerCase())) return false;
        }
      }
      return true;
    });
    if (sort?.key) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => dir * compareValues(getVal(a, sort.key), getVal(b, sort.key)));
    }
    return out;
  }, [safeRows, search, searchKeys, resolvedFilters, values, sort]);

  const activeFilters = resolvedFilters.filter((f) => !isEmptyFilterValue(f, values[f.key]));

  const setFilterValue = (key, v) => setValues((prev) => ({ ...prev, [key]: v }));
  const clearFilter = (key) =>
    setValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  const clearAll = () => {
    setSearch('');
    setValues({});
  };

  return {
    rows: filteredRows,
    total: safeRows.length,
    search,
    setSearch,
    values,
    setFilterValue,
    clearFilter,
    clearAll,
    sort,
    setSort,
    filters: resolvedFilters,
    activeFilters,
  };
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
const inputCls =
  'w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'block text-[11px] font-semibold text-slate-500 mb-1';

const chipText = (f, v, t) => {
  if (f.type === 'select') {
    const opt = (f.options || []).find((o) => String(o.value) === String(v));
    return `${f.label}: ${opt?.label || v}`;
  }
  if (f.type === 'daterange' || f.type === 'numberrange') {
    const parts = [];
    if (v.from || v.from === 0) parts.push(`${t.from} ${v.from}`);
    if (v.to || v.to === 0) parts.push(`${t.to} ${v.to}`);
    return `${f.label}: ${parts.join(' ')}`;
  }
  return `${f.label}: ${v}`;
};

export function SmartFilterBar({
  lang = 'en',
  rows,
  storageKey,
  searchKeys = [],
  filters = [],
  sortOptions = [],
  defaultSort = null,
  csv,
  emptyText,
  children,
}) {
  const t = tr(lang);
  const sf = useSmartFilter(rows, { storageKey, searchKeys, filters, defaultSort });

  // Filter fields collapsed by default on small screens
  const [showFilters, setShowFilters] = useState(() => {
    try {
      return typeof window === 'undefined' ? true : window.matchMedia('(min-width: 768px)').matches;
    } catch {
      return true;
    }
  });

  const exportCsv = () => {
    if (!csv?.columns?.length) return;
    const headers = csv.columns.map((c) => c.label || c.key);
    const data = sf.rows.map((row) =>
      csv.columns.map((c) => {
        const v = typeof c.value === 'function' ? c.value(row) : getVal(row, c.key);
        return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : v;
      })
    );
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsvFile(`${csv.filename || 'Export'}_${stamp}.csv`, headers, data);
  };

  const hasAnyActive = sf.activeFilters.length > 0 || sf.search.trim() !== '';

  return (
    <div className="space-y-3">
      <div className="no-print bg-white border border-slate-200 rounded-2xl shadow-sm">
        {/* Top strip: search + toolbar */}
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={sf.search}
              onChange={(e) => sf.setSearch(e.target.value)}
              placeholder={t.search}
              aria-label={t.search}
              className={`${inputCls} ps-8`}
            />
          </div>

          {filters.length > 0 && (
            <button
              type="button"
              onClick={() => setShowFilters((s) => !s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer border ${
                showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
              aria-expanded={showFilters}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {showFilters ? t.hide : t.adapt}
              {sf.activeFilters.length > 0 && (
                <span className="px-1.5 rounded-full bg-blue-600 text-white text-[10px] font-bold">{sf.activeFilters.length}</span>
              )}
            </button>
          )}

          {sortOptions.length > 0 && (
            <div className="flex items-center gap-1">
              <label className="sr-only" htmlFor={`sf-sort-${storageKey || 'list'}`}>{t.sortBy}</label>
              <select
                id={`sf-sort-${storageKey || 'list'}`}
                value={sf.sort?.key || ''}
                onChange={(e) =>
                  sf.setSort(e.target.value ? { key: e.target.value, dir: sf.sort?.dir || 'desc' } : null)
                }
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white text-slate-700 cursor-pointer"
                title={t.sortBy}
              >
                <option value="">{`${t.sortBy}: ${t.none}`}</option>
                {sortOptions.map((o) => (
                  <option key={o.key} value={o.key}>{`${t.sortBy}: ${o.label}`}</option>
                ))}
              </select>
              {sf.sort?.key && (
                <button
                  type="button"
                  onClick={() => sf.setSort({ key: sf.sort.key, dir: sf.sort.dir === 'asc' ? 'desc' : 'asc' })}
                  className="p-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
                  title={sf.sort.dir === 'asc' ? t.asc : t.desc}
                  aria-label={sf.sort.dir === 'asc' ? t.asc : t.desc}
                >
                  {sf.sort.dir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          )}

          {csv?.columns?.length > 0 && (
            <button
              type="button"
              onClick={exportCsv}
              disabled={sf.rows.length === 0}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" /> {t.export}
            </button>
          )}
        </div>

        {/* Filter fields */}
        {showFilters && sf.filters.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 px-3 pb-3 border-t border-slate-100 pt-3">
            {sf.filters.map((f) => {
              const v = sf.values[f.key];
              if (f.type === 'select') {
                return (
                  <div key={f.key}>
                    <label className={labelCls}>{f.label}</label>
                    <select value={v ?? ''} onChange={(e) => (e.target.value === '' ? sf.clearFilter(f.key) : sf.setFilterValue(f.key, e.target.value))} className={inputCls}>
                      <option value="">{t.all}</option>
                      {(f.options || []).map((o) => (
                        <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                );
              }
              if (f.type === 'daterange' || f.type === 'numberrange') {
                const isDate = f.type === 'daterange';
                const range = v || { from: '', to: '' };
                const update = (side, val) => {
                  const next = { ...range, [side]: val };
                  if (!next.from && !next.to) sf.clearFilter(f.key);
                  else sf.setFilterValue(f.key, next);
                };
                return (
                  <div key={f.key} className="min-w-0">
                    <label className={labelCls}>{f.label}</label>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <input
                        type={isDate ? 'date' : 'number'}
                        value={range.from ?? ''}
                        onChange={(e) => update('from', e.target.value)}
                        placeholder={isDate ? t.from : t.min}
                        aria-label={`${f.label} ${isDate ? t.from : t.min}`}
                        className={`${inputCls} min-w-0 flex-1`}
                      />
                      <span className="text-slate-400 text-xs">–</span>
                      <input
                        type={isDate ? 'date' : 'number'}
                        value={range.to ?? ''}
                        onChange={(e) => update('to', e.target.value)}
                        placeholder={isDate ? t.to : t.max}
                        aria-label={`${f.label} ${isDate ? t.to : t.max}`}
                        className={`${inputCls} min-w-0 flex-1`}
                      />
                    </div>
                  </div>
                );
              }
              return (
                <div key={f.key}>
                  <label className={labelCls}>{f.label}</label>
                  <input
                    type="text"
                    value={v ?? ''}
                    onChange={(e) => (e.target.value === '' ? sf.clearFilter(f.key) : sf.setFilterValue(f.key, e.target.value))}
                    className={inputCls}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Result count + chips */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            {`${t.items} (${sf.rows.length} ${t.of} ${sf.total})`}
          </span>
          {sf.activeFilters.map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-semibold">
              {chipText(f, sf.values[f.key], t)}
              <button type="button" onClick={() => sf.clearFilter(f.key)} className="cursor-pointer" aria-label={t.remove} title={t.remove}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {hasAnyActive && (
            <button type="button" onClick={sf.clearAll} className="ms-auto text-xs font-semibold text-blue-700 hover:text-blue-900 cursor-pointer">
              {t.clear}
            </button>
          )}
        </div>
      </div>

      {sf.rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">{emptyText || t.empty}</div>
      ) : typeof children === 'function' ? (
        children(sf.rows)
      ) : (
        children
      )}
    </div>
  );
}

export default SmartFilterBar;
