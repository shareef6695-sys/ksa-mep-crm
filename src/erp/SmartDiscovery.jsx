import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, ChevronDown, X, ArrowRight, Sparkles } from 'lucide-react';

/**
 * Reusable Smart Searchable Field Dropdown with inline "+ Create New" button
 */
export function SmartEntitySelect({
  label,
  placeholder = 'Search or select...',
  items = [],
  value,
  onChange,
  onCreateNew,
  createNewLabel = 'Create New',
  required = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef(null);

  const selectedItem = items.find((i) => i.id === value);

  useEffect(() => {
    const handleOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const filtered = items.filter((item) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      (item.label || '').toLowerCase().includes(q) ||
      (item.sublabel || '').toLowerCase().includes(q) ||
      (item.badge || '').toLowerCase().includes(q) ||
      (item.searchBlob || '').toLowerCase().includes(q)
    );
  });

  return (
    <div ref={wrapperRef} className="relative text-xs">
      {label && (
        <div className="flex items-center justify-between mb-1">
          <label className="font-semibold text-slate-700">
            {label} {required && <span className="text-rose-500">*</span>}
          </label>
          {onCreateNew && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCreateNew();
              }}
              className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-0.5 cursor-pointer"
            >
              <Plus className="w-3 h-3" /> {createNewLabel}
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full border border-slate-300 hover:border-blue-400 bg-white rounded-xl px-3 py-2.5 text-left flex items-center justify-between gap-2 transition cursor-pointer"
      >
        <div className="min-w-0 flex-1">
          {selectedItem ? (
            <div className="flex items-center gap-2 truncate">
              {selectedItem.badge && (
                <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono text-[10px] font-bold shrink-0">
                  {selectedItem.badge}
                </span>
              )}
              <span className="font-semibold text-slate-900 truncate">{selectedItem.label}</span>
            </div>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {selectedItem && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
              title="Clear selection"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </div>
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden">
          <div className="p-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type code, name, Arabic, VAT, or phone..."
              className="w-full bg-transparent text-xs focus:outline-none text-slate-900"
            />
          </div>

          <div className="max-h-52 overflow-y-auto divide-y divide-slate-50">
            {filtered.length === 0 ? (
              <div className="p-3 text-center text-slate-400 text-[11px]">No matching records found.</div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={`w-full px-3 py-2 text-left hover:bg-blue-50 flex items-center justify-between gap-2 transition cursor-pointer ${
                    item.id === value ? 'bg-blue-50/70' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {item.badge && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px] font-bold">
                          {item.badge}
                        </span>
                      )}
                      <span className="font-semibold text-slate-900 truncate">{item.label}</span>
                    </div>
                    {item.sublabel && <div className="text-[11px] text-slate-500 truncate mt-0.5">{item.sublabel}</div>}
                  </div>
                  {item.rightMeta && (
                    <span className="text-[11px] font-bold text-blue-700 shrink-0">{item.rightMeta}</span>
                  )}
                </button>
              ))
            )}
          </div>

          {onCreateNew && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setQuery('');
                onCreateNew();
              }}
              className="w-full p-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> {createNewLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Global Smart Search & Discovery Modal (Ctrl+K / Cmd+K or Top Search Bar)
 */
export function GlobalSmartDiscoveryModal({
  isOpen,
  onClose,
  customers = [],
  vendors = [],
  items = [],
  inquiries = [],
  salesOrders = [],
  invoices = [],
  purchaseOrders = [],
  teamProfiles = [],
  onNavigate,
}) {
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else onNavigate('OPEN_SEARCH');
      }
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, onNavigate]);

  if (!isOpen) return null;

  const corpus = [
    ...customers.map((c) => ({
      id: `cust-${c.id}`,
      category: 'Customer',
      code: c.customer_code,
      title: c.name_en,
      subtitle: `${c.name_ar || ''} • VAT: ${c.vat_number || 'N/A'} • ${c.city} • ${c.phone}`,
      modId: 'sales',
      subId: 'sales_customers',
    })),
    ...vendors.map((v) => ({
      id: `vend-${v.id}`,
      category: 'Vendor',
      code: v.vendor_code,
      title: v.name_en,
      subtitle: `${v.vendor_origin} • ${v.default_currency} • VAT: ${v.vat_number || 'N/A'} • ${v.city}`,
      modId: 'purchase',
      subId: 'pur_vendors',
    })),
    ...items.map((it) => ({
      id: `item-${it.id}`,
      category: 'Item / Service',
      code: it.item_code,
      title: `${it.name_en} (${it.uom})`,
      subtitle: `${it.name_ar || ''} • ${it.item_type} • ZATCA VAT: ${it.zatca_vat_type} • Sell: SAR ${it.sales_price_sar}`,
      modId: 'master_catalog',
      subId: 'cat_items',
    })),
    ...inquiries.map((inq) => ({
      id: `inq-${inq.id}`,
      category: 'Inquiry / Quote',
      code: inq.refNo,
      title: inq.clientName,
      subtitle: `${inq.division} • Sales: ${inq.assignedSalesName} • Stage: ${inq.stage}`,
      modId: 'sales',
      subId: 'sales_quotes',
      recordId: inq.id,
    })),
    ...salesOrders.map((so) => ({
      id: `so-${so.id}`,
      category: 'Sales Order',
      code: so.so_number,
      title: so.client_name,
      subtitle: `Status: ${so.status} • Total: SAR ${so.grand_total_sar}`,
      modId: 'sales',
      subId: 'sales_orders',
    })),
    ...invoices.map((inv) => ({
      id: `inv-${inv.id}`,
      category: 'ZATCA Invoice',
      code: inv.invoice_number,
      title: inv.client_name,
      subtitle: `Payment: ${inv.payment_status} • Total: SAR ${inv.grand_total_sar}`,
      modId: 'sales',
      subId: 'sales_invoices',
    })),
    ...purchaseOrders.map((po) => ({
      id: `po-${po.id}`,
      category: 'Purchase Order',
      code: po.po_number,
      title: po.supplier_name,
      subtitle: `${po.currency} ${po.goods_total_fx} • Status: ${po.status}`,
      modId: 'purchase',
      subId: 'pur_orders',
    })),
    ...teamProfiles.map((tm) => ({
      id: `tm-${tm.id}`,
      category: tm.is_salesman ? 'Salesman' : 'Team Member',
      code: tm.role_key?.toUpperCase(),
      title: tm.full_name,
      subtitle: [tm.email, tm.role_label, tm.commission_pct == null ? null : `Profit Share: ${tm.commission_pct}%`].filter(Boolean).join(' • '),
      modId: 'settings',
      subId: 'set_salesmen',
    })),
  ];

  const categories = ['ALL', 'Customer', 'Vendor', 'Item / Service', 'Inquiry / Quote', 'Sales Order', 'ZATCA Invoice', 'Purchase Order', 'Salesman'];

  const results = corpus.filter((entry) => {
    if (activeFilter !== 'ALL' && entry.category !== activeFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      (entry.code || '').toLowerCase().includes(q) ||
      (entry.title || '').toLowerCase().includes(q) ||
      (entry.subtitle || '').toLowerCase().includes(q) ||
      (entry.category || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-start justify-center pt-12 sm:pt-20 p-3">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="p-3.5 border-b border-slate-200 flex items-center gap-3 bg-slate-50">
          <Sparkles className="w-5 h-5 text-blue-600 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Smart Discovery: Search Customers, Vendors, Items, Invoices, SOs, POs, Salesmen..."
            className="w-full bg-transparent text-sm font-medium text-slate-900 focus:outline-none"
          />
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-1.5 overflow-x-auto bg-white">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveFilter(cat)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                activeFilter === cat
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
          {results.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No records matched <strong>"{query}"</strong>. Try another code, name, or VAT number.
            </div>
          ) : (
            results.slice(0, 30).map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onNavigate(r.modId, r.subId, r.recordId);
                  onClose();
                }}
                className="w-full px-4 py-3 text-left hover:bg-blue-50/70 flex items-center justify-between gap-3 transition cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      {r.category}
                    </span>
                    {r.code && (
                      <span className="text-[11px] font-mono font-bold text-blue-700">{r.code}</span>
                    )}
                    <span className="text-xs font-bold text-slate-900 truncate">{r.title}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">{r.subtitle}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>
            ))
          )}
        </div>

        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span>Showing {Math.min(results.length, 30)} of {results.length} live ERP records</span>
          <span>Press ESC to close • Ctrl+K anytime</span>
        </div>
      </div>
    </div>
  );
}