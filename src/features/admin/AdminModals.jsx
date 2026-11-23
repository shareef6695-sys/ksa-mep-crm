// Admin dialogs — moved verbatim from App.jsx (Prompt 15). Data and handlers come from the store (useErp).
import { useErp } from '../../app/ErpContext';
import { X } from 'lucide-react';
import { CURRENCIES } from '../../app/constants';
import { STANDARD_UOMS, ZATCA_VAT_TYPES } from '../../erp/MasterDataViews';

export default function AdminModals() {
  const { customUoms, handleCreateTeamMember, handleQuickCreateCustomer, handleQuickCreateItem, handleQuickCreateVendor, memberCreating, newMember, quickCreateType, quickCust, quickItem, quickVend, setNewMember, setQuickCreateType, setQuickCust,
    setQuickItem, setQuickVend } = useErp();
  return (
    <>
      {quickCreateType === 'customer' && (
        <div className="fixed inset-0 bg-slate-950/80 z-[60] flex items-center justify-center p-4">
          <form onSubmit={handleQuickCreateCustomer} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="font-bold text-sm">Quick-Create Customer Master</span>
              <button type="button" onClick={() => setQuickCreateType(null)}><X className="w-4 h-4" /></button>
            </div>
            <input type="text" required placeholder="Company Name (EN) *" value={quickCust.name_en} onChange={(e) => setQuickCust({ ...quickCust, name_en: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <input type="text" dir="rtl" placeholder="الاسم القانوني بالعربية (اختياري)" value={quickCust.name_ar} onChange={(e) => setQuickCust({ ...quickCust, name_ar: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <div className="grid grid-cols-2 gap-2">
              <select value={quickCust.customer_type} onChange={(e) => setQuickCust({ ...quickCust, customer_type: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 bg-white">
                <option value="B2B">B2B (VAT Req)</option>
                <option value="B2C">B2C (Simplified)</option>
              </select>
              <input type="text" maxLength={15} required={quickCust.customer_type === 'B2B'} placeholder="15-Digit VAT *" value={quickCust.vat_number} onChange={(e) => setQuickCust({ ...quickCust, vat_number: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" required placeholder="CR Number *" value={quickCust.cr_number} onChange={(e) => setQuickCust({ ...quickCust, cr_number: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
              <input type="text" required placeholder="Contact Person *" value={quickCust.contact_person} onChange={(e) => setQuickCust({ ...quickCust, contact_person: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="tel" required placeholder="Phone *" value={quickCust.phone} onChange={(e) => setQuickCust({ ...quickCust, phone: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
              <input type="email" required placeholder="Email *" value={quickCust.email} onChange={(e) => setQuickCust({ ...quickCust, email: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <button type="submit" className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">Save &amp; Select Customer</button>
          </form>
        </div>
      )}
      {quickCreateType === 'vendor' && (
        <div className="fixed inset-0 bg-slate-950/80 z-[60] flex items-center justify-center p-4">
          <form onSubmit={handleQuickCreateVendor} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="font-bold text-sm">Quick-Create Vendor / Supplier</span>
              <button type="button" onClick={() => setQuickCreateType(null)}><X className="w-4 h-4" /></button>
            </div>
            <input type="text" required placeholder="Supplier Name (EN) *" value={quickVend.name_en} onChange={(e) => setQuickVend({ ...quickVend, name_en: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <div className="grid grid-cols-2 gap-2">
              <select value={quickVend.vendor_origin} onChange={(e) => setQuickVend({ ...quickVend, vendor_origin: e.target.value, default_currency: e.target.value === 'KSA' ? 'SAR' : 'USD' })} className="border border-slate-300 rounded-xl px-3 py-2 bg-white">
                <option value="KSA">KSA Local</option>
                <option value="International">International</option>
              </select>
              <select value={quickVend.default_currency} onChange={(e) => setQuickVend({ ...quickVend, default_currency: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 bg-white">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" placeholder="VAT No (if KSA)" value={quickVend.vat_number} onChange={(e) => setQuickVend({ ...quickVend, vat_number: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 font-mono" />
              <input type="text" required placeholder="CR / Reg No *" value={quickVend.cr_number} onChange={(e) => setQuickVend({ ...quickVend, cr_number: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" required placeholder="Contact Person *" value={quickVend.contact_person} onChange={(e) => setQuickVend({ ...quickVend, contact_person: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
              <input type="tel" required placeholder="Phone *" value={quickVend.phone} onChange={(e) => setQuickVend({ ...quickVend, phone: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <button type="submit" className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">Save &amp; Select Vendor</button>
          </form>
        </div>
      )}
      {quickCreateType === 'item' && (
        <div className="fixed inset-0 bg-slate-950/80 z-[60] flex items-center justify-center p-4">
          <form onSubmit={handleQuickCreateItem} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="font-bold text-sm">Quick-Create Item / Service (ZATCA)</span>
              <button type="button" onClick={() => setQuickCreateType(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={quickItem.item_type} onChange={(e) => setQuickItem({ ...quickItem, item_type: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 bg-white font-bold">
                <option value="Goods">Goods</option>
                <option value="Service">Service</option>
              </select>
              <select value={quickItem.uom} onChange={(e) => setQuickItem({ ...quickItem, uom: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 bg-white">
                {[...STANDARD_UOMS, ...customUoms].map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
              </select>
            </div>
            <input type="text" required placeholder="Description (English) *" value={quickItem.name_en} onChange={(e) => setQuickItem({ ...quickItem, name_en: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <input type="text" dir="rtl" placeholder="الوصف بالعربية (اختياري)" value={quickItem.name_ar} onChange={(e) => setQuickItem({ ...quickItem, name_ar: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" step="0.01" required placeholder="Sales Price (SAR) *" value={quickItem.sales_price_sar} onChange={(e) => setQuickItem({ ...quickItem, sales_price_sar: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
              <div className="flex gap-1">
                <select value={quickItem.purchase_currency} onChange={(e) => setQuickItem({ ...quickItem, purchase_currency: e.target.value })} className="border border-slate-300 rounded-xl px-2 py-2 bg-white">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input type="number" step="0.01" required placeholder="Cost *" value={quickItem.purchase_price} onChange={(e) => setQuickItem({ ...quickItem, purchase_price: e.target.value })} className="w-full border border-slate-300 rounded-xl px-2.5 py-2" />
              </div>
            </div>
            <select value={quickItem.zatca_vat_type} onChange={(e) => setQuickItem({ ...quickItem, zatca_vat_type: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white">
              {ZATCA_VAT_TYPES.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
            </select>
            <button type="submit" className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">Save &amp; Select Item</button>
          </form>
        </div>
      )}
      {quickCreateType === 'salesman' && (
        <div className="fixed inset-0 bg-slate-950/80 z-[60] flex items-center justify-center p-4">
          <form onSubmit={handleCreateTeamMember} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="font-bold text-sm">Quick-Create Salesman Account</span>
              <button type="button" onClick={() => setQuickCreateType(null)}><X className="w-4 h-4" /></button>
            </div>
            <input type="text" required placeholder="Salesman Full Name *" value={newMember.full_name} onChange={(e) => setNewMember({ ...newMember, full_name: e.target.value, is_salesman: true })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <input type="email" required placeholder="Work Email (Login ID) *" value={newMember.email} onChange={(e) => setNewMember({ ...newMember, email: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <input type="text" required minLength={6} placeholder="Initial Password (Min 6 chars) *" value={newMember.password} onChange={(e) => setNewMember({ ...newMember, password: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono" />
            <div className="grid grid-cols-2 gap-2">
              <select value={newMember.division} onChange={(e) => setNewMember({ ...newMember, division: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 bg-white">
                <option value="MEP">MEP Division</option>
                <option value="IT & ELV">IT &amp; ELV Division</option>
              </select>
              <input type="number" step="0.5" min="0" max="100" required placeholder="Profit Share % *" value={newMember.commission_pct} onChange={(e) => setNewMember({ ...newMember, commission_pct: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <button type="submit" disabled={memberCreating} className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">
              {memberCreating ? 'Creating...' : 'Create & Select Salesman'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
