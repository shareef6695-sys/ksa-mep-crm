// Purchase screens — moved verbatim from App.jsx (Prompt 15). Data and handlers come from the store (useErp).
import { useErp } from '../../app/ErpContext';
import { Plus } from 'lucide-react';
import { CURRENCIES } from '../../app/constants';
import { VendorsMasterView } from '../../erp/MasterDataViews';
import { PO_STATUS_LABEL, PurchaseDocsList, RequisitionsView, openToBill, openToReceive } from '../../erp/ProcurementPanels';
import { formatSAR } from '../../erp/erpEngine';
import { SharePurchaseOrderButtons } from '../../erp/shareDispatch';
import { can } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { SmartFilterBar } from '../../ui/SmartFilterBar';

export default function PurchaseScreens() {
  const { activeSubModule, callPosting, company, goodsReceipts, handleApprovePO, handleClosePO, handlePoFromRequisition,
    handlePostSupplierBill, handleRaiseRequisition, handleRecordGoodsReceipt, handleRejectPO, lang, openObject, profile,
    purchaseOrders, refreshAllErpData, requisitions, salesOrders, selectSubModule, setImportVatForm, setPreviewPO,
    setShowNewPOModal, supplierBills, vendors, view } = useErp();
  return (
    <>
          {view === 'pur_vendors' && (
            <VendorsMasterView
              readOnly={!can(profile, 'vendor.manage')}
              canImport={can(profile, 'master.import')}
              canErase={can(profile, 'privacy.erase')}
              supabase={supabase}
              vendors={vendors}
              currencies={CURRENCIES}
              onRefresh={refreshAllErpData}
            />
          )}
          {['pur_orders', 'pur_grn', 'pur_bills'].includes(view) && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900">
                    {view === 'pur_orders' && 'Purchase Orders (PO)'}
                    {view === 'pur_grn' && 'Goods Receipt Notes (GRN)'}
                    {view === 'pur_bills' && 'Supplier Bills & Landed Cost'}
                  </h2>
                  <p className="text-xs text-slate-500">PO Issuance → Goods Receipt Note (GRN) → Supplier Bill &amp; Customs/Freight Allocation.</p>
                </div>
                {view === 'pur_bills' && can(profile, 'po.bill') && (
                  <button
                    type="button"
                    onClick={() => setImportVatForm({ declarationNo: '', date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }), vat: '', customsValue: '', poId: '', paidFrom: '1020' })}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Record Customs Import VAT
                  </button>
                )}
                <button
                  hidden={!can(profile, 'po.create')}
                  onClick={() => setShowNewPOModal(true)}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> New Purchase Order
                </button>
              </div>

              {purchaseOrders.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                  No Purchase Orders created yet. Click <strong>New Purchase Order</strong> to issue a supplier PO.
                </div>
              ) : (
                <SmartFilterBar lang={lang} key={activeSubModule} rows={view === 'pur_grn' ? purchaseOrders.filter(openToReceive) : activeSubModule === 'pur_bills' ? purchaseOrders.filter((x) => openToBill(x) || ['partial', 'posted', 'paid'].includes(x.bill_status)) : purchaseOrders} storageKey={activeSubModule} searchKeys={['po_number', 'supplier_name', 'so_number']} filters={[{ key: 'status', label: lang === 'ar' ? 'المرحلة' : 'Stage', type: 'select' }, { key: 'payment_status', label: lang === 'ar' ? 'السداد' : 'Payment', type: 'select' }, { key: 'currency', label: lang === 'ar' ? 'العملة' : 'Currency', type: 'select' }, { key: 'created_at', label: lang === 'ar' ? 'التاريخ' : 'Date', type: 'daterange' }]} sortOptions={[{ key: 'created_at', label: 'Date' }, { key: 'goods_total_sar', label: 'Amount' }, { key: 'supplier_name', label: 'Supplier' }]} defaultSort={{ key: 'created_at', dir: 'desc' }} csv={{ filename: 'Purchase_Orders', columns: [{ key: 'po_number', label: 'PO #' }, { key: 'supplier_name', label: 'Supplier' }, { key: 'currency', label: 'Currency' }, { key: 'goods_total_fx', label: 'Goods (FX)' }, { key: 'goods_total_sar', label: 'Goods (SAR)' }, { key: 'landed_cost_sar', label: 'Landed (SAR)' }, { key: 'supplier_vat_sar', label: 'VAT (SAR)' }, { key: 'status', label: 'Stage' }, { key: 'payment_status', label: 'Payment' }, { key: 'created_at', label: 'Date' }] }}>
                {(rows) => (
                <div className="grid gap-3">
                  {rows.map((po) => {
                    const totalLandedSar = Number(po.goods_total_sar || 0) + Number(po.landed_cost_sar || 0);
                    return (
                      <div key={po.id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded"><button type="button" onClick={(e) => { e.stopPropagation(); openObject('po', po.id); }} className="underline decoration-dotted underline-offset-2 hover:text-blue-900 cursor-pointer">{po.po_number}</button> <div className="mt-1"><button type="button" onClick={(e) => { e.stopPropagation(); setPreviewPO(po); }} className="no-print px-2 py-1 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer transition"><span>Preview A4 PO</span></button> <SharePurchaseOrderButtons company={company} suppliers={vendors} po={po} compact /></div></span>
                            {po.so_number && <span className="text-xs bg-slate-100 px-2 py-0.5 rounded">Linked: {po.so_number}</span>}
                            <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${po.status === 'pending_approval' ? 'text-amber-800 bg-amber-100' : po.status === 'cancelled' ? 'text-slate-600 bg-slate-200' : 'text-blue-700 bg-blue-50'}`}>
                              {PO_STATUS_LABEL[po.status] || String(po.status).replace(/_/g, ' ')}
                            </span>
                            {po.status === 'pending_approval' && <span className="text-[11px] text-amber-800">needs {po.approval_level === 'ceo' ? 'CEO' : 'manager'} approval</span>}
                            {po.approved_by_name && <span className="text-[11px] text-slate-500">approved by {po.approved_by_name}</span>}
                          </div>
                          <h3 className="text-base font-bold mt-1">{po.supplier_name}</h3>
                          <p className="text-xs text-slate-500">
                            Goods: <strong>{po.currency} {formatSAR(po.goods_total_fx)}</strong> (SAR {formatSAR(po.goods_total_sar)}) + Freight/Customs: <strong>SAR {formatSAR(po.landed_cost_sar)}</strong> = Total Landed: <strong>SAR {formatSAR(totalLandedSar)}</strong>
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {(po.items || []).map((l) => `${l.desc}: ${Number(l.receivedQty || 0)}/${Number(l.qty)} received, ${Number(l.billedQty || 0)} billed`).join(' • ')}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {po.status === 'pending_approval' && can(profile, 'po.approve') && (po.approval_level !== 'ceo' || ['admin', 'ceo'].includes(String(profile?.role_key))) && (
                            <>
                              <button onClick={() => handleApprovePO(po)} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold cursor-pointer">Approve</button>
                              <button onClick={() => handleRejectPO(po)} className="px-3 py-2 rounded-xl border border-rose-300 text-rose-700 text-xs font-semibold cursor-pointer">Reject</button>
                            </>
                          )}
                          {openToReceive(po) && (
                            <button
                              hidden={!can(profile, 'po.grn')}
                              onClick={() => handleRecordGoodsReceipt(po)}
                              className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
                            >
                              {Number((po.items || []).reduce((t, l) => t + Number(l.receivedQty || 0), 0)) > 0 ? 'Receive more goods' : 'Record GRN (Goods Received)'}
                            </button>
                          )}
                          {openToBill(po) && (
                            <button
                              hidden={!can(profile, 'po.bill')}
                              onClick={() => handlePostSupplierBill(po)}
                              className="px-3 py-2 rounded-xl bg-purple-600 text-white text-xs font-semibold cursor-pointer"
                            >
                              Post Supplier Bill
                            </button>
                          )}
                          {['billed', 'partially_billed', 'closed'].includes(po.status) && po.payment_status !== 'paid' && can(profile, 'supplier_payment.create') && (
                            <button
                              onClick={() => selectSubModule('finance', 'fin_supplier_payments')}
                              className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                            >
                              Pay Supplier (AP Voucher)
                            </button>
                          )}
                          {openToReceive(po) && po.status !== 'pending_approval' && can(profile, 'po.close') && (
                            <button onClick={() => handleClosePO(po)} className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold cursor-pointer" title="Cancel, or close the quantities that will not arrive">Close / cancel</button>
                          )}
                          {po.bill_status === 'paid' && (
                            <span className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-bold">
                              ✓ GRN &amp; Supplier Paid
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
                </SmartFilterBar>
              )}
              {view === 'pur_grn' && <PurchaseDocsList kind="grn" docs={goodsReceipts} />}
              {view === 'pur_bills' && <PurchaseDocsList kind="bill" docs={supplierBills} />}
            </div>
          )}
          {view === 'pur_requisitions' && (
            <RequisitionsView requisitions={requisitions} salesOrders={salesOrders} canCreate={can(profile, 'pr.create')} canOrder={can(profile, 'po.create')}
              onCreateFromSo={handleRaiseRequisition} onOrder={handlePoFromRequisition}
              onCancel={async (r) => { if (await callPosting('cancel_requisition', { p_pr_id: r.id })) refreshAllErpData(); }} />
          )}
    </>
  );
}
