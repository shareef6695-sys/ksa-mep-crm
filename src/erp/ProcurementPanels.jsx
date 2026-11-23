import React, { useMemo, useState } from 'react';
import { Trash2, X, AlertTriangle } from 'lucide-react';
import { formatSAR } from './erpEngine';

// Procurement cycle UI (migration 0012): PO line grid, goods receipt and supplier bill dialogs, requisitions,
// and the GRN / bill document lists. All postings go through database functions.
const num = (v) => Number(v) || 0;
const r2 = (v) => Math.round(num(v) * 100 + Number.EPSILON) / 100;
const qty = (v) => num(v).toLocaleString('en-SA', { maximumFractionDigits: 4 });
const listSerials = (txt) => String(txt || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

export const PO_STATUS_LABEL = {
  pending_approval: 'Awaiting approval', po_issued: 'Issued', partially_received: 'Partly received', grn_completed: 'Received',
  partially_billed: 'Partly billed', billed: 'Billed', paid: 'Paid', closed: 'Closed', cancelled: 'Cancelled',
};
export const openToReceive = (po) => !['pending_approval', 'cancelled', 'closed', 'paid'].includes(po.status)
  && (po.items || []).some((l) => num(l.qty) - num(l.receivedQty) - num(l.closedQty) > 0.0001);
export const openToBill = (po) => !['pending_approval', 'cancelled'].includes(po.status)
  && (po.items || []).some((l) => num(l.receivedQty) - num(l.billedQty) > 0.0001);

export const emptyPoLine = () => ({ itemId: '', desc: '', qty: 1, uom: 'PCS', unitCostFx: '', vatCategory: 'S', stocked: false, soLineId: '' });

export function PurchaseLinesEditor({ lines, setLines, items, currency, fxRate, soLines = [] }) {
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const set = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickItem = (i, id) => {
    const it = byId[id];
    if (!it) return set(i, { itemId: '', stocked: false });
    return set(i, { itemId: it.id, desc: lines[i].desc || it.name_en, uom: it.uom || 'PCS', stocked: !!it.is_stocked_item,
      vatCategory: it.zatca_vat_type || 'S', unitCostFx: lines[i].unitCostFx || (it.purchase_currency === currency ? num(it.purchase_price) : '') });
  };
  const goodsFx = lines.reduce((t, l) => t + num(l.qty) * num(l.unitCostFx), 0);
  return (
    <div className="space-y-2">
      <div className="hidden sm:grid grid-cols-12 gap-1.5 text-[10px] font-semibold text-slate-500 px-1">
        <span className="col-span-3">Item</span><span className="col-span-3">Description</span><span>Qty</span><span>UoM</span><span className="col-span-2">Unit cost ({currency})</span><span>VAT</span><span />
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-12 gap-1.5 items-center bg-slate-50 sm:bg-transparent rounded-lg p-1.5 sm:p-0">
          <select value={l.itemId} onChange={(e) => pickItem(i, e.target.value)} className="col-span-12 sm:col-span-3 border border-slate-300 rounded-lg px-1.5 py-1.5 bg-white">
            <option value="">— free text / service —</option>
            {items.map((it) => <option key={it.id} value={it.id}>{it.item_code ? `${it.item_code} ` : ''}{it.name_en}{it.is_stocked_item ? ' (stock)' : ''}</option>)}
          </select>
          <input required value={l.desc} onChange={(e) => set(i, { desc: e.target.value })} placeholder="Description *" className="col-span-12 sm:col-span-3 border border-slate-300 rounded-lg px-1.5 py-1.5" />
          <input required type="number" min="0.0001" step="any" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} className="col-span-3 sm:col-span-1 border border-slate-300 rounded-lg px-1.5 py-1.5" />
          <input value={l.uom} onChange={(e) => set(i, { uom: e.target.value })} className="col-span-2 sm:col-span-1 border border-slate-300 rounded-lg px-1.5 py-1.5" />
          <input required type="number" min="0" step="any" value={l.unitCostFx} onChange={(e) => set(i, { unitCostFx: e.target.value })} placeholder="0.00" className="col-span-4 sm:col-span-2 border border-slate-300 rounded-lg px-1.5 py-1.5" />
          <select value={l.vatCategory} onChange={(e) => set(i, { vatCategory: e.target.value })} className="col-span-2 sm:col-span-1 border border-slate-300 rounded-lg px-1 py-1.5 bg-white">
            <option value="S">15%</option><option value="Z">Zero</option><option value="E">Exempt</option><option value="O">Out</option>
          </select>
          <button type="button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="col-span-1 p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
          {(soLines.length > 0 || l.stocked) && (
            <div className="col-span-12 flex flex-wrap gap-3 text-[11px] text-slate-600 ps-1">
              {l.stocked && <span className="text-emerald-700 font-semibold">Stocked item: goes into stock on goods receipt</span>}
              {soLines.length > 0 && (
                <label className="flex items-center gap-1">For SO line:
                  <select value={l.soLineId} onChange={(e) => set(i, { soLineId: e.target.value })} className="border border-slate-300 rounded px-1 py-0.5 bg-white">
                    <option value="">—</option>
                    {soLines.map((s) => <option key={s.id} value={s.id}>{s.desc}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>
      ))}
      <div className="flex justify-between items-center">
        <button type="button" onClick={() => setLines([...lines, emptyPoLine()])} className="text-blue-700 font-semibold">+ Add line</button>
        <span className="font-semibold">Goods: {currency} {formatSAR(goodsFx)} (SAR {formatSAR(goodsFx * num(fxRate || 1))})</span>
      </div>
    </div>
  );
}

// Goods receipt: quantity per line (partial receipts), warehouse, serial numbers
export function GoodsReceiptModal({ po, itemsById, warehouses, onPost, onClose }) {
  const lines = (po.items || []).filter((l) => num(l.qty) - num(l.receivedQty) - num(l.closedQty) > 0.0001);
  const [wh, setWh] = useState((warehouses.find((w) => w.is_default) || warehouses[0] || {}).code || '');
  const [qtys, setQtys] = useState(Object.fromEntries(lines.map((l) => [l.line, num(l.qty) - num(l.receivedQty) - num(l.closedQty)])));
  const [serials, setSerials] = useState({});
  const [notes, setNotes] = useState('');
  const submit = (e) => {
    e.preventDefault();
    onPost({
      p_po_id: po.id, p_warehouse: wh || null, p_notes: notes || null,
      p_qtys: Object.fromEntries(Object.entries(qtys).map(([k, v]) => [k, num(v)])),
      p_serials: Object.fromEntries(Object.entries(serials).map(([k, v]) => [k, listSerials(v)])),
    });
  };
  return (
    <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form onSubmit={submit} className="bg-white rounded-t-3xl sm:rounded-2xl max-w-xl w-full p-5 space-y-3 text-xs max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="font-bold text-base">Goods Receipt — {po.po_number} ({po.supplier_name})</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        {warehouses.length > 0 && (
          <select value={wh} onChange={(e) => setWh(e.target.value)} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white">
            {warehouses.map((w) => <option key={w.code} value={w.code}>Receive into {w.code} — {w.name_en}</option>)}
          </select>
        )}
        {lines.map((l) => {
          const open = num(l.qty) - num(l.receivedQty) - num(l.closedQty);
          const m = l.is_stocked_item ? itemsById[l.itemId] : null;
          return (
            <div key={l.line} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-bold">{l.line}. {l.desc}</div>
                  <div className="text-slate-500">Ordered {qty(l.qty)} {l.uom} • received {qty(l.receivedQty)} • open {qty(open)}{m ? '' : ' • non-stock'}</div>
                </div>
                <input type="number" min="0" max={open} step="any" value={qtys[l.line]} onChange={(e) => setQtys({ ...qtys, [l.line]: e.target.value })}
                  className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-right font-bold bg-white" />
              </div>
              {m?.is_serialized && num(qtys[l.line]) > 0 && (
                <textarea required rows={2} value={serials[l.line] || ''} onChange={(e) => setSerials({ ...serials, [l.line]: e.target.value })}
                  placeholder={`${qty(qtys[l.line])} serial numbers, one per line`} className="w-full border border-amber-300 bg-amber-50 rounded-lg px-2 py-1.5 font-mono" />
              )}
            </div>
          );
        })}
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery note / waybill / remarks" className="w-full border border-slate-300 rounded-xl px-3 py-2" />
        <button type="submit" className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold cursor-pointer">Post Goods Receipt</button>
      </form>
    </div>
  );
}

// Supplier bill: supplier invoice, quantities and prices per line (3-way match), landed cost allocation
export function SupplierBillModal({ po, settings, onPost, onClose }) {
  const lines = (po.items || []).filter((l) => num(l.receivedQty) - num(l.billedQty) > 0.0001);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  const [form, setForm] = useState({
    supplierInvoiceNo: '', supplierInvoiceDate: today, landedCostSar: '', landedAllocation: 'value', notes: '',
    lines: Object.fromEntries(lines.map((l) => [l.line, { qty: num(l.receivedQty) - num(l.billedQty), unitCostFx: num(l.unitCostFx) }])),
  });
  const tol = num(settings?.priceTolerancePct ?? 2);
  const fx = num(po.fx_rate) || 1;
  const goodsSar = lines.reduce((t, l) => t + r2(num(form.lines[l.line]?.qty) * num(form.lines[l.line]?.unitCostFx) * fx), 0);
  const submit = (e) => {
    e.preventDefault();
    onPost({
      p_po_id: po.id,
      p: {
        supplierInvoiceNo: form.supplierInvoiceNo.trim(), supplierInvoiceDate: form.supplierInvoiceDate, notes: form.notes || null,
        landedAllocation: form.landedAllocation, ...(form.landedCostSar === '' ? {} : { landedCostSar: num(form.landedCostSar) }),
        lines: lines.map((l) => ({ line: l.line, qty: num(form.lines[l.line]?.qty), unitCostFx: num(form.lines[l.line]?.unitCostFx) })),
      },
    });
  };
  const setLine = (line, patch) => setForm({ ...form, lines: { ...form.lines, [line]: { ...form.lines[line], ...patch } } });
  return (
    <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form onSubmit={submit} className="bg-white rounded-t-3xl sm:rounded-2xl max-w-2xl w-full p-5 space-y-3 text-xs max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="font-bold text-base">Supplier Bill — {po.po_number} ({po.supplier_name})</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input required value={form.supplierInvoiceNo} onChange={(e) => setForm({ ...form, supplierInvoiceNo: e.target.value })} placeholder="Supplier invoice no. *" className="border border-slate-300 rounded-lg px-2 py-2" />
          <input required type="date" max={today} value={form.supplierInvoiceDate} onChange={(e) => setForm({ ...form, supplierInvoiceDate: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-2" />
        </div>
        <div className="text-slate-500">Due date follows the PO terms ({po.payment_terms || 'Net 30'}). Quantities can't exceed what was received and not yet billed.</div>
        {lines.map((l) => {
          const v = form.lines[l.line] || {};
          const open = num(l.receivedQty) - num(l.billedQty);
          const diff = num(l.unitCostFx) > 0 ? ((num(v.unitCostFx) - num(l.unitCostFx)) / num(l.unitCostFx)) * 100 : 0;
          return (
            <div key={l.line} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-12 gap-2 items-center">
              <div className="col-span-12 sm:col-span-6"><div className="font-bold">{l.line}. {l.desc}</div><div className="text-slate-500">Received {qty(l.receivedQty)} • billed {qty(l.billedQty)} • PO price {po.currency} {formatSAR(l.unitCostFx)}</div></div>
              <input type="number" min="0" max={open} step="any" value={v.qty} onChange={(e) => setLine(l.line, { qty: e.target.value })} title="Quantity billed" className="col-span-4 sm:col-span-2 border border-slate-300 rounded-lg px-2 py-1.5 text-right" />
              <input type="number" min="0" step="any" value={v.unitCostFx} onChange={(e) => setLine(l.line, { unitCostFx: e.target.value })} title={`Unit price (${po.currency})`} className="col-span-5 sm:col-span-3 border border-slate-300 rounded-lg px-2 py-1.5 text-right" />
              <div className="col-span-3 sm:col-span-1 text-right">{Math.abs(diff) > tol && <span className="text-amber-700 font-bold" title={`More than ${tol}% from the PO price`}><AlertTriangle className="w-4 h-4 inline" /> {diff.toFixed(1)}%</span>}</div>
            </div>
          );
        })}
        <div className="grid grid-cols-2 gap-2">
          <input type="number" min="0" step="any" value={form.landedCostSar} onChange={(e) => setForm({ ...form, landedCostSar: e.target.value })}
            placeholder={`Freight / customs on this bill, SAR (default: PO estimate left ${formatSAR(po.landed_cost_sar)})`} className="border border-slate-300 rounded-lg px-2 py-2" />
          <select value={form.landedAllocation} onChange={(e) => setForm({ ...form, landedAllocation: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-2 bg-white">
            <option value="value">Allocate landed cost by value</option><option value="qty">Allocate landed cost by quantity</option>
          </select>
        </div>
        <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" className="w-full border border-slate-300 rounded-lg px-2 py-2" />
        <div className="bg-slate-50 rounded-xl p-2.5 font-semibold">Goods SAR {formatSAR(goodsSar)} + landed cost; VAT is calculated per line by the system.</div>
        <button type="submit" className="w-full py-2.5 rounded-xl bg-purple-600 text-white font-semibold cursor-pointer">Post Supplier Bill</button>
      </form>
    </div>
  );
}

export function RequisitionsView({ requisitions = [], salesOrders = [], canCreate, canOrder, onCreateFromSo, onCancel, onOrder }) {
  const [soId, setSoId] = useState('');
  const openSos = salesOrders.filter((s) => !['delivered', 'cancelled', 'invoiced'].includes(s.status));
  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">Purchase Requisitions</h2>
          <p className="text-slate-500">What a sales order still needs: open quantities not covered by stock, open POs or other requisitions.</p>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <select value={soId} onChange={(e) => setSoId(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-2 bg-white">
              <option value="">Sales order…</option>
              {openSos.map((s) => <option key={s.id} value={s.id}>{s.so_number} — {s.client_name}</option>)}
            </select>
            <button type="button" disabled={!soId} onClick={() => onCreateFromSo(soId)} className="px-3 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer disabled:bg-slate-300">Raise requisition</button>
          </div>
        )}
      </div>
      {requisitions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">No requisitions yet.</div>
      ) : (
        <div className="grid gap-3">
          {requisitions.map((r) => (
            <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{r.pr_number}</span>
                {r.so_number && <span className="bg-slate-100 px-2 py-0.5 rounded">For {r.so_number}</span>}
                <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${r.status === 'open' ? 'bg-amber-100 text-amber-800' : r.status === 'ordered' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>{r.status}</span>
                <span className="text-slate-500">{r.requested_by} • {new Date(r.created_at).toLocaleDateString()}</span>
                <div className="ms-auto flex gap-2">
                  {r.status === 'open' && canOrder && <button type="button" onClick={() => onOrder(r)} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold cursor-pointer">Create PO</button>}
                  {r.status === 'open' && canCreate && <button type="button" onClick={() => onCancel(r)} className="px-3 py-1.5 rounded-lg border border-slate-300 cursor-pointer">Cancel</button>}
                </div>
              </div>
              <div className="text-slate-600">{(r.lines || []).map((l) => `${l.desc}: ${qty(l.qty)} ${l.uom || ''}${l.stocked ? ' (stock)' : ''}`).join(' • ')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PurchaseDocsList({ kind, docs = [] }) {
  if (!docs.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="font-bold text-sm text-slate-800">{kind === 'grn' ? 'Goods receipt documents' : 'Supplier bill documents'}</h3>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto text-xs">
        <table className="w-full">
          <thead className="bg-slate-50 text-slate-500 text-left">
            {kind === 'grn'
              ? <tr><th className="p-2.5">GRN</th><th className="p-2.5">PO</th><th className="p-2.5">Supplier</th><th className="p-2.5">Date</th><th className="p-2.5">Warehouse</th><th className="p-2.5">Lines</th><th className="p-2.5 text-right">Stock value</th></tr>
              : <tr><th className="p-2.5">Bill</th><th className="p-2.5">Supplier invoice</th><th className="p-2.5">PO</th><th className="p-2.5">Supplier</th><th className="p-2.5">Date / due</th><th className="p-2.5 text-right">Total SAR</th><th className="p-2.5">Checks</th></tr>}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {docs.map((d) => kind === 'grn' ? (
              <tr key={d.id}><td className="p-2.5 font-mono font-bold">{d.grn_number}</td><td className="p-2.5">{d.po_number}</td><td className="p-2.5">{d.supplier_name}</td><td className="p-2.5">{d.receipt_date}</td><td className="p-2.5">{d.warehouse}</td>
                <td className="p-2.5">{(d.lines || []).map((l) => `${l.desc} × ${qty(l.qty)}`).join(', ')}</td><td className="p-2.5 text-right">{formatSAR(d.value_sar)}</td></tr>
            ) : (
              <tr key={d.id}><td className="p-2.5 font-mono font-bold">{d.bill_number}{d.legacy ? ' (pre-0012)' : ''}</td><td className="p-2.5">{d.supplier_invoice_no || '—'}</td><td className="p-2.5">{d.po_number}</td><td className="p-2.5">{d.supplier_name}</td>
                <td className="p-2.5">{d.bill_date} / {d.due_date || '—'}</td><td className="p-2.5 text-right font-semibold">{formatSAR(d.total_sar)}</td>
                <td className="p-2.5">{(d.warnings || []).length ? <span className="text-amber-700" title={d.warnings.join('\n')}><AlertTriangle className="w-4 h-4 inline" /> {d.warnings.length} variance</span> : <span className="text-emerald-700">matched</span>}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
