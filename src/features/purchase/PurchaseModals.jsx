// Purchase dialogs — moved verbatim from App.jsx (Prompt 15). Data and handlers come from the store (useErp).
import { useErp } from '../../app/ErpContext';
import { X } from 'lucide-react';
import { CURRENCIES } from '../../app/constants';
import { GoodsReceiptModal, PurchaseLinesEditor, SupplierBillModal, emptyPoLine } from '../../erp/ProcurementPanels';
import { PurchaseOrderPreviewModal } from '../../erp/PurchaseOrderPreviewModal';
import { SmartEntitySelect } from '../../erp/SmartDiscovery';
import { formatSAR } from '../../erp/erpEngine';
import { can } from '../../lib/permissions';

export default function PurchaseModals() {
  const { billModalPO, callPosting, company, fxRates, glAccounts, grnModalPO, handleCreatePO, handleSelectVendorForPO,
    importVatForm, items, itemsById, newPO, postGoodsReceipt, postSupplierBill, previewPO, procSettings, profile, projects,
    purchaseOrders, refreshAllErpData, requisitions, salesOrderSelectOptions, salesOrders, setBillModalPO, setGrnModalPO,
    setImportVatForm, setNewPO, setPreviewPO, setQuickCreateType, setShowNewPOModal, showNewPOModal, vendorSelectOptions, vendors,
    warehouses } = useErp();
  return (
    <>
      {showNewPOModal && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">Create Purchase Order (PO)</h3>
              <button onClick={() => setShowNewPOModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreatePO} className="space-y-3 text-xs">
              <SmartEntitySelect
                label="Link to Sales Order (Optional)"
                placeholder="Search SO number or customer..."
                items={salesOrderSelectOptions}
                value={newPO.soId}
                onChange={(val) => setNewPO({ ...newPO, soId: val })}
              />

              <SmartEntitySelect
                label="Supplier / Vendor (Search or Create New)"
                placeholder="Search vendor name, code, currency..."
                items={vendorSelectOptions}
                value={newPO.vendorId}
                createNewLabel="Create New Vendor"
                onCreateNew={can(profile, 'vendor.manage') ? () => setQuickCreateType('vendor') : undefined}
                onChange={handleSelectVendorForPO}
              />

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Supplier Name *"
                  value={newPO.supplierName}
                  onChange={(e) => setNewPO({ ...newPO, supplierName: e.target.value })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5"
                />
                <input
                  type="text"
                  placeholder="Supplier VAT No (if KSA)"
                  value={newPO.supplierVat}
                  onChange={(e) => setNewPO({ ...newPO, supplierVat: e.target.value })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <select
                  value={newPO.currency}
                  onChange={(e) => setNewPO({ ...newPO, currency: e.target.value, fxRate: fxRates[e.target.value] || 1 })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5 bg-white font-semibold"
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input type="number" step="any" min="0.0001" value={newPO.fxRate} onChange={(e) => setNewPO({ ...newPO, fxRate: e.target.value })} title="FX rate to SAR" className="border border-slate-300 rounded-xl px-3 py-2.5" />
                <input value={newPO.paymentTerms} onChange={(e) => setNewPO({ ...newPO, paymentTerms: e.target.value })} placeholder="Terms (default: vendor's)" className="border border-slate-300 rounded-xl px-3 py-2.5" />
              </div>
              {(() => {
                const so = salesOrders.find((x) => x.id === newPO.soId);
                return (
                  <>
                    {so && !newPO.prId && (
                      <button type="button" onClick={() => setNewPO({ ...newPO, lines: (so.items || []).filter((it) => Number(it.orderedQty) - Number(it.deliveredQty || 0) > 0).map((it) => ({ ...emptyPoLine(), itemId: it.itemId || '', desc: it.desc, qty: Number(it.orderedQty) - Number(it.deliveredQty || 0), uom: it.unit || 'PCS', stocked: !!itemsById[it.itemId]?.is_stocked_item, soLineId: it.id, unitCostFx: newPO.currency === 'SAR' ? Number(it.unitCostSar || 0) : '' })) })}
                        className="text-blue-700 font-semibold">Copy open lines from {so.so_number}</button>
                    )}
                    {newPO.prId && <div className="text-emerald-700 font-semibold">From requisition {requisitions.find((r) => r.id === newPO.prId)?.pr_number}</div>}
                    <PurchaseLinesEditor lines={newPO.lines} setLines={(lines) => setNewPO({ ...newPO, lines })} items={items} currency={newPO.currency} fxRate={newPO.fxRate} soLines={so?.items || []} />
                  </>
                );
              })()}
              {projects.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1">Project (job cost)</label>
                    <select className="w-full border border-slate-300 rounded-lg px-2.5 py-2" value={newPO.projectId || ''} onChange={(e) => setNewPO({ ...newPO, projectId: e.target.value })}>
                      <option value="">{newPO.soId && salesOrders.find((x) => x.id === newPO.soId)?.project_id ? '— The sales order\'s project —' : '— None —'}</option>
                      {projects.filter((p) => ['active', 'on_hold', 'completed'].includes(p.status)).map((p) => <option key={p.id} value={p.id}>{p.project_code} — {p.name}</option>)}
                    </select>
                  </div>
                  {(newPO.projectId || salesOrders.find((x) => x.id === newPO.soId)?.project_id) && (
                    <div>
                      <label className="block font-semibold text-slate-600 mb-1">Cost type</label>
                      <select className="w-full border border-slate-300 rounded-lg px-2.5 py-2" value={newPO.costType || 'material'} onChange={(e) => setNewPO({ ...newPO, costType: e.target.value })}>
                        <option value="material">Material (5010)</option>
                        <option value="subcontract">Subcontract (5300, non-stock lines)</option>
                      </select>
                    </div>
                  )}
                </div>
              )}
              {(() => {
                const vend = vendors.find((v) => v.id === newPO.vendorId);
                const foreign = vend && (vend.vendor_origin || 'KSA') !== 'KSA';
                return (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-2 gap-2">
                      {[['goods', 'Goods'], ['services', 'Services']].map(([k, label]) => (
                        <label key={k} className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer ${newPO.supplyType === k ? 'border-blue-500 bg-blue-50' : 'border-slate-300'}`}>
                          <input type="radio" name="supplyType" checked={newPO.supplyType === k} onChange={() => setNewPO({ ...newPO, supplyType: k })} /> {label}
                        </label>
                      ))}
                    </div>
                    {foreign && (
                      <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                        {newPO.supplyType === 'services'
                          ? 'Foreign supplier, services: no KSA VAT on this PO. 15% reverse-charge VAT is self-assessed when the bill is posted.'
                          : 'Foreign supplier, goods: no KSA VAT on this PO. Record the VAT paid at customs from Supplier Bills once you have the declaration.'}
                      </p>
                    )}
                  </div>
                );
              })()}
              <div>
                <label className="block font-semibold text-slate-600 mb-1">Estimated Freight / Customs / Clearance (SAR)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newPO.landedCostSar}
                  onChange={(e) => setNewPO({ ...newPO, landedCostSar: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5"
                />
              </div>
              <button type="submit" className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">
                Issue Purchase Order
              </button>
            </form>
          </div>
        </div>
      )}
      {importVatForm && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            className="bg-white rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-3 text-xs"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = importVatForm;
              const done = await callPosting('post_import_vat', {
                p_declaration_no: f.declarationNo, p_declaration_date: f.date, p_vat_sar: Number(f.vat) || 0,
                p_customs_value_sar: Number(f.customsValue) || 0, p_po_id: f.poId || null, p_paid_from: f.paidFrom,
              });
              if (!done) return;
              setImportVatForm(null);
              refreshAllErpData();
              alert(`Import VAT SAR ${formatSAR(done.vat_sar)} recorded for declaration ${done.declaration_no} (journal ${done.journal_voucher_number}).`);
            }}
          >
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">Record Customs Import VAT</h3>
              <button type="button" onClick={() => setImportVatForm(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input required placeholder="Customs declaration no. *" value={importVatForm.declarationNo} onChange={(e) => setImportVatForm({ ...importVatForm, declarationNo: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
              <input type="date" required value={importVatForm.date} onChange={(e) => setImportVatForm({ ...importVatForm, date: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
              <input type="number" step="0.01" placeholder="Customs value (SAR)" value={importVatForm.customsValue} onChange={(e) => setImportVatForm({ ...importVatForm, customsValue: e.target.value, vat: e.target.value ? (Number(e.target.value) * 0.15).toFixed(2) : importVatForm.vat })} className="border border-slate-300 rounded-xl px-3 py-2" />
              <input type="number" step="0.01" required placeholder="Import VAT paid (SAR) *" value={importVatForm.vat} onChange={(e) => setImportVatForm({ ...importVatForm, vat: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <select value={importVatForm.poId} onChange={(e) => setImportVatForm({ ...importVatForm, poId: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white">
              <option value="">Link to purchase order (optional)</option>
              {purchaseOrders.filter((p) => p.is_foreign_supplier).map((p) => <option key={p.id} value={p.id}>{p.po_number} — {p.supplier_name}</option>)}
            </select>
            <select value={importVatForm.paidFrom} onChange={(e) => setImportVatForm({ ...importVatForm, paidFrom: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white">
              {glAccounts.filter((a) => String(a.account_code).startsWith('10') && a.account_type === 'Asset').map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} - {a.account_name_en}</option>)}
              <option value="2010">2010 - Paid by clearing agent (supplier will invoice)</option>
            </select>
            <button type="submit" className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">Post Import VAT</button>
          </form>
        </div>
      )}
      {grnModalPO && <GoodsReceiptModal po={grnModalPO.po} itemsById={itemsById} warehouses={warehouses} onPost={postGoodsReceipt} onClose={() => setGrnModalPO(null)} />}
      {billModalPO && <SupplierBillModal po={billModalPO} settings={procSettings} onPost={postSupplierBill} onClose={() => setBillModalPO(null)} />}
      {previewPO && <PurchaseOrderPreviewModal company={company} suppliers={vendors} po={previewPO} onClose={() => setPreviewPO(null)} />}
    </>
  );
}
