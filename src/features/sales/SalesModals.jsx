// Sales dialogs — moved verbatim from App.jsx (Prompt 15). Data and handlers come from the store (useErp).
import { useErp } from '../../app/ErpContext';
import { Printer, X } from 'lucide-react';
import { CURRENCIES } from '../../app/constants';
import { DeliveryNotePreviewModal, QuotationPreviewModal, SalesOrderPreviewModal } from '../../erp/QuotationAndDeliveryPreviewModals';
import { QuoteControls, SalesOrderAmendModal } from '../../erp/SalesControlsPanels';
import { SmartEntitySelect } from '../../erp/SmartDiscovery';
import { VAT_EXEMPTION_REASONS, formatSAR } from '../../erp/erpEngine';
import { can } from '../../lib/permissions';
import { computeQuoteFinancials, quoteForPreview, quoteLineUnitSellSar, quoteLineVat } from '../../lib/quoteMath';
import { supabase } from '../../lib/supabase';
import { zatcaQr, zatcaStatus } from '../../lib/zatca';
import { QrImage } from '../../ui/QrImage';

export default function SalesModals() {
  const { amendSO, company, customerSelectOptions, customers, deliveryModalSO, deliveryNotesText, deliveryQtys, deliverySerials,
    deliveryWarehouse, fxRates, handleConvertQuoteToSO, handleCreateInquiry, handleRecordCustomerPayment, handleRecordDelivery,
    handleSelectCustomerForInq, handleSelectItemForInq, itemSelectOptions, items, itemsById, newInq, paymentAmount, paymentMethod,
    paymentModalInv, paymentRef, previewDN, previewInvoice, previewQuotation, previewSO, profile, quoteApprovals, refreshAllErpData,
    salesmanSelectOptions, saveInquiryPatch, selectedInq, setAmendSO, setDeliveryModalSO, setDeliveryNotesText, setDeliveryQtys,
    setDeliverySerials, setDeliveryWarehouse, setNewInq, setPaymentAmount, setPaymentMethod, setPaymentModalInv, setPaymentRef,
    setPreviewDN, setPreviewInvoice, setPreviewQuotation, setPreviewSO, setQuickCreateType, setSelectedInqId, setShowNewInqModal,
    showNewInqModal, stockLevels, userCanPriceQuotes, userCanViewCost, warehouses } = useErp();
  return (
    <>
      {selectedInq && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex justify-end">
          <div className="bg-white w-full max-w-3xl h-full overflow-y-auto p-5 sm:p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <div className="text-xs font-bold text-blue-600">{selectedInq.refNo} • {selectedInq.division}</div>
                <h3 className="text-lg font-bold">{selectedInq.clientName}</h3>
                <p className="text-xs text-slate-500">Sales: {selectedInq.assignedSalesName} ({selectedInq.commissionPct || 0}% Profit Share)</p>
              </div>
              <button onClick={() => setSelectedInqId(null)} className="p-2 rounded-xl bg-slate-100"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase text-slate-600">{userCanViewCost ? 'BOQ Multi-Currency Costing (→ SAR)' : 'BOQ Lines & Prices (SAR)'}</h4>
                <button
                  onClick={() =>
                    saveInquiryPatch(selectedInq, {
                      boqItems: [
                        ...(selectedInq.boqItems || []),
                        { id: `b-${Date.now()}`, desc: 'New Item', qty: 1, unit: 'PCS', buyCurrency: 'USD', buyUnitCost: 0 },
                      ],
                    })
                  }
                  className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer"
                >
                  + Add Line
                </button>
              </div>

              {(selectedInq.boqItems || []).map((item) => (
                <div key={item.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                  <SmartEntitySelect
                    label="Catalog Item / Service"
                    placeholder="Search Items Master or create new..."
                    items={itemSelectOptions}
                    value={item.itemId || ''}
                    createNewLabel="Create New Item / Service"
                    onCreateNew={can(profile, 'item.manage') ? () => setQuickCreateType('item') : undefined}
                    onChange={(chosenId) => {
                      const chosen = items.find((x) => x.id === chosenId);
                      if (!chosen) return;
                      saveInquiryPatch(selectedInq, {
                        boqItems: selectedInq.boqItems.map((b) =>
                          b.id === item.id
                            ? {
                                ...b,
                                itemId: chosen.id,
                                desc: chosen.name_ar ? `${chosen.name_en} (${chosen.name_ar})` : chosen.name_en,
                                unit: chosen.uom,
                                buyCurrency: chosen.purchase_currency,
                                buyUnitCost: Number(chosen.purchase_price || 0),
                                vatCategory: chosen.zatca_vat_type || 'S',
                                exemptionReason: chosen.zatca_exemption_reason || '',
                              }
                            : b
                        ),
                      });
                    }}
                  />
                  <input
                    type="text"
                    value={item.desc}
                    onChange={(e) =>
                      saveInquiryPatch(selectedInq, {
                        boqItems: selectedInq.boqItems.map((b) => (b.id === item.id ? { ...b, desc: e.target.value } : b)),
                      })
                    }
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                  />
                  {(() => {
                    const lv = quoteLineVat(item, itemsById);
                    const patchLine = (patch) =>
                      saveInquiryPatch(selectedInq, { boqItems: selectedInq.boqItems.map((b) => (b.id === item.id ? { ...b, ...patch } : b)) });
                    return userCanPriceQuotes ? (
                      <div className="grid grid-cols-2 gap-2">
                        <select value={lv.vatCategory} onChange={(e) => patchLine({ vatCategory: e.target.value, exemptionReason: e.target.value === 'S' ? '' : lv.exemptionReason })}
                          className="bg-white border border-slate-300 rounded-lg px-2 py-1.5" aria-label="VAT category">
                          <option value="S">VAT S — Standard 15%</option>
                          <option value="Z">VAT Z — Zero rated</option>
                          <option value="E">VAT E — Exempt</option>
                          <option value="O">VAT O — Out of scope</option>
                        </select>
                        {lv.vatCategory !== 'S' ? (
                          <select value={lv.exemptionReason} onChange={(e) => patchLine({ exemptionReason: e.target.value })}
                            className={`bg-white border rounded-lg px-2 py-1.5 ${lv.exemptionReason ? 'border-slate-300' : 'border-amber-400'}`} aria-label="Exemption reason">
                            <option value="">Reason (required by ZATCA)…</option>
                            {VAT_EXEMPTION_REASONS.filter((r) => r.category === lv.vatCategory).map((r) => <option key={r.code} value={r.code}>{r.code} — {r.label}</option>)}
                          </select>
                        ) : <span />}
                      </div>
                    ) : lv.vatCategory !== 'S' ? (
                      <div className="text-[11px] text-slate-500">VAT {lv.vatCategory} (0%){lv.exemptionReason ? ` — ${lv.exemptionReason}` : ''}</div>
                    ) : null;
                  })()}
                  <div className={`grid gap-2 ${userCanViewCost ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    <input
                      type="number"
                      value={item.qty}
                      onChange={(e) =>
                        saveInquiryPatch(selectedInq, {
                          boqItems: selectedInq.boqItems.map((b) => (b.id === item.id ? { ...b, qty: parseFloat(e.target.value) || 0 } : b)),
                        })
                      }
                      className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                      placeholder="Qty"
                    />
                    {userCanViewCost ? (
                      <>
                        <select
                          value={item.buyCurrency}
                          disabled={!userCanPriceQuotes}
                          onChange={(e) =>
                            saveInquiryPatch(selectedInq, {
                              boqItems: selectedInq.boqItems.map((b) => (b.id === item.id ? { ...b, buyCurrency: e.target.value } : b)),
                            })
                          }
                          className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-semibold"
                        >
                          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input
                          type="number"
                          step="0.01"
                          value={item.buyUnitCost}
                          disabled={!userCanPriceQuotes}
                          onChange={(e) =>
                            saveInquiryPatch(selectedInq, {
                              boqItems: selectedInq.boqItems.map((b) => (b.id === item.id ? { ...b, buyUnitCost: parseFloat(e.target.value) || 0 } : b)),
                            })
                          }
                          className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                          placeholder="Unit Cost"
                        />
                      </>
                    ) : (
                      <div className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-right">
                        <span className="text-slate-500">Unit price </span>
                        <strong>SAR {formatSAR(quoteLineUnitSellSar(item, selectedInq.marginPercent, fxRates))}</strong>
                        {!(Number(item.sellUnitSar) > 0) && <div className="text-[10px] text-amber-700">Awaiting manager pricing</div>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {(() => {
              const fin = computeQuoteFinancials(selectedInq, fxRates, itemsById);
              return (
                <div className="bg-slate-900 text-white rounded-2xl p-4 space-y-2 text-xs">
                  {userCanViewCost && (
                    <>
                      <div className="flex items-center justify-between">
                        <span>Gross Margin (%):</span>
                        <input
                          type="number"
                          value={selectedInq.marginPercent}
                          disabled={!userCanPriceQuotes}
                          onChange={(e) => saveInquiryPatch(selectedInq, { marginPercent: parseFloat(e.target.value) || 0 })}
                          className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-right font-bold text-amber-300"
                        />
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Landed Cost (SAR):</span>
                        <span>SAR {formatSAR(fin.totalCostSAR)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-400 font-semibold">
                        <span>Net Profit (SAR):</span>
                        <span>SAR {formatSAR(fin.profitSAR)}</span>
                      </div>
                    </>
                  )}
                  {!userCanViewCost && (
                    <div className="flex justify-between text-slate-300">
                      <span>Subtotal (excl. VAT):</span>
                      <span>SAR {formatSAR(fin.sellNetSAR)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold text-blue-400 pt-2 border-t border-slate-800">
                    <span>Total Quote (Incl. VAT SAR {formatSAR(fin.vatSAR)}):</span>
                    <span>SAR {formatSAR(fin.grandTotalSAR)}</span>
                  </div>
                </div>
              );
            })()}

            <QuoteControls supabase={supabase} inquiry={selectedInq} approval={quoteApprovals[selectedInq.id]}
              canApprove={can(profile, 'quote.approve')} canEdit={can(profile, 'quote.create') || userCanPriceQuotes} onChanged={refreshAllErpData} />
            {selectedInq.stage !== 'won' && !userCanPriceQuotes && (
              <p className="text-xs text-slate-500 text-center">A Sales Manager reviews the pricing and converts this quote to a Sales Order.</p>
            )}
            {!['won', 'lost'].includes(selectedInq.stage) && userCanPriceQuotes && (
              <button
                onClick={() => handleConvertQuoteToSO(selectedInq)}
                disabled={quoteApprovals[selectedInq.id]?.needed && !quoteApprovals[selectedInq.id]?.approved}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {quoteApprovals[selectedInq.id]?.needed && !quoteApprovals[selectedInq.id]?.approved ? 'Pricing needs approval before converting' : 'Convert Quote to Sales Order (SO) →'}
              </button>
            )}
          </div>
        </div>
      )}
      {showNewInqModal && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">New Client Inquiry</h3>
              <button onClick={() => setShowNewInqModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateInquiry} className="space-y-3 text-xs">
              <SmartEntitySelect
                label="Customer (Search Master or Create New)"
                placeholder="Search customer name, code, VAT, or phone..."
                items={customerSelectOptions}
                value={newInq.customerId}
                createNewLabel="Create New Customer"
                onCreateNew={can(profile, 'customer.create') ? () => setQuickCreateType('customer') : undefined}
                onChange={handleSelectCustomerForInq}
              />

              <input
                type="text"
                required
                placeholder="Client Company Name *"
                value={newInq.clientName}
                onChange={(e) => setNewInq({ ...newInq, clientName: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-base sm:text-xs"
              />
              <input
                type="text"
                maxLength={15}
                placeholder="Client 15-Digit VAT No (Optional - B2B)"
                value={newInq.clientVat}
                onChange={(e) => setNewInq({ ...newInq, clientVat: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-base sm:text-xs font-mono"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Contact Person *"
                  value={newInq.contactPerson}
                  onChange={(e) => setNewInq({ ...newInq, contactPerson: e.target.value })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5 text-base sm:text-xs"
                />
                <input
                  type="tel"
                  required
                  placeholder="Phone / WhatsApp *"
                  value={newInq.phone}
                  onChange={(e) => setNewInq({ ...newInq, phone: e.target.value })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5 text-base sm:text-xs"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Division *</label>
                  <select
                    value={newInq.division}
                    onChange={(e) => setNewInq({ ...newInq, division: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 bg-white text-base sm:text-xs"
                  >
                    <option value="MEP">MEP Trading</option>
                    <option value="IT & ELV">IT &amp; ELV</option>
                  </select>
                </div>

                <SmartEntitySelect
                  label="Assigned Salesman"
                  required
                  placeholder="Search or create salesman..."
                  items={salesmanSelectOptions}
                  value={newInq.salesmanId}
                  createNewLabel="Create New Salesman"
                  onCreateNew={can(profile, 'user.create_salesman') ? () => setQuickCreateType('salesman') : undefined}
                  onChange={(val) => setNewInq({ ...newInq, salesmanId: val })}
                />
              </div>

              <SmartEntitySelect
                label="Primary Item / Service (Search Catalog or Create New)"
                placeholder="Search item code, English/Arabic name..."
                items={itemSelectOptions}
                value={newInq.itemId}
                createNewLabel="Create New Item / Service"
                onCreateNew={can(profile, 'item.manage') ? () => setQuickCreateType('item') : undefined}
                onChange={handleSelectItemForInq}
              />

              <input
                type="text"
                required
                placeholder="Primary Item / Scope Description *"
                value={newInq.firstItemDesc}
                onChange={(e) => setNewInq({ ...newInq, firstItemDesc: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-base sm:text-xs"
              />
              <button type="submit" className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">
                Save Inquiry
              </button>
            </form>
          </div>
        </div>
      )}
      {deliveryModalSO && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">Record Delivery — {deliveryModalSO.so_number}</h3>
              <button onClick={() => setDeliveryModalSO(null)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleRecordDelivery} className="space-y-3 text-xs">
              {warehouses.length > 1 && (
                <select value={deliveryWarehouse || (warehouses.find((w) => w.is_default) || {}).code || ''} onChange={(e) => setDeliveryWarehouse(e.target.value)} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white">
                  {warehouses.map((w) => <option key={w.code} value={w.code}>Ship from {w.code} — {w.name_en}</option>)}
                </select>
              )}
              {(deliveryModalSO.items || []).map((it) => {
                const remaining = Math.max(0, Number(it.orderedQty) - Number(it.deliveredQty || 0));
                const master = it.itemId ? itemsById[it.itemId] : null;
                const wh = deliveryWarehouse || (warehouses.find((w) => w.is_default) || {}).code;
                const onHand = master?.is_stocked_item ? stockLevels.filter((x) => x.item_id === master.id && x.warehouse === wh).reduce((t, x) => t + Number(x.qty || 0), 0) : null;
                const shipping = Number(deliveryQtys[it.id] ?? remaining);
                return (
                  <div key={it.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold">{it.desc}</div>
                      <div className="text-slate-500">Ordered: {it.orderedQty} • Pending: {remaining}
                        {onHand !== null && <> • In stock ({wh}): <strong className={onHand < shipping ? 'text-rose-700' : 'text-emerald-700'}>{onHand}</strong></>}
                        {master && !master.is_stocked_item && <> • non-stock</>}
                      </div>
                      {onHand !== null && onHand < shipping && <div className="text-amber-800">Not enough stock: the delivery is allowed, cost is taken at the last known average and corrected when goods are received.</div>}
                    </div>
                    <input
                      type="number"
                      min="0"
                      max={remaining}
                      value={deliveryQtys[it.id] ?? remaining}
                      onChange={(e) => setDeliveryQtys({ ...deliveryQtys, [it.id]: e.target.value })}
                      className="w-20 border border-slate-300 rounded-lg px-2.5 py-1.5 text-right font-bold bg-white"
                    />
                  </div>
                  {master?.is_serialized && shipping > 0 && (
                    <textarea rows={2} value={deliverySerials[it.id] || ''} onChange={(e) => setDeliverySerials({ ...deliverySerials, [it.id]: e.target.value })}
                      placeholder={`Serial numbers delivered (${shipping}), one per line`} className="w-full border border-amber-300 bg-amber-50 rounded-lg px-2 py-1.5 font-mono" />
                  )}
                  </div>
                );
              })}
              <input
                type="text"
                placeholder="Driver / Waybill / Site Receiver Notes"
                value={deliveryNotesText}
                onChange={(e) => setDeliveryNotesText(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5"
              />
              <button type="submit" className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">
                Confirm &amp; Issue Delivery Note
              </button>
            </form>
          </div>
        </div>
      )}
      {amendSO && <SalesOrderAmendModal supabase={supabase} so={amendSO} onClose={() => setAmendSO(null)} onDone={() => { setAmendSO(null); refreshAllErpData(); }} />}
      {previewQuotation && (
        <QuotationPreviewModal company={company} customers={customers} inquiry={quoteForPreview(previewQuotation, fxRates, itemsById)} onClose={() => setPreviewQuotation(null)} />
      )}
      {previewSO && <SalesOrderPreviewModal company={company} customers={customers} so={previewSO} onClose={() => setPreviewSO(null)} />}
      {previewDN && <DeliveryNotePreviewModal company={company} customers={customers} dn={previewDN} onClose={() => setPreviewDN(null)} />}
      {previewInvoice && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <span className="font-bold text-base">{previewInvoice.invoice_kind === 'advance' ? 'Advance Payment Tax Invoice • فاتورة ضريبية لدفعة مقدمة' : 'ZATCA Tax Invoice • فاتورة ضريبية'}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Print / PDF
                </button>
                <button onClick={() => setPreviewInvoice(null)}><X className="w-5 h-5" /></button>
              </div>
            </div>

            <div className="flex justify-between items-start gap-4 border-b pb-4">
              <div className="space-y-1 text-xs">
                <div className="text-lg font-bold text-slate-900">{company.nameEn}</div>
                <div className="text-sm font-bold text-blue-700">{company.nameAr}</div>
                <div className="text-slate-600">{company.addressEn} | {company.addressAr}</div>
                <div className="font-mono font-semibold">VAT Reg / الرقم الضريبي: {company.vatNumber}</div>
                <div className="font-mono">CR / السجل التجاري: {company.crNumber}</div>
              </div>

              <div className="text-center shrink-0">
                <QrImage value={zatcaQr(previewInvoice)} size={112} alt="ZATCA QR code" className="w-28 h-28 border border-slate-200 rounded-lg p-1 mx-auto" />
                <div className="text-[10px] text-slate-500 mt-1 font-mono">{previewInvoice.zatca_qr ? `ZATCA Phase 2 QR (${zatcaStatus(previewInvoice).label})` : 'ZATCA Phase 1 QR'}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3.5 rounded-xl">
              <div>
                <div className="text-slate-400">Invoice No / رقم الفاتورة</div>
                <div className="font-bold">{previewInvoice.invoice_number}</div>
              </div>
              <div>
                <div className="text-slate-400">Issue Date / التاريخ</div>
                <div className="font-bold">{new Date(previewInvoice.issued_at).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-slate-400">Customer / العميل</div>
                <div className="font-bold">{previewInvoice.client_name}</div>
              </div>
              <div>
                <div className="text-slate-400">ZATCA UUID</div>
                <div className="font-mono text-[10px] truncate">{previewInvoice.zatca_uuid}</div>
              </div>
            </div>

            <table className="w-full text-xs border border-slate-200">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-2 text-left">Description / البيان</th>
                  <th className="p-2 text-right">Qty / الكمية</th>
                  <th className="p-2 text-right">Unit Price / السعر</th>
                  <th className="p-2 text-right">Total / الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(previewInvoice.items || []).map((it, idx) => (
                  <tr key={idx}>
                    <td className="p-2">{it.desc}</td>
                    <td className="p-2 text-right">{it.qty}</td>
                    <td className="p-2 text-right">{formatSAR(it.unitSellSar)}</td>
                    <td className="p-2 text-right font-semibold">{formatSAR(Number(it.qty) * Number(it.unitSellSar))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="ml-auto max-w-xs space-y-1 text-xs">
              <div className="flex justify-between">
                <span>Subtotal (Excl. VAT) / المجموع الفرعي:</span>
                <span className="font-semibold">SAR {formatSAR(previewInvoice.subtotal_sar)}</span>
              </div>
              <div className="flex justify-between">
                <span>VAT (15%) / ضريبة القيمة المضافة:</span>
                <span className="font-semibold">SAR {formatSAR(previewInvoice.vat_sar)}</span>
              </div>
              {Number(previewInvoice.prepaid_sar) > 0 ? (
                <>
                  <div className="flex justify-between pt-1.5 border-t">
                    <span>Total Incl. VAT / الإجمالي شامل الضريبة:</span>
                    <span className="font-semibold">SAR {formatSAR(Number(previewInvoice.subtotal_sar) + Number(previewInvoice.vat_sar))}</span>
                  </div>
                  {(previewInvoice.prepayments || []).map((p) => (
                    <div key={p.invoiceId} className="flex justify-between text-slate-600">
                      <span>Less advance {p.number} (SAR {formatSAR(p.taxable)} + VAT {formatSAR(p.vat)}) / خصم الدفعة المقدمة:</span>
                      <span>- SAR {formatSAR(Number(p.taxable) + Number(p.vat))}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm font-bold text-blue-700 pt-1.5 border-t">
                    <span>Amount Due / المبلغ المستحق:</span>
                    <span>SAR {formatSAR(previewInvoice.grand_total_sar)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-sm font-bold text-blue-700 pt-1.5 border-t">
                  <span>Total Incl. VAT / الإجمالي شامل الضريبة:</span>
                  <span>SAR {formatSAR(previewInvoice.grand_total_sar)}</span>
                </div>
              )}
              {previewInvoice.invoice_kind === 'progress' && previewInvoice.billing && (
                <div className="mt-2 p-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 space-y-0.5">
                  <div className="flex justify-between"><span>Work done this claim / قيمة الأعمال:</span><span>SAR {formatSAR(previewInvoice.billing.gross)}</span></div>
                  <div className="flex justify-between"><span>Retention held {previewInvoice.billing.retentionPct}% / المحتجز:</span><span>SAR {formatSAR(previewInvoice.retention_sar)}</span></div>
                  <div className="flex justify-between"><span>Work done to date / الأعمال المنجزة حتى تاريخه:</span><span>SAR {formatSAR(previewInvoice.billing.cumulativeGross)} ({previewInvoice.billing.percentComplete}%)</span></div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {paymentModalInv && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">Receive Customer Payment — {paymentModalInv.invoice_number}</h3>
              <button onClick={() => setPaymentModalInv(null)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleRecordCustomerPayment} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Amount Received (SAR) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-base font-bold"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="border border-slate-300 rounded-xl px-3 py-2.5 bg-white"
                >
                  <option value="Bank Transfer">Bank Transfer (SAR)</option>
                  <option value="Mada / POS">Mada / POS</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Cash">Cash</option>
                </select>
                <input
                  type="text"
                  placeholder="Bank Ref / Transfer ID"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  className="border border-slate-300 rounded-xl px-3 py-2.5"
                />
              </div>
              <button type="submit" className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold cursor-pointer">
                Post Receipt &amp; Unlock Sales Profit Share
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
