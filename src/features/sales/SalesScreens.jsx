// Sales screens — moved verbatim from App.jsx (Prompt 15). Data and handlers come from the store (useErp).
import { useErp } from '../../app/ErpContext';
import { Plus, QrCode, Receipt, Truck } from 'lucide-react';
import { CommissionPayoutPanel } from '../../erp/CommissionPayoutPanel';
import { CreditNotesView } from '../../erp/CreditNotesView';
import { CustomersMasterView } from '../../erp/MasterDataViews';
import { INVOICE_KIND } from '../../erp/ProjectsAndContracts';
import { ApprovalBadge, CreditControlPanel, QUOTE_STAGES, SalesPipelineView } from '../../erp/SalesControlsPanels';
import { formatSAR, invoiceOpenSar } from '../../erp/erpEngine';
import { ShareDocumentButtons } from '../../erp/shareDispatch';
import { can } from '../../lib/permissions';
import { computeQuoteFinancials } from '../../lib/quoteMath';
import { supabase } from '../../lib/supabase';
import { blocksSharing, needsSubmission, zatcaStatus } from '../../lib/zatca';
import { SmartFilterBar } from '../../ui/SmartFilterBar';

export default function SalesScreens() {
  const { commissions, company, creditNotes, customers, debitNotes, deliveryNotes, fxRates, glAccounts, handleConvertQuoteToSO,
    handleGenerateZatcaInvoiceFromDN, handleSubmitToZatca, inquiries, invoices, itemsById, lang, openDeliveryModal,
    openInvoicePrint, openObject, profile, quoteApprovals, refreshAllErpData, salesOrders, salesSettings, salesmenList, setAmendSO,
    setPaymentAmount, setPaymentModalInv, setPreviewDN, setPreviewQuotation, setPreviewSO, setSelectedInqId, setShowNewInqModal,
    userCanPriceQuotes, userCanViewCost, view, zatcaBusyId } = useErp();
  return (
    <>
          {view === 'sales_customers' && (
            <CustomersMasterView
              readOnly={!can(profile, 'customer.create')}
              canImport={can(profile, 'customer.import')}
              canErase={can(profile, 'privacy.erase')}
              supabase={supabase}
              customers={customers}
              salesmenList={salesmenList}
              onRefresh={refreshAllErpData}
            />
          )}
          {view === 'sales_customers' && can(profile, 'credit.view') && (
            <CreditControlPanel supabase={supabase} customers={customers} inquiries={inquiries} deliveryNotes={deliveryNotes} invoices={invoices}
              salesOrders={salesOrders} canOverride={can(profile, 'credit.override')} settings={salesSettings} />
          )}
          {view === 'sales_pipeline' && <SalesPipelineView supabase={supabase} />}
          {view === 'sales_quotes' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Inquiries &amp; Commercial Quotations</h2>
                <button
                  hidden={!can(profile, 'quote.create')}
                  onClick={() => setShowNewInqModal(true)}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> New Inquiry
                </button>
              </div>

              {inquiries.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
                  <p className="text-sm text-slate-500">No active inquiries yet. Log your first client RFQ to start the Order-to-Cash cycle.</p>
                  <button
                    hidden={!can(profile, 'quote.create')}
                    onClick={() => setShowNewInqModal(true)}
                    className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" /> Create First Inquiry
                  </button>
                </div>
              ) : (
                <SmartFilterBar lang={lang} rows={inquiries} storageKey="quotes" searchKeys={['id', 'clientName', 'contactPerson', 'assignedSalesName']} filters={[{ key: 'status', label: lang === 'ar' ? 'الحالة' : 'Status', type: 'select' }, { key: 'division', label: lang === 'ar' ? 'القسم' : 'Division', type: 'select' }, { key: 'assignedSalesName', label: lang === 'ar' ? 'المندوب' : 'Salesman', type: 'select' }]} sortOptions={[{ key: 'updatedAt', label: 'Updated' }, { key: 'clientName', label: 'Client' }]} csv={{ filename: 'Inquiries', columns: [{ key: 'id', label: 'Inquiry #' }, { key: 'clientName', label: 'Client' }, { key: 'status', label: 'Status' }, { key: 'division', label: 'Division' }, { key: 'assignedSalesName', label: 'Salesman' }] }}>
                {(rows) => (
                <div className="grid gap-3">
                  {rows.map((inq) => {
                    const fin = computeQuoteFinancials(inq, fxRates, itemsById);
                    return (
                      <div
                        key={inq.id}
                        onClick={() => setSelectedInqId(inq.id)}
                        className="bg-white border border-slate-200 hover:border-blue-400 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{inq.refNo}</span>
                            <span className="text-xs font-semibold bg-slate-100 px-2 py-0.5 rounded">{inq.division}</span>
                            <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded">
                              Sales: {inq.assignedSalesName} ({inq.commissionPct || 0}% Share)
                            </span>
                            <span className="text-xs font-semibold bg-white border border-slate-200 px-2 py-0.5 rounded">Rev {inq.revision || 'A'} • {QUOTE_STAGES[inq.stage] || 'New inquiry'}</span>
                            <ApprovalBadge status={quoteApprovals[inq.id]} />
                          </div>
                          <h3 className="text-base font-bold mt-1">{inq.clientName} <span className="ml-2"><button type="button" onClick={(e) => { e.stopPropagation(); setPreviewQuotation(inq); }} className="no-print px-2 py-1 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer transition mr-1"><span>Preview A4 Quote</span></button><ShareDocumentButtons company={company} customers={customers} docType="Quotation / RFQ" docNumber={inq.id} clientName={inq.clientName} division={inq.division} status={inq.status} directPhone={inq.phone} directEmail={inq.email} compact /></span></h3>
                          <p className="text-xs text-slate-500">{inq.contactPerson} • {inq.phone}</p>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-4">
                          <div className="text-right">
                            <div className="text-xs text-slate-400">Quote Total (Incl. VAT)</div>
                            <div className="text-base font-bold">SAR {formatSAR(fin.grandTotalSAR)}</div>
                          </div>
                          {inq.stage !== 'won' ? (
                            userCanPriceQuotes && inq.stage !== 'lost' && <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConvertQuoteToSO(inq);
                              }}
                              disabled={quoteApprovals[inq.id]?.needed && !quoteApprovals[inq.id]?.approved}
                              title={quoteApprovals[inq.id]?.needed && !quoteApprovals[inq.id]?.approved ? 'Approve the pricing first (open the quote)' : undefined}
                              className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed"
                            >
                              Convert to SO →
                            </button>
                          ) : (
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold">
                              SO Created
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
            </div>
          )}
          {view === 'sales_orders' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Sales Orders (SO)</h2>
                <p className="text-xs text-slate-500">Track line-item fulfillment and dispatch Full or Partial Deliveries.</p>
              </div>

              {salesOrders.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                  No Sales Orders yet. Convert an approved quote under <strong>Sales &amp; Fulfillment → Inquiries &amp; Quotes</strong>.
                </div>
              ) : (
                <SmartFilterBar lang={lang} rows={salesOrders} storageKey="salesOrders" searchKeys={['so_number', 'client_name', 'salesman_name']} filters={[{ key: 'status', label: lang === 'ar' ? 'الحالة' : 'Status', type: 'select' }, { key: 'division', label: lang === 'ar' ? 'القسم' : 'Division', type: 'select' }, { key: 'created_at', label: lang === 'ar' ? 'التاريخ' : 'Date', type: 'daterange' }, { key: 'grand_total_sar', label: lang === 'ar' ? 'القيمة' : 'Amount', type: 'numberrange' }]} sortOptions={[{ key: 'created_at', label: 'Date' }, { key: 'grand_total_sar', label: 'Amount' }, { key: 'client_name', label: 'Client' }]} defaultSort={{ key: 'created_at', dir: 'desc' }} csv={{ filename: 'Sales_Orders', columns: [{ key: 'so_number', label: 'SO #' }, { key: 'client_name', label: 'Client' }, { key: 'division', label: 'Division' }, { key: 'status', label: 'Status' }, { key: 'grand_total_sar', label: 'Total (SAR)' }, { key: 'created_at', label: 'Date' }] }}>
                {(rows) => (
                <div className="grid gap-4">
                  {rows.map((so) => (
                    <div key={so.id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded"><button type="button" onClick={(e) => { e.stopPropagation(); openObject('so', so.id); }} className="underline decoration-dotted underline-offset-2 hover:text-blue-900 cursor-pointer">{so.so_number}</button> <span className={`ms-1.5 text-[10px] px-1.5 py-0.5 rounded font-bold ${so.division === 'IT & ELV' ? 'bg-violet-100 text-violet-800' : 'bg-emerald-100 text-emerald-800'}`}>{so.division || 'MEP'}</span> <div className="mt-1"><button type="button" onClick={(e) => { e.stopPropagation(); setPreviewSO(so); }} className="no-print px-2 py-1 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer transition mr-1"><span>Preview A4 SO</span></button><ShareDocumentButtons company={company} customers={customers} docType="Sales Order" docNumber={so.so_number} clientName={so.client_name} division={so.division} totalSar={so.grand_total_sar} status={so.status} compact /></div></span>
                            <span className="text-xs font-semibold uppercase px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                              {so.status.replace('_', ' ')}
                            </span>
                          </div>
                          <h3 className="text-base font-bold mt-1">{so.client_name}</h3>
                          <p className="text-xs text-slate-500">
                            Salesman: <strong>{so.salesman_name}</strong> • Total: <strong>SAR {formatSAR(so.grand_total_sar)}</strong>
                          </p>
                        </div>

                        {!['delivered', 'cancelled'].includes(so.status) && can(profile, 'so.amend') && (
                          <button type="button" onClick={() => setAmendSO(so)} className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold cursor-pointer">Change / cancel</button>
                        )}
                        {!['delivered', 'cancelled'].includes(so.status) && can(profile, 'delivery.create') && (
                          <button
                            onClick={() => openDeliveryModal(so)}
                            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Truck className="w-4 h-4" /> Record Delivery (Full / Partial)
                          </button>
                        )}
                      </div>

                      <div className="border border-slate-100 rounded-xl overflow-hidden text-xs">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50 text-slate-500">
                            <tr>
                              <th className="p-2">Item</th>
                              <th className="p-2 text-right">Ordered</th>
                              <th className="p-2 text-right">Delivered</th>
                              <th className="p-2 text-right">Pending</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {(so.items || []).map((it) => {
                              const pending = Math.max(0, Number(it.orderedQty) - Number(it.deliveredQty || 0));
                              return (
                                <tr key={it.id}>
                                  <td className="p-2 font-medium">{it.desc}</td>
                                  <td className="p-2 text-right">{it.orderedQty} {it.unit}</td>
                                  <td className="p-2 text-right text-emerald-600 font-semibold">{it.deliveredQty || 0}</td>
                                  <td className="p-2 text-right text-amber-600 font-semibold">{pending}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
                )}
                </SmartFilterBar>
              )}
            </div>
          )}
          {view === 'sales_deliveries' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Delivery Notes (Full &amp; Partial Dispatches)</h2>
                <p className="text-xs text-slate-500">Issue ZATCA Tax Invoices directly against completed Delivery Notes.</p>
              </div>

              {deliveryNotes.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                  No Delivery Notes recorded yet.
                </div>
              ) : (
                <SmartFilterBar lang={lang} rows={deliveryNotes} storageKey="deliveries" searchKeys={['dn_number', 'so_number', 'client_name']} filters={[{ key: 'delivery_type', label: lang === 'ar' ? 'النوع' : 'Type', type: 'select' }, { key: 'division', label: lang === 'ar' ? 'القسم' : 'Division', type: 'select' }, { key: 'delivered_at', label: lang === 'ar' ? 'التاريخ' : 'Date', type: 'daterange' }]} sortOptions={[{ key: 'delivered_at', label: 'Date' }, { key: 'client_name', label: 'Client' }]} defaultSort={{ key: 'delivered_at', dir: 'desc' }} csv={{ filename: 'Delivery_Notes', columns: [{ key: 'dn_number', label: 'DN #' }, { key: 'so_number', label: 'SO #' }, { key: 'client_name', label: 'Client' }, { key: 'delivery_type', label: 'Type' }, { key: 'delivered_at', label: 'Date' }] }}>
                {(rows) => (
                <div className="grid gap-3">
                  {rows.map((dn) => {
                    const alreadyInvoiced = invoices.some((inv) => inv.dn_id === dn.id);
                    return (
                      <div key={dn.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">{dn.dn_number} <div className="mt-1 inline-flex flex-wrap items-center gap-1"><button type="button" onClick={(e) => { e.stopPropagation(); setPreviewDN(dn); }} className="no-print px-2 py-1 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer transition"><span>Preview A4 DN</span></button><ShareDocumentButtons company={company} customers={customers} docType="Delivery Note" docNumber={dn.dn_number} clientName={dn.client_name} division={dn.division} status={dn.status || "Dispatched"} compact /></div></span>
                            <span className="text-xs uppercase font-semibold bg-slate-100 px-2 py-0.5 rounded">{dn.delivery_type} Delivery</span>
                            <span className="text-xs text-slate-500">Ref: {dn.so_number}</span>
                          </div>
                          <div className="font-bold text-sm mt-1">{dn.client_name}</div>
                        </div>

                        {alreadyInvoiced ? (
                          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl">
                            ✓ ZATCA Invoice Issued
                          </span>
                        ) : (
                          <button
                            hidden={!can(profile, 'invoice.create')}
                            onClick={() => handleGenerateZatcaInvoiceFromDN(dn)}
                            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Receipt className="w-4 h-4" /> Issue ZATCA Tax Invoice
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                )}
                </SmartFilterBar>
              )}
            </div>
          )}
          {view === 'sales_credit_notes' && (<CreditNotesView readOnly={!can(profile, 'credit_note.create')} supabase={supabase} company={company} invoices={invoices} creditNotes={creditNotes} debitNotes={debitNotes} canDebit={can(profile, 'debit_note.create')} canSubmitZatca={can(profile, 'zatca.submit')} commissions={commissions} profile={profile} onRefresh={refreshAllErpData} />)}
          {view === 'sales_invoices' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">ZATCA E-Invoices (Phase 1 TLV QR &amp; Phase 2 Ready)</h2>
                <p className="text-xs text-slate-500">Posted invoices are locked against deletion/modification per ZATCA regulations.</p>
              </div>

              {invoices.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                  No ZATCA invoices issued yet.
                </div>
              ) : (
                <SmartFilterBar lang={lang} rows={invoices} storageKey="invoices" searchKeys={['invoice_number', 'client_name', 'so_number', 'salesman_name']} filters={[{ key: 'payment_status', label: lang === 'ar' ? 'حالة السداد' : 'Payment', type: 'select' }, { key: 'division', label: lang === 'ar' ? 'القسم' : 'Division', type: 'select' }, { key: 'invoice_type', label: lang === 'ar' ? 'النوع' : 'Type', type: 'select' }, { key: 'issued_at', label: lang === 'ar' ? 'التاريخ' : 'Date', type: 'daterange' }, { key: 'grand_total_sar', label: lang === 'ar' ? 'القيمة' : 'Amount', type: 'numberrange' }]} sortOptions={[{ key: 'issued_at', label: 'Date' }, { key: 'grand_total_sar', label: 'Amount' }, { key: 'client_name', label: 'Client' }]} defaultSort={{ key: 'issued_at', dir: 'desc' }} csv={{ filename: 'ZATCA_Invoices', columns: [{ key: 'invoice_number', label: 'Invoice #' }, { key: 'client_name', label: 'Client' }, { key: 'client_vat', label: 'Client VAT' }, { key: 'division', label: 'Division' }, { key: 'subtotal_sar', label: 'Subtotal (SAR)' }, { key: 'vat_sar', label: 'VAT (SAR)' }, { key: 'grand_total_sar', label: 'Total (SAR)' }, { key: 'paid_amount_sar', label: 'Paid (SAR)' }, { key: 'payment_status', label: 'Status' }, { key: 'issued_at', label: 'Issued' }] }}>
                {(rows) => (
                <div className="grid gap-3">
                  {rows.map((inv) => {
                    const balanceDue = Math.max(0, invoiceOpenSar(inv));
                    return (
                      <div key={inv.id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded"><button type="button" onClick={(e) => { e.stopPropagation(); openObject('invoice', inv.id); }} className="underline decoration-dotted underline-offset-2 hover:text-blue-900 cursor-pointer">{inv.invoice_number}</button> <span className={`ms-1.5 text-[10px] px-1.5 py-0.5 rounded font-bold ${inv.division === 'IT & ELV' ? 'bg-violet-100 text-violet-800' : 'bg-emerald-100 text-emerald-800'}`}>{inv.division || 'MEP'}</span>{inv.invoice_kind && inv.invoice_kind !== 'sale' && <span className="ms-1 text-[10px] px-1.5 py-0.5 rounded font-bold bg-amber-100 text-amber-800">{INVOICE_KIND[inv.invoice_kind] || inv.invoice_kind}</span>} {!blocksSharing(inv) && <div className="mt-1"><ShareDocumentButtons company={company} customers={customers} docType="ZATCA Tax Invoice" docNumber={inv.invoice_number} clientName={inv.client_name} division={inv.division} totalSar={inv.grand_total_sar} status={inv.payment_status} compact /></div>}</span>
                            {(() => {
                              const z = zatcaStatus(inv, lang);
                              const cls = { positive: 'bg-emerald-50 text-emerald-800 border-emerald-200', critical: 'bg-amber-50 text-amber-800 border-amber-200', negative: 'bg-rose-50 text-rose-800 border-rose-200', neutral: 'bg-slate-50 text-slate-700 border-slate-200' }[z.tone];
                              return <span className={`text-[11px] font-semibold border px-2 py-0.5 rounded-full ${cls}`}>ZATCA: {z.label}</span>;
                            })()}
                            {(inv.zatca_warnings || []).length > 0 && (
                              <span title={inv.zatca_warnings.join('\n')} className="text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full cursor-help">
                                ⚠ {inv.zatca_warnings.length} ZATCA {inv.zatca_warnings.length === 1 ? 'warning' : 'warnings'}
                              </span>
                            )}
                            <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${
                              inv.payment_status === 'paid'
                                ? 'bg-emerald-100 text-emerald-800'
                                : inv.payment_status === 'partial'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}>
                              {inv.payment_status}
                            </span>
                          </div>
                          <h3 className="text-base font-bold mt-1">{inv.client_name}</h3>
                          <p className="text-xs text-slate-500">
                            Salesman: <strong>{inv.salesman_name}</strong> • Total: <strong>SAR {formatSAR(inv.grand_total_sar)}</strong> • Paid: <strong>SAR {formatSAR(inv.paid_amount_sar)}</strong>{inv.due_date && <> • Due: <strong className={balanceDue > 0.01 && new Date(`${inv.due_date}T23:59:59+03:00`) < new Date() ? 'text-rose-700' : ''}>{inv.due_date}</strong> ({inv.payment_terms})</>}{Number(inv.credited_amount_sar) > 0 && <> • Credited: <strong>SAR {formatSAR(inv.credited_amount_sar)}</strong></>} • Open: <strong>SAR {formatSAR(balanceDue)}</strong>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {needsSubmission(inv) && can(profile, 'zatca.submit') && (
                            <button
                              type="button"
                              disabled={zatcaBusyId === inv.id}
                              onClick={() => handleSubmitToZatca('invoice', inv)}
                              className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold cursor-pointer disabled:bg-slate-300"
                            >
                              {zatcaBusyId === inv.id ? 'Sending…' : inv.zatca_status === 'rejected' ? 'Fix & resubmit to ZATCA' : inv.invoice_type === 'standard' ? 'Clear with ZATCA' : 'Report to ZATCA'}
                            </button>
                          )}
                          <button
                            onClick={() => openInvoicePrint(inv)}
                            disabled={blocksSharing(inv)}
                            title={blocksSharing(inv) ? 'Available once ZATCA has cleared this B2B invoice' : undefined}
                            className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <QrCode className="w-4 h-4" /> View ZATCA Invoice
                          </button>
                          {balanceDue > 0.01 && can(profile, 'receipt.create') && (
                            <button
                              onClick={() => {
                                setPaymentModalInv(inv);
                                setPaymentAmount(balanceDue.toFixed(2));
                              }}
                              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                            >
                              + Receive Payment (SAR {formatSAR(balanceDue)})
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
                </SmartFilterBar>
              )}
            </div>
          )}
          {view === 'comm_ledger' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Sales Profit Share Ledger (Collection-Based)</h2>
                <p className="text-xs text-slate-500">
                  Calculated strictly on <strong>Net Profit</strong> and unlocked proportionally as <strong>Customer Payments</strong> are collected.
                  Unlocked commission is expensed to 5140 and owed in 2300 until paid out.
                </p>
              </div>

              <CommissionPayoutPanel supabase={supabase} commissions={commissions} glAccounts={glAccounts} canPay={can(profile, 'commission.pay')} onRefresh={refreshAllErpData} lang={lang} />

              {commissions.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                  No profit-share entries yet.
                </div>
              ) : (
                <div className="grid gap-3">
                  {commissions.map((c) => (
                    <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-0.5 rounded">{c.salesman_name}</span>
                          <span className="text-xs font-semibold bg-slate-100 px-2 py-0.5 rounded">Rate: {c.commission_pct}% of Net Profit</span>
                          <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            c.status === 'paid'
                              ? 'bg-blue-100 text-blue-800'
                              : c.status === 'overpaid'
                              ? 'bg-rose-100 text-rose-800'
                              : c.status === 'ready_for_payout'
                              ? 'bg-emerald-100 text-emerald-800'
                              : c.status === 'partially_unlocked'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-200 text-slate-700'
                          }`}>
                            {String(c.status || '').replace(/_/g, ' ')}
                          </span>
                        </div>
                        <h3 className="text-base font-bold mt-1">{c.client_name} ({c.invoice_number})</h3>
                        <p className="text-xs text-slate-500">
                          {userCanViewCost && <>Deal Net Profit: <strong>SAR {formatSAR(c.net_profit_sar)}</strong> • </>}Total Eligible Share: <strong>SAR {formatSAR(c.total_eligible_commission_sar)}</strong>
                        </p>
                      </div>

                      <div className="text-left sm:text-right bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div className="text-[11px] text-slate-500">Unlocked (Collected Cash Basis)</div>
                        <div className="text-lg font-bold text-emerald-600">SAR {formatSAR(c.unlocked_commission_sar)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
    </>
  );
}
