import React, { useState } from 'react';
import { Plus, Users, Truck, Package, CheckCircle2, X, Building2 } from 'lucide-react';
import { formatSAR } from './erpEngine';

export const STANDARD_UOMS = [
  { code: 'PCS', label: 'PCS — Pieces / Numbers' },
  { code: 'NOS', label: 'NOS — Numbers' },
  { code: 'SET', label: 'SET — Complete Set / Kit' },
  { code: 'MTR', label: 'MTR — Meter (Cable / Pipe)' },
  { code: 'ROL', label: 'ROL — Roll / Drum' },
  { code: 'BOX', label: 'BOX — Box / Carton' },
  { code: 'PKT', label: 'PKT — Packet' },
  { code: 'KG', label: 'KG — Kilogram' },
  { code: 'TON', label: 'TON — Metric Ton' },
  { code: 'LTR', label: 'LTR — Liter' },
  { code: 'SQM', label: 'SQM — Square Meter' },
  { code: 'CBM', label: 'CBM — Cubic Meter' },
  { code: 'HRS', label: 'HRS — Man-Hours (Service)' },
  { code: 'DAY', label: 'DAY — Man-Days (Service)' },
  { code: 'MTH', label: 'MTH — Monthly AMC / Subscription' },
  { code: 'LOT', label: 'LOT — Lump Sum / Project Lot' },
];

export const ZATCA_VAT_TYPES = [
  { code: 'S', rate: 15, label: 'S — Standard Rated (15% KSA VAT)', requiresReason: false },
  { code: 'Z', rate: 0, label: 'Z — Zero Rated (0% Export / GCC / Qualifying)', requiresReason: true },
  { code: 'E', rate: 0, label: 'E — Exempt from VAT (0% Financial / Real Estate)', requiresReason: true },
  { code: 'O', rate: 0, label: 'O — Out of Scope of KSA VAT (0%)', requiresReason: true },
];

// ============================================================================
// 1. CUSTOMERS MASTER VIEW (UNDER SALES & FULFILLMENT)
// ============================================================================
export function CustomersMasterView({ supabase, customers, salesmenList, onRefresh }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name_en: '',
    name_ar: '',
    customer_type: 'B2B',
    vat_number: '',
    cr_number: '',
    contact_person: '',
    phone: '',
    email: '',
    city: 'Jeddah',
    address_en: '',
    address_ar: '',
    credit_limit_sar: 0,
    payment_terms: 'Net 30',
    assigned_salesman_id: '',
  });

  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    const { data: code } = await supabase.rpc('next_doc_number', { p_doc_type: 'CUSTOMER' });
    await supabase.from('customers').insert({
      id: `cust-${Date.now()}`,
      customer_code: code,
      ...form,
      credit_limit_sar: Number(form.credit_limit_sar) || 0,
      assigned_salesman_id: form.assigned_salesman_id || null,
    });
    setShowForm(false);
    setForm({
      name_en: '', name_ar: '', customer_type: 'B2B', vat_number: '', cr_number: '',
      contact_person: '', phone: '', email: '', city: 'Jeddah', address_en: '', address_ar: '',
      credit_limit_sar: 0, payment_terms: 'Net 30', assigned_salesman_id: '',
    });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">Customers Master (ZATCA Buyer Registry)</h2>
          <p className="text-xs text-slate-500">Full B2B &amp; B2C customer directory with 15-digit VAT numbers, Arabic legal names, and credit limits.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> {showForm ? 'Close Form' : 'New Customer'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSaveCustomer} className="bg-white border border-blue-200 rounded-2xl p-5 shadow-sm space-y-4 text-xs">
          <div className="border-b border-slate-100 pb-2.5 flex items-center justify-between">
            <span className="font-bold text-sm text-slate-900">Create New Customer (Mandatory Fields Marked *)</span>
            <button type="button" onClick={() => setShowForm(false)}><X className="w-4 h-4 text-slate-400" /></button>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Company / Customer Name (EN) *</label>
              <input type="text" required value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" placeholder="Al-Haramain Contracting Co." />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Legal Name (Arabic) *</label>
              <input type="text" dir="rtl" required value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" placeholder="شركة الحرمين للمقاولات" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">ZATCA Buyer Type *</label>
              <select value={form.customer_type} onChange={(e) => setForm({ ...form, customer_type: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white font-semibold">
                <option value="B2B">B2B — Business (Standard Tax Invoice)</option>
                <option value="B2C">B2C — Individual (Simplified Invoice)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                15-Digit VAT Number {form.customer_type === 'B2B' ? '*' : '(Optional)'}
              </label>
              <input
                type="text"
                maxLength={15}
                minLength={form.customer_type === 'B2B' ? 15 : 0}
                required={form.customer_type === 'B2B'}
                value={form.vat_number}
                onChange={(e) => setForm({ ...form, vat_number: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono"
                placeholder="300XXXXXXXXXXX3"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Commercial Registration (CR) *</label>
              <input type="text" required value={form.cr_number} onChange={(e) => setForm({ ...form, cr_number: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono" placeholder="4030XXXXXX" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Assigned Account Salesman *</label>
              <select required value={form.assigned_salesman_id} onChange={(e) => setForm({ ...form, assigned_salesman_id: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white">
                <option value="">Select Salesman...</option>
                {salesmenList.map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name} ({s.commission_pct || 0}%)</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Primary Contact Person *</label>
              <input type="text" required value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Mobile / Phone (KSA) *</label>
              <input type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" placeholder="+966 5X XXX XXXX" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Email Address *</label>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">City *</label>
              <input type="text" required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">National Address (English) *</label>
              <input type="text" required value={form.address_en} onChange={(e) => setForm({ ...form, address_en: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" placeholder="Building No, Street, District, Postal Code" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">National Address (Arabic)</label>
              <input type="text" dir="rtl" value={form.address_ar} onChange={(e) => setForm({ ...form, address_ar: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Credit Limit (SAR) *</label>
              <input type="number" required min="0" step="100" value={form.credit_limit_sar} onChange={(e) => setForm({ ...form, credit_limit_sar: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Terms *</label>
              <select value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white">
                <option value="Advance / Cash">100% Advance / Cash</option>
                <option value="Net 15">Net 15 Days</option>
                <option value="Net 30">Net 30 Days</option>
                <option value="Net 45">Net 45 Days</option>
                <option value="Net 60">Net 60 Days</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-slate-300 font-semibold">Cancel</button>
            <button type="submit" className="px-5 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">Save Customer Master</button>
          </div>
        </form>
      )}

      {customers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          No customers registered yet. Click <strong>New Customer</strong> to create your first B2B or B2C customer record.
        </div>
      ) : (
        <div className="grid gap-3">
          {customers.map((c) => (
            <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-mono">{c.customer_code}</span>
                  <span className="text-xs font-semibold bg-slate-100 px-2 py-0.5 rounded">{c.customer_type}</span>
                  {c.vat_number && <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">VAT: {c.vat_number}</span>}
                </div>
                <h3 className="text-base font-bold mt-1">{c.name_en} <span className="text-sm font-normal text-slate-500">({c.name_ar})</span></h3>
                <p className="text-xs text-slate-500">{c.contact_person} • {c.phone} • {c.city} • Terms: {c.payment_terms}</p>
              </div>
              <div className="text-right text-xs">
                <div className="text-slate-400">Credit Limit</div>
                <div className="font-bold text-slate-900">SAR {formatSAR(c.credit_limit_sar)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 2. VENDORS / SUPPLIERS MASTER VIEW (UNDER PURCHASE FULL CYCLE)
// ============================================================================
export function VendorsMasterView({ supabase, vendors, currencies, onRefresh }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name_en: '',
    name_ar: '',
    vendor_origin: 'KSA',
    vat_number: '',
    cr_number: '',
    contact_person: '',
    phone: '',
    email: '',
    country: 'Saudi Arabia',
    city: 'Jeddah',
    address: '',
    default_currency: 'SAR',
    payment_terms: 'Net 30',
    iban: '',
  });

  const handleSaveVendor = async (e) => {
    e.preventDefault();
    const { data: code } = await supabase.rpc('next_doc_number', { p_doc_type: 'VENDOR' });
    await supabase.from('vendors').insert({
      id: `vend-${Date.now()}`,
      vendor_code: code,
      ...form,
    });
    setShowForm(false);
    setForm({
      name_en: '', name_ar: '', vendor_origin: 'KSA', vat_number: '', cr_number: '',
      contact_person: '', phone: '', email: '', country: 'Saudi Arabia', city: 'Jeddah',
      address: '', default_currency: 'SAR', payment_terms: 'Net 30', iban: '',
    });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">Vendors &amp; Suppliers Master</h2>
          <p className="text-xs text-slate-500">Manage local KSA (15% Input VAT) and international OEM/trading suppliers with default billing currencies &amp; IBANs.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> {showForm ? 'Close Form' : 'New Vendor'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSaveVendor} className="bg-white border border-blue-200 rounded-2xl p-5 shadow-sm space-y-4 text-xs">
          <div className="border-b border-slate-100 pb-2.5 flex items-center justify-between">
            <span className="font-bold text-sm text-slate-900">Create New Vendor / Supplier (Mandatory Fields Marked *)</span>
            <button type="button" onClick={() => setShowForm(false)}><X className="w-4 h-4 text-slate-400" /></button>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Supplier Name (English) *</label>
              <input type="text" required value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Supplier Name (Arabic)</label>
              <input type="text" dir="rtl" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Supplier Origin *</label>
              <select
                value={form.vendor_origin}
                onChange={(e) =>
                  setForm({
                    ...form,
                    vendor_origin: e.target.value,
                    default_currency: e.target.value === 'KSA' ? 'SAR' : 'USD',
                    country: e.target.value === 'KSA' ? 'Saudi Arabia' : '',
                  })
                }
                className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white font-semibold"
              >
                <option value="KSA">KSA Local Supplier (15% Input VAT)</option>
                <option value="GCC">GCC Supplier</option>
                <option value="International">International / Import Supplier</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                15-Digit VAT Number {form.vendor_origin === 'KSA' ? '*' : '(Tax ID)'}
              </label>
              <input
                type="text"
                maxLength={15}
                required={form.vendor_origin === 'KSA'}
                value={form.vat_number}
                onChange={(e) => setForm({ ...form, vat_number: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono"
                placeholder="300XXXXXXXXXXX3"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">CR / Registration No *</label>
              <input type="text" required value={form.cr_number} onChange={(e) => setForm({ ...form, cr_number: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Default Purchase Currency *</label>
              <select value={form.default_currency} onChange={(e) => setForm({ ...form, default_currency: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white font-semibold">
                {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Account Manager / Contact *</label>
              <input type="text" required value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Phone / WhatsApp *</label>
              <input type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Email *</label>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Country *</label>
              <input type="text" required value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">City *</label>
              <input type="text" required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Street Address *</label>
              <input type="text" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Terms *</label>
              <select value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white">
                <option value="Advance TT">100% Advance TT</option>
                <option value="LC / CAD">LC / CAD</option>
                <option value="Net 15">Net 15 Days</option>
                <option value="Net 30">Net 30 Days</option>
                <option value="Net 60">Net 60 Days</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Bank IBAN / Swift Details</label>
              <input type="text" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono" placeholder="SA00 0000 0000 0000 0000 0000" />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-slate-300 font-semibold">Cancel</button>
            <button type="submit" className="px-5 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">Save Vendor Master</button>
          </div>
        </form>
      )}

      {vendors.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          No vendors registered yet. Click <strong>New Vendor</strong> to add your KSA or international suppliers.
        </div>
      ) : (
        <div className="grid gap-3">
          {vendors.map((v) => (
            <div key={v.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-mono">{v.vendor_code}</span>
                  <span className="text-xs font-semibold bg-slate-100 px-2 py-0.5 rounded">{v.vendor_origin} • {v.default_currency}</span>
                  {v.vat_number && <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">VAT: {v.vat_number}</span>}
                </div>
                <h3 className="text-base font-bold mt-1">{v.name_en}</h3>
                <p className="text-xs text-slate-500">{v.contact_person} • {v.phone} • {v.city}, {v.country} • {v.payment_terms}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 3. ITEMS MASTER VIEW (GOODS & SERVICES, STANDARD + CUSTOM UOM, ZATCA VAT)
// ============================================================================
export function ItemsMasterView({ supabase, items, customUoms, vendors, customers, currencies, onRefresh }) {
  const [showForm, setShowForm] = useState(false);
  const [showCustomUomInput, setShowCustomUomInput] = useState(false);
  const [customUomCode, setCustomUomCode] = useState('');
  const [customUomLabel, setCustomUomLabel] = useState('');

  const [form, setForm] = useState({
    item_type: 'Goods',
    name_en: '',
    name_ar: '',
    category: 'MEP',
    uom: 'PCS',
    sales_price_sar: '',
    purchase_price: '',
    purchase_currency: 'SAR',
    zatca_vat_type: 'S',
    zatca_exemption_reason: '',
    link_to_supplier: false,
    preferred_vendor_id: '',
    link_to_customer: false,
    preferred_customer_id: '',
    is_stocked_item: false,
  });

  const allUoms = [...STANDARD_UOMS, ...customUoms];
  const selectedVatMeta = ZATCA_VAT_TYPES.find((v) => v.code === form.zatca_vat_type) || ZATCA_VAT_TYPES[0];

  const handleAddCustomUom = async () => {
    const code = customUomCode.trim().toUpperCase();
    const label = customUomLabel.trim();
    if (!code || !label) return;
    await supabase.from('custom_uoms').upsert({ code, label: `${code} — ${label}` });
    setForm({ ...form, uom: code });
    setCustomUomCode('');
    setCustomUomLabel('');
    setShowCustomUomInput(false);
    onRefresh();
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    const docKey = form.item_type === 'Service' ? 'ITEM_SERVICE' : 'ITEM_GOODS'; const { data: itemCode } = await supabase.rpc('next_doc_number', { p_doc_type: docKey });

    await supabase.from('items').insert({
      id: `item-${Date.now()}`,
      item_code: itemCode,
      item_type: form.item_type,
      name_en: form.name_en,
      name_ar: form.name_ar,
      category: form.category,
      uom: form.uom,
      sales_price_sar: parseFloat(form.sales_price_sar),
      purchase_price: parseFloat(form.purchase_price),
      purchase_currency: form.purchase_currency,
      zatca_vat_type: form.zatca_vat_type,
      zatca_exemption_reason: selectedVatMeta.requiresReason ? form.zatca_exemption_reason : '',
      link_to_supplier: form.link_to_supplier,
      preferred_vendor_id: form.link_to_supplier && form.preferred_vendor_id ? form.preferred_vendor_id : null,
      link_to_customer: form.link_to_customer,
      preferred_customer_id: form.link_to_customer && form.preferred_customer_id ? form.preferred_customer_id : null,
      is_stocked_item: form.item_type === 'Goods' ? form.is_stocked_item : false,
    });

    setShowForm(false);
    setForm({
      item_type: 'Goods', name_en: '', name_ar: '', category: 'MEP', uom: 'PCS',
      sales_price_sar: '', purchase_price: '', purchase_currency: 'SAR',
      zatca_vat_type: 'S', zatca_exemption_reason: '',
      link_to_supplier: false, preferred_vendor_id: '',
      link_to_customer: false, preferred_customer_id: '', is_stocked_item: false,
    });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">Items Master (Goods &amp; Services Catalog)</h2>
          <p className="text-xs text-slate-500">Define Goods or Services with Standard/Custom UOMs, mandatory Sales &amp; Purchase prices, ZATCA VAT categories, and Supplier/Customer links.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> {showForm ? 'Close Form' : 'New Item / Service'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSaveItem} className="bg-white border border-blue-200 rounded-2xl p-5 shadow-sm space-y-4 text-xs">
          <div className="border-b border-slate-100 pb-2.5 flex items-center justify-between">
            <span className="font-bold text-sm text-slate-900">Create Item or Service (All Mandatory Fields Marked *)</span>
            <button type="button" onClick={() => setShowForm(false)}><X className="w-4 h-4 text-slate-400" /></button>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            {/* Goods vs Service Selector */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Item Classification *</label>
              <select
                value={form.item_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    item_type: e.target.value,
                    uom: e.target.value === 'Service' ? 'HRS' : 'PCS',
                  })
                }
                className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white font-bold text-blue-700"
              >
                <option value="Goods">Goods / Physical Material</option>
                <option value="Service">Service / Installation / AMC</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Business Division *</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white">
                <option value="MEP">MEP Trading &amp; Contracting</option>
                <option value="IT & ELV">IT &amp; ELV Systems</option>
                <option value="General">General / Consumables</option>
              </select>
            </div>

            {/* UOM Selector + Manual Custom UOM Creator */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold text-slate-700">Unit of Measure (UOM) *</label>
                <button
                  type="button"
                  onClick={() => setShowCustomUomInput(!showCustomUomInput)}
                  className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  + Custom UOM
                </button>
              </div>
              <select
                required
                value={form.uom}
                onChange={(e) => setForm({ ...form, uom: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white font-semibold"
              >
                {allUoms.map((u) => (
                  <option key={u.code} value={u.code}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Inline Custom UOM Builder */}
          {showCustomUomInput && (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[11px] font-bold text-blue-900 mb-1">Custom UOM Code (e.g. BDL)</label>
                <input
                  type="text"
                  maxLength={8}
                  value={customUomCode}
                  onChange={(e) => setCustomUomCode(e.target.value)}
                  placeholder="BDL"
                  className="border border-blue-300 rounded-lg px-2.5 py-1.5 bg-white uppercase font-mono w-28"
                />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-[11px] font-bold text-blue-900 mb-1">Description (e.g. Bundle of 10 Pipes)</label>
                <input
                  type="text"
                  value={customUomLabel}
                  onChange={(e) => setCustomUomLabel(e.target.value)}
                  placeholder="Bundle of 10 Pipes"
                  className="w-full border border-blue-300 rounded-lg px-2.5 py-1.5 bg-white"
                />
              </div>
              <button
                type="button"
                onClick={handleAddCustomUom}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold cursor-pointer"
              >
                Add &amp; Select UOM
              </button>
            </div>
          )}

          {/* Bilingual Item Descriptions (Required by ZATCA E-Invoicing) */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Item / Service Description (English) *</label>
              <input type="text" required value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" placeholder="e.g. Cat6 UTP Cable 305m Box / Annual CCTV Maintenance" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Item / Service Description (Arabic - ZATCA) *</label>
              <input type="text" dir="rtl" required value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" placeholder="الوصف بالعربية للفاتورة الضريبية" />
            </div>
          </div>

          {/* Mandatory Sales Price, Purchase Price & ZATCA VAT Type */}
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Standard Sales Price (SAR Excl. VAT) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={form.sales_price_sar}
                onChange={(e) => setForm({ ...form, sales_price_sar: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 font-bold"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Standard Purchase Cost &amp; Currency *</label>
              <div className="flex gap-1.5">
                <select
                  value={form.purchase_currency}
                  onChange={(e) => setForm({ ...form, purchase_currency: e.target.value })}
                  className="border border-slate-300 rounded-xl px-2.5 py-2 bg-white font-semibold"
                >
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={form.purchase_price}
                  onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 font-bold"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">ZATCA VAT Category *</label>
              <select
                required
                value={form.zatca_vat_type}
                onChange={(e) => setForm({ ...form, zatca_vat_type: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white font-semibold"
              >
                {ZATCA_VAT_TYPES.map((v) => (
                  <option key={v.code} value={v.code}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          {selectedVatMeta.requiresReason && (
            <div>
              <label className="block font-semibold text-amber-800 mb-1">ZATCA Zero/Exempt/Out-of-Scope Reason Text *</label>
              <input
                type="text"
                required
                value={form.zatca_exemption_reason}
                onChange={(e) => setForm({ ...form, zatca_exemption_reason: e.target.value })}
                className="w-full border border-amber-300 bg-amber-50/40 rounded-xl px-3 py-2"
                placeholder="e.g. Export outside GCC per KSA VAT Implementing Regulations Art. 32"
              />
            </div>
          )}

          {/* Checkboxes: Link to Supplier & Link to Customer */}
          <div className="grid sm:grid-cols-2 gap-3 pt-1">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <label className="flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.link_to_supplier}
                  onChange={(e) => setForm({ ...form, link_to_supplier: e.target.checked })}
                  className="w-4 h-4"
                />
                <span>Link Item with Preferred Supplier / Vendor</span>
              </label>
              {form.link_to_supplier && (
                <select
                  required
                  value={form.preferred_vendor_id}
                  onChange={(e) => setForm({ ...form, preferred_vendor_id: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                >
                  <option value="">Select Preferred Vendor...</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.vendor_code} — {v.name_en}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <label className="flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.link_to_customer}
                  onChange={(e) => setForm({ ...form, link_to_customer: e.target.checked })}
                  className="w-4 h-4"
                />
                <span>Link Item with Specific Customer (Contract Rate)</span>
              </label>
              {form.link_to_customer && (
                <select
                  required
                  value={form.preferred_customer_id}
                  onChange={(e) => setForm({ ...form, preferred_customer_id: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                >
                  <option value="">Select Customer...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.customer_code} — {c.name_en}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-slate-300 font-semibold">Cancel</button>
            <button type="submit" className="px-5 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">Save Item / Service</button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          No items or services created yet. Click <strong>New Item / Service</strong> to populate your catalog.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((it) => {
            const linkedVend = vendors.find((v) => v.id === it.preferred_vendor_id);
            const linkedCust = customers.find((c) => c.id === it.preferred_customer_id);
            return (
              <div key={it.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-mono">{it.item_code}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${it.item_type === 'Service' ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-700'}`}>
                      {it.item_type}
                    </span>
                    <span className="text-xs font-bold bg-slate-100 px-2 py-0.5 rounded">UOM: {it.uom}</span>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                      ZATCA VAT: {it.zatca_vat_type === 'S' ? '15% Standard (S)' : `0% (${it.zatca_vat_type})`}
                    </span>
                  </div>
                  <h3 className="text-base font-bold mt-1">{it.name_en} <span className="text-sm font-normal text-slate-500">({it.name_ar})</span></h3>
                  <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-3">
                    {linkedVend && <span>Supplier: <strong>{linkedVend.name_en}</strong></span>}
                    {linkedCust && <span>Customer Contract: <strong>{linkedCust.name_en}</strong></span>}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-right text-xs">
                  <div>
                    <div className="text-slate-400">Purchase Cost</div>
                    <div className="font-semibold text-slate-700">{it.purchase_currency} {formatSAR(it.purchase_price)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Sales Price</div>
                    <div className="font-bold text-blue-700 text-sm">SAR {formatSAR(it.sales_price_sar)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}