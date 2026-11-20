import React from 'react';
import { Printer, X, FileText, Building2 } from 'lucide-react';
import { formatSAR } from './erpEngine';
import { SharePurchaseOrderButtons } from './shareDispatch';

export function PurchaseOrderPreviewModal({ company, suppliers = [], po, onClose }) {
  if (!po) return null;

  const matchedSupplier = suppliers.find(
    (s) =>
      String(s.name_en || s.name || s.supplier_name || '')
        .trim()
        .toLowerCase() === String(po.supplier_name || '').trim().toLowerCase()
  );

  const currency = po.currency || 'SAR';
  const fxRate = Number(po.fx_rate || 1);
  const items = Array.isArray(po.items) ? po.items : [];

  const computedFxSubtotal = items.reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitCostFx ?? it.unit_cost ?? 0)),
    0
  );
  const totalFx = Number(po.total_amount_fx || computedFxSubtotal || 0);
  const totalLandedSar = Number(po.total_landed_sar || totalFx * fxRate || 0);
  const inputVatSar = Number(
    po.input_vat_sar ?? (currency === 'SAR' && po.is_ksa_vat_recoverable !== false ? totalLandedSar * 0.15 : 0)
  );
  const grandTotalSar = Number((totalLandedSar + inputVatSar).toFixed(2));

  const issueDate = po.created_at
    ? new Date(po.created_at).toLocaleDateString('en-GB', {
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
            <span>Purchase Order A4 Print Preview — {po.po_number}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SharePurchaseOrderButtons company={company} suppliers={suppliers} po={po} compact={false} />
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

        {/* Printable A4 Purchase Order Document Body */}
        <div className="p-6 sm:p-8 space-y-6 text-xs text-slate-800 bg-white">
          {/* Corporate Letterhead */}
          <div className="flex flex-wrap justify-between items-start gap-4 border-b-2 border-slate-900 pb-5">
            <div>
              <div className="text-lg font-extrabold text-slate-900">{company?.nameEn || 'KSA MEP & IT Trading Co.'}</div>
              <div className="text-sm font-bold text-blue-800 mt-0.5">{company?.nameAr || 'شركة التجارة والمقاولات الكهروميكانيكية وتقنية المعلومات'}</div>
              <div className="text-[11px] text-slate-600 mt-1.5 space-y-0.5">
                <div>{company?.address || 'Jeddah, Kingdom of Saudi Arabia'}</div>
                <div className="font-mono">
                  VAT TIN: <strong>{company?.vatNumber || '300000000000003'}</strong> • CR: <strong>{company?.crNumber || '4030000000'}</strong>
                </div>
                {company?.phone && <div>Tel: {company.phone} {company?.email ? `• ${company.email}` : ''}</div>}
              </div>
            </div>

            <div className="text-left sm:text-right">
              <div className="inline-block px-3 py-1 rounded bg-slate-900 text-white font-extrabold text-sm tracking-wide uppercase">
                PURCHASE ORDER • أمر شراء
              </div>
              <div className="mt-2 space-y-1 font-mono text-xs">
                <div>
                  <span className="text-slate-500 font-sans">PO Number: </span>
                  <strong className="text-sm text-blue-800">{po.po_number}</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-sans">Issue Date: </span>
                  <strong>{issueDate}</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-sans">Currency / FX: </span>
                  <strong>{currency} {currency !== 'SAR' ? `(1 ${currency} = ${fxRate.toFixed(4)} SAR)` : '(Local SAR)'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-sans">Status: </span>
                  <strong className="uppercase">{po.status || 'ISSUED'}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Vendor / Supplier & Delivery Terms Grid */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-blue-700" /> Vendor / Supplier Details • بيانات المورد
              </div>
              <div className="text-sm font-bold text-slate-900 pt-0.5">{po.supplier_name}</div>
              {matchedSupplier?.name_ar && <div className="text-xs text-slate-600">{matchedSupplier.name_ar}</div>}
              {(matchedSupplier?.vat_number || matchedSupplier?.tax_id) && (
                <div className="font-mono text-[11px] text-slate-600">
                  Supplier VAT / Tax ID: {matchedSupplier.vat_number || matchedSupplier.tax_id}
                </div>
              )}
              {(matchedSupplier?.address || matchedSupplier?.country) && (
                <div className="text-[11px] text-slate-600">
                  {[matchedSupplier.address, matchedSupplier.city, matchedSupplier.country].filter(Boolean).join(', ')}
                </div>
              )}
              {(po.supplier_phone || matchedSupplier?.phone || matchedSupplier?.whatsapp || po.supplier_email || matchedSupplier?.email) && (
                <div className="text-[11px] text-slate-600 pt-0.5">
                  {po.supplier_phone || matchedSupplier?.phone || matchedSupplier?.whatsapp || ''}{' '}
                  {(po.supplier_email || matchedSupplier?.email) ? `• ${po.supplier_email || matchedSupplier?.email}` : ''}
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Ship-To &amp; Commercial Terms • شروط التسليم والدفع
              </div>
              <div className="font-bold text-slate-900 pt-0.5">Jeddah Main Warehouse (KSA)</div>
              <div className="text-[11px] text-slate-600">
                Linked Sales Order: <strong className="font-mono">{po.so_number || po.reference || 'Stock Replenishment'}</strong>
              </div>
              <div className="text-[11px] text-slate-600">
                Payment Terms: <strong>{po.payment_terms || matchedSupplier?.payment_terms || 'As per agreed supplier terms'}</strong>
              </div>
              {po.notes && (
                <div className="text-[11px] text-slate-600 pt-0.5">
                  Remarks: <em>{po.notes}</em>
                </div>
              )}
            </div>
          </div>

          {/* Line Items Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-white">
                <tr>
                  <th className="p-3 w-10">#</th>
                  <th className="p-3">Item Description • البيان</th>
                  <th className="p-3 text-center">UOM</th>
                  <th className="p-3 text-right">Qty</th>
                  <th className="p-3 text-right">Unit Price ({currency})</th>
                  <th className="p-3 text-right">Line Total ({currency})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-slate-500">
                      Consolidated Purchase Order ({po.po_number})
                    </td>
                  </tr>
                ) : (
                  items.map((item, idx) => {
                    const qty = Number(item.qty) || 0;
                    const unitFx = Number(item.unitCostFx ?? item.unit_cost ?? 0);
                    const lineTotalFx = qty * unitFx;
                    return (
                      <tr key={idx}>
                        <td className="p-3 font-mono text-slate-500">{idx + 1}</td>
                        <td className="p-3 font-semibold text-slate-900">{item.desc || item.name || 'Material / Equipment'}</td>
                        <td className="p-3 text-center text-slate-600">{item.unit || item.uom || 'PCS'}</td>
                        <td className="p-3 text-right font-mono font-bold">{qty}</td>
                        <td className="p-3 text-right font-mono">{formatSAR(unitFx)}</td>
                        <td className="p-3 text-right font-mono font-bold text-slate-900">{formatSAR(lineTotalFx)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Totals & KSA VAT / Landed SAR Summary */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-6">
            <div className="text-[11px] text-slate-500 max-w-md space-y-1">
              <div className="font-bold text-slate-700">Instructions to Supplier:</div>
              <p>1. Please quote Purchase Order number <strong>{po.po_number}</strong> on all delivery notes, packing lists, and commercial invoices.</p>
              <p>2. For KSA local suppliers, a ZATCA-compliant Tax Invoice displaying our VAT TIN ({company?.vatNumber}) is mandatory for payment release.</p>
            </div>

            <div className="w-full sm:w-80 border border-slate-200 rounded-xl overflow-hidden text-xs">
              <div className="flex justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                <span className="text-slate-600">PO Subtotal ({currency}):</span>
                <span className="font-mono font-bold">{currency} {formatSAR(totalFx)}</span>
              </div>
              {currency !== 'SAR' && (
                <div className="flex justify-between px-4 py-2.5 border-b border-slate-200">
                  <span className="text-slate-600">Landed Equivalent (@ {fxRate}):</span>
                  <span className="font-mono font-semibold">SAR {formatSAR(totalLandedSar)}</span>
                </div>
              )}
              <div className="flex justify-between px-4 py-2.5 border-b border-slate-200">
                <span className="text-slate-600">KSA Recoverable VAT (15%):</span>
                <span className="font-mono font-semibold">SAR {formatSAR(inputVatSar)}</span>
              </div>
              <div className="flex justify-between px-4 py-3 bg-slate-900 text-white font-bold text-sm">
                <span>Grand Total (SAR):</span>
                <span className="font-mono text-emerald-400">SAR {formatSAR(grandTotalSar)}</span>
              </div>
            </div>
          </div>

          {/* Authorized Signatories Footer */}
          <div className="grid grid-cols-3 gap-6 pt-8 border-t border-slate-200 text-center text-[11px] text-slate-600">
            <div>
              <div className="border-b border-dashed border-slate-400 h-8 mb-1.5" />
              <div className="font-bold text-slate-800">Prepared By (Procurement)</div>
            </div>
            <div>
              <div className="border-b border-dashed border-slate-400 h-8 mb-1.5" />
              <div className="font-bold text-slate-800">Finance &amp; Cost Verification</div>
            </div>
            <div>
              <div className="border-b border-dashed border-slate-400 h-8 mb-1.5" />
              <div className="font-bold text-slate-800">Authorized Approval &amp; Stamp</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}