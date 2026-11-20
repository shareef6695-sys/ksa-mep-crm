import React from 'react';
import { Printer, X, FileText, Truck, Building2 } from 'lucide-react';
import { formatSAR } from './erpEngine';
import { ShareDocumentButtons } from './shareDispatch';

export function QuotationPreviewModal({ company, customers = [], inquiry, onClose }) {
  if (!inquiry) return null;

  const clientName = inquiry.clientName || inquiry.client_name || 'Valued Client';
  const matchedCustomer = customers.find(
    (c) =>
      String(c.name_en || c.name || '')
        .trim()
        .toLowerCase() === String(clientName).trim().toLowerCase()
  );

  const quoteNumber = inquiry.quote_number || inquiry.quoteNumber || inquiry.id || 'QUO-DRAFT';
  const division = inquiry.division || 'MEP';
  const items = Array.isArray(inquiry.items) ? inquiry.items : [];

  const subtotalSar = items.reduce((sum, it) => {
    const qty = Number(it.qty) || 0;
    const sell = Number(it.unitSellSar ?? it.sellingPrice ?? it.unit_price ?? it.price ?? 0);
    return sum + qty * sell;
  }, 0) || Number(inquiry.quote_total_sar || inquiry.estimatedValue || 0);

  const vatSar = Number((subtotalSar * 0.15).toFixed(2));
  const grandTotalSar = Number((subtotalSar + vatSar).toFixed(2));

  const issueDate = inquiry.created_at || inquiry.createdAt
    ? new Date(inquiry.created_at || inquiry.createdAt).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : new Date().toLocaleDateString('en-GB');

  return (
    <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto">
        {/* Interactive Action Header (Hidden during A4 Print) */}
        <div className="no-print bg-slate-900 text-white px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold">
            <FileText className="w-4 h-4 text-blue-400" />
            <span>Sales Quotation A4 Print Preview — {quoteNumber}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ShareDocumentButtons
              company={company}
              customers={customers}
              docType="Sales Quotation"
              docNumber={quoteNumber}
              clientName={clientName}
              division={division}
              totalSar={grandTotalSar}
              status={inquiry.status}
              directPhone={inquiry.phone}
              directEmail={inquiry.email}
            />
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition"
            >
              <Printer className="w-4 h-4" />
              <span>Print / Save A4 PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close Preview"
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable A4 Quotation Document Body */}
        <div className="p-6 sm:p-8 space-y-6 text-xs text-slate-800 bg-white">
          <div className="flex flex-wrap justify-between items-start gap-4 border-b-2 border-slate-900 pb-5">
            <div>
              {company?.logoUrl && (
                <img src={company.logoUrl} alt="Company Logo" className="h-14 max-w-[180px] object-contain mb-2" />
              )}
              <div className="text-lg font-extrabold text-slate-900">{company?.nameEn || 'KSA MEP & IT Trading Co.'}</div>
              <div className="text-sm font-bold text-blue-800 mt-0.5">
                {company?.nameAr || 'شركة التجارة والمقاولات الكهروميكانيكية وتقنية المعلومات'}
              </div>
              <div className="text-[11px] text-slate-600 mt-1.5 space-y-0.5">
                <div>{company?.address || 'Jeddah, Kingdom of Saudi Arabia'}</div>
                <div className="font-mono">
                  VAT TIN: <strong>{company?.vatNumber || '300000000000003'}</strong> • CR:{' '}
                  <strong>{company?.crNumber || '4030000000'}</strong>
                </div>
                {company?.phone && (
                  <div>
                    Tel: {company.phone} {company?.email ? `• ${company.email}` : ''}
                  </div>
                )}
              </div>
            </div>

            <div className="text-left sm:text-right">
              <div className="inline-block px-3 py-1 rounded bg-blue-900 text-white font-extrabold text-sm tracking-wide uppercase">
                COMMERCIAL QUOTATION • عرض سعر
              </div>
              <div className="mt-2 space-y-1 font-mono text-xs">
                <div>
                  <span className="text-slate-500 font-sans">Quotation Ref: </span>
                  <strong className="text-sm text-blue-800">{quoteNumber}</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-sans">Issue Date: </span>
                  <strong>{issueDate}</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-sans">Division: </span>
                  <strong>{division}</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-sans">Validity: </span>
                  <strong>{inquiry.validity || '15 Calendar Days'}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Client & Project Info */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-blue-700" /> Prepared For (Customer) • بيانات العميل
              </div>
              <div className="text-sm font-bold text-slate-900 pt-0.5">{clientName}</div>
              {matchedCustomer?.name_ar && <div className="text-xs text-slate-600">{matchedCustomer.name_ar}</div>}
              {matchedCustomer?.vat_number && (
                <div className="font-mono text-[11px] text-slate-600">Client VAT TIN: {matchedCustomer.vat_number}</div>
              )}
              {(matchedCustomer?.address || matchedCustomer?.city) && (
                <div className="text-[11px] text-slate-600">
                  {[matchedCustomer.address, matchedCustomer.city].filter(Boolean).join(', ')}
                </div>
              )}
              {(inquiry.phone || matchedCustomer?.phone || inquiry.email || matchedCustomer?.email) && (
                <div className="text-[11px] text-slate-600 pt-0.5">
                  {inquiry.phone || matchedCustomer?.phone || ''}{' '}
                  {(inquiry.email || matchedCustomer?.email) ? `• ${inquiry.email || matchedCustomer?.email}` : ''}
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Project / Scope Summary • نطاق العمل والشروط
              </div>
              <div className="font-bold text-slate-900 pt-0.5">
                {inquiry.projectName || inquiry.subject || inquiry.title || `${division} Supply & Solutions`}
              </div>
              <div className="text-[11px] text-slate-600">
                Sales Representative: <strong>{inquiry.salesman || inquiry.assignedTo || 'Sales Team'}</strong>
              </div>
              <div className="text-[11px] text-slate-600">
                Delivery Terms: <strong>{inquiry.deliveryTerms || 'Ex-Stock / As per agreed schedule'}</strong>
              </div>
              <div className="text-[11px] text-slate-600">
                Payment Terms: <strong>{inquiry.paymentTerms || matchedCustomer?.payment_terms || 'As agreed'}</strong>
              </div>
            </div>
          </div>

          {/* Quoted Items Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-white">
                <tr>
                  <th className="p-3 w-10">#</th>
                  <th className="p-3">Item / Service Description • البيان</th>
                  <th className="p-3 text-center">UOM</th>
                  <th className="p-3 text-right">Qty</th>
                  <th className="p-3 text-right">Unit Price (SAR)</th>
                  <th className="p-3 text-right">Total Excl. VAT (SAR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-slate-500">
                      {inquiry.notes || inquiry.projectName || 'Consolidated Commercial Proposal'}
                    </td>
                  </tr>
                ) : (
                  items.map((item, idx) => {
                    const qty = Number(item.qty) || 0;
                    const unitSar = Number(item.unitSellSar ?? item.sellingPrice ?? item.unit_price ?? item.price ?? 0);
                    return (
                      <tr key={idx}>
                        <td className="p-3 font-mono text-slate-500">{idx + 1}</td>
                        <td className="p-3 font-semibold text-slate-900">{item.desc || item.name || 'Item / Service'}</td>
                        <td className="p-3 text-center text-slate-600">{item.unit || item.uom || 'PCS'}</td>
                        <td className="p-3 text-right font-mono font-bold">{qty}</td>
                        <td className="p-3 text-right font-mono">{formatSAR(unitSar)}</td>
                        <td className="p-3 text-right font-mono font-bold text-slate-900">
                          {formatSAR(qty * unitSar)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Totals & KSA 15% VAT */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-6">
            <div className="text-[11px] text-slate-500 max-w-md space-y-1">
              <div className="font-bold text-slate-700">Terms &amp; Conditions:</div>
              <p>1. Prices are quoted in Saudi Riyals (SAR) and subject to 15% KSA Value Added Tax (VAT).</p>
              <p>2. Please issue an official Purchase Order referencing <strong>{quoteNumber}</strong> to initiate mobilization.</p>
            </div>

            <div className="w-full sm:w-80 border border-slate-200 rounded-xl overflow-hidden text-xs">
              <div className="flex justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                <span className="text-slate-600">Subtotal (Excl. VAT):</span>
                <span className="font-mono font-bold">SAR {formatSAR(subtotalSar)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5 border-b border-slate-200">
                <span className="text-slate-600">KSA VAT (15%):</span>
                <span className="font-mono font-semibold">SAR {formatSAR(vatSar)}</span>
              </div>
              <div className="flex justify-between px-4 py-3 bg-slate-900 text-white font-bold text-sm">
                <span>Grand Total (SAR):</span>
                <span className="font-mono text-emerald-400">SAR {formatSAR(grandTotalSar)}</span>
              </div>
            </div>
          </div>

          {/* Sign-Off Block */}
          <div className="grid grid-cols-2 gap-8 pt-8 border-t border-slate-200 text-center text-[11px] text-slate-600">
            <div>
              <div className="border-b border-dashed border-slate-400 h-8 mb-1.5" />
              <div className="font-bold text-slate-800">Authorized Signatory — {company?.nameEn}</div>
            </div>
            <div>
              <div className="border-b border-dashed border-slate-400 h-8 mb-1.5" />
              <div className="font-bold text-slate-800">Customer Acceptance &amp; Official Stamp</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DeliveryNotePreviewModal({ company, customers = [], dn, onClose }) {
  if (!dn) return null;

  const matchedCustomer = customers.find(
    (c) =>
      String(c.name_en || c.name || '')
        .trim()
        .toLowerCase() === String(dn.client_name || '').trim().toLowerCase()
  );

  const items = Array.isArray(dn.items) ? dn.items : [];
  const totalUnits = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);

  const dispatchDate = dn.dispatched_at || dn.created_at
    ? new Date(dn.dispatched_at || dn.created_at).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : new Date().toLocaleDateString('en-GB');

  return (
    <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto">
        {/* Interactive Action Header (Hidden during A4 Print) */}
        <div className="no-print bg-slate-900 text-white px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold">
            <Truck className="w-4 h-4 text-emerald-400" />
            <span>Delivery Note A4 Print Preview — {dn.dn_number}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ShareDocumentButtons
              company={company}
              customers={customers}
              docType="Delivery Note"
              docNumber={dn.dn_number}
              clientName={dn.client_name}
              division={dn.division}
              status={dn.status || 'Dispatched'}
            />
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition"
            >
              <Printer className="w-4 h-4" />
              <span>Print / Save A4 PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close Preview"
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable A4 Delivery Note Document Body */}
        <div className="p-6 sm:p-8 space-y-6 text-xs text-slate-800 bg-white">
          <div className="flex flex-wrap justify-between items-start gap-4 border-b-2 border-slate-900 pb-5">
            <div>
              {company?.logoUrl && (
                <img src={company.logoUrl} alt="Company Logo" className="h-14 max-w-[180px] object-contain mb-2" />
              )}
              <div className="text-lg font-extrabold text-slate-900">{company?.nameEn || 'KSA MEP & IT Trading Co.'}</div>
              <div className="text-sm font-bold text-blue-800 mt-0.5">
                {company?.nameAr || 'شركة التجارة والمقاولات الكهروميكانيكية وتقنية المعلومات'}
              </div>
              <div className="text-[11px] text-slate-600 mt-1.5 space-y-0.5">
                <div>{company?.address || 'Jeddah, Kingdom of Saudi Arabia'}</div>
                <div className="font-mono">
                  VAT TIN: <strong>{company?.vatNumber || '300000000000003'}</strong> • CR:{' '}
                  <strong>{company?.crNumber || '4030000000'}</strong>
                </div>
              </div>
            </div>

            <div className="text-left sm:text-right">
              <div className="inline-block px-3 py-1 rounded bg-emerald-800 text-white font-extrabold text-sm tracking-wide uppercase">
                DELIVERY NOTE • إشعار تسليم بضاعة
              </div>
              <div className="mt-2 space-y-1 font-mono text-xs">
                <div>
                  <span className="text-slate-500 font-sans">Delivery Note #: </span>
                  <strong className="text-sm text-emerald-800">{dn.dn_number}</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-sans">Sales Order Ref: </span>
                  <strong>{dn.so_number || '—'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-sans">Dispatch Date: </span>
                  <strong>{dispatchDate}</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-sans">Division: </span>
                  <strong>{dn.division || 'MEP'}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Deliver To & Logistics Info */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Deliver To (Consignee) • بيانات المستلم
              </div>
              <div className="text-sm font-bold text-slate-900 pt-0.5">{dn.client_name}</div>
              {matchedCustomer?.name_ar && <div className="text-xs text-slate-600">{matchedCustomer.name_ar}</div>}
              {(dn.delivery_address || matchedCustomer?.address || matchedCustomer?.city) && (
                <div className="text-[11px] text-slate-600">
                  {dn.delivery_address || [matchedCustomer?.address, matchedCustomer?.city].filter(Boolean).join(', ')}
                </div>
              )}
              {(matchedCustomer?.phone || matchedCustomer?.whatsapp) && (
                <div className="text-[11px] text-slate-600">
                  Contact Tel: {matchedCustomer.phone || matchedCustomer.whatsapp}
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Dispatch &amp; Warehouse Details • بيانات الشحن والمستودع
              </div>
              <div className="font-bold text-slate-900 pt-0.5">Origin: Jeddah Main Warehouse</div>
              <div className="text-[11px] text-slate-600">
                Total Dispatched Units: <strong>{totalUnits}</strong> ({items.length} Line Items)
              </div>
              {dn.driver_name && (
                <div className="text-[11px] text-slate-600">
                  Driver / Carrier: <strong>{dn.driver_name}</strong>
                </div>
              )}
              {dn.notes && (
                <div className="text-[11px] text-slate-600">
                  Delivery Notes: <em>{dn.notes}</em>
                </div>
              )}
            </div>
          </div>

          {/* Dispatched Items Table (Quantities Only — No Pricing) */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-white">
                <tr>
                  <th className="p-3 w-12">#</th>
                  <th className="p-3">Item Description &amp; Specifications • وصف الصنف</th>
                  <th className="p-3 text-center w-24">UOM</th>
                  <th className="p-3 text-right w-32">Dispatched Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-slate-500">
                      Consolidated Shipment ({dn.dn_number})
                    </td>
                  </tr>
                ) : (
                  items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="p-3 font-mono text-slate-500">{idx + 1}</td>
                      <td className="p-3 font-semibold text-slate-900">{item.desc || item.name || 'Dispatched Material'}</td>
                      <td className="p-3 text-center text-slate-600">{item.unit || item.uom || 'PCS'}</td>
                      <td className="p-3 text-right font-mono font-bold text-sm text-slate-900">{item.qty}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
            <strong>Receiver Declaration:</strong> Received the above listed items in good order and condition. Any discrepancies or transit damages must be noted on this Delivery Note upon receipt.
          </div>

          {/* 3-Column Logistics Sign-Off Footer */}
          <div className="grid grid-cols-3 gap-6 pt-8 border-t border-slate-200 text-center text-[11px] text-slate-600">
            <div>
              <div className="border-b border-dashed border-slate-400 h-8 mb-1.5" />
              <div className="font-bold text-slate-800">Prepared &amp; Dispatched By</div>
              <div className="text-[10px] text-slate-400">Warehouse / Logistics</div>
            </div>
            <div>
              <div className="border-b border-dashed border-slate-400 h-8 mb-1.5" />
              <div className="font-bold text-slate-800">Driver / Courier Signature</div>
              <div className="text-[10px] text-slate-400">Name / Iqama / Plate #</div>
            </div>
            <div>
              <div className="border-b border-dashed border-slate-400 h-8 mb-1.5" />
              <div className="font-bold text-slate-800">Received By (Client Stamp)</div>
              <div className="text-[10px] text-slate-400">Name, Date &amp; Official Stamp</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}