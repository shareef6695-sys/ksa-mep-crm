import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, RefreshCw, Plus, X, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatSAR } from './erpEngine';
import { downloadCsvFile } from './csvExport';

// Inventory (migration 0011): stock on hand by warehouse at moving-average cost, the stock ledger, stock documents
// (opening, adjustment, count, transfer), serial numbers, and the valuation check against GL 1200.
// Every posting goes through a database function; this screen never writes stock rows itself.
const DOC_LABEL = { OPENING: 'Opening stock', ADJUST: 'Adjustment', COUNT: 'Stock count', TRANSFER: 'Transfer' };
const MOVE_LABEL = { OPENING: 'Opening', GRN: 'Goods receipt', DN: 'Delivery', CN_RETURN: 'Customer return', ADJUST: 'Adjustment', COUNT: 'Count', TRANSFER: 'Transfer' };
const num = (v) => Number(v) || 0;
const qtyFmt = (v) => num(v).toLocaleString('en-SA', { maximumFractionDigits: 4 });

function LineEditor({ kind, lines, setLines, stockedItems }) {
  const withCost = kind === 'OPENING' || kind === 'ADJUST';
  const counted = kind === 'COUNT';
  const byId = Object.fromEntries(stockedItems.map((i) => [i.id, i]));
  return (
    <div className="space-y-2">
      {lines.map((l, i) => {
        const it = byId[l.itemId];
        const set = (patch) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={i} className="grid grid-cols-12 gap-2 items-start">
            <select required value={l.itemId} onChange={(e) => set({ itemId: e.target.value })} className="col-span-12 sm:col-span-5 border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
              <option value="">Item…</option>
              {stockedItems.map((s) => <option key={s.id} value={s.id}>{s.item_code ? `${s.item_code} — ` : ''}{s.name_en}</option>)}
            </select>
            <input required type="number" step="any" value={l.qty} onChange={(e) => set({ qty: e.target.value })}
              placeholder={counted ? 'Counted qty' : kind === 'ADJUST' ? '+ found / - lost' : 'Qty'}
              className="col-span-4 sm:col-span-2 border border-slate-300 rounded-lg px-2 py-1.5" />
            {withCost ? (
              <input type="number" step="any" min="0" value={l.unitCost} onChange={(e) => set({ unitCost: e.target.value })}
                required={kind === 'OPENING'} placeholder={kind === 'OPENING' ? 'Unit cost SAR *' : 'Unit cost (for +)'}
                className="col-span-7 sm:col-span-3 border border-slate-300 rounded-lg px-2 py-1.5" />
            ) : <span className="col-span-7 sm:col-span-3" />}
            <button type="button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="col-span-1 p-1.5 text-slate-400 hover:text-rose-600 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
            {it?.is_serialized && (kind === 'OPENING' || kind === 'TRANSFER') && (
              <textarea value={l.serials || ''} onChange={(e) => set({ serials: e.target.value })} rows={2}
                placeholder={`Serial numbers of ${it.name_en}, one per line (${qtyFmt(l.qty)} needed)`}
                className="col-span-12 border border-amber-300 bg-amber-50 rounded-lg px-2 py-1.5 font-mono" />
            )}
          </div>
        );
      })}
      <button type="button" onClick={() => setLines([...lines, { itemId: '', qty: '', unitCost: '', serials: '' }])} className="text-blue-700 font-semibold">+ Add line</button>
    </div>
  );
}

export function InventoryStockView({ supabase, items = [], warehouses = [], canViewCost = false, can = () => false, onRefresh }) {
  const [tab, setTab] = useState('onhand');
  const [stock, setStock] = useState([]);
  const [moves, setMoves] = useState([]);
  const [docs, setDocs] = useState([]);
  const [serials, setSerials] = useState([]);
  const [recon, setRecon] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // {kind, warehouse, to, reason, lines}
  const [whFilter, setWhFilter] = useState('');
  const [search, setSearch] = useState('');
  const [newWh, setNewWh] = useState({ code: '', name_en: '', city: '' });
  const [itemEdits, setItemEdits] = useState({});

  const stockedItems = useMemo(() => items.filter((i) => i.is_stocked_item), [items]);
  const defaultWh = (warehouses.find((w) => w.is_default) || warehouses[0] || {}).code || 'MAIN';

  const load = useCallback(async () => {
    setError('');
    const res = await Promise.all([
      supabase.from('item_stock_v').select('*').order('name_en').limit(5000),
      canViewCost ? supabase.from('stock_moves').select('*').order('id', { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
      canViewCost ? supabase.from('stock_documents').select('*').order('created_at', { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
      supabase.from('item_serials').select('*').order('updated_at', { ascending: false }).limit(1000),
      canViewCost ? supabase.rpc('inventory_reconciliation') : Promise.resolve({ data: null }),
    ]);
    const missing = res.find((r) => r.error && /does not exist|PGRST20[25]|schema cache/i.test(`${r.error.code} ${r.error.message}`));
    if (missing) {
      setError('Inventory needs database update 0011_inventory.sql. Ask your administrator to run it.');
      return;
    }
    const err = res.find((r) => r.error);
    if (err) setError(err.error.message);
    setStock(res[0].data || []);
    setMoves(res[1].data || []);
    setDocs(res[2].data || []);
    setSerials(res[3].data || []);
    setRecon(Array.isArray(res[4].data) ? res[4].data[0] : res[4].data);
  }, [supabase, canViewCost]);

  useEffect(() => {
    load();
  }, [load]);

  const itemName = (id) => (items.find((i) => i.id === id) || {}).name_en || id;
  const rows = stock.filter((s) => (!whFilter || s.warehouse === whFilter) && (!search || `${s.name_en} ${s.item_code}`.toLowerCase().includes(search.toLowerCase())));
  const totalValue = rows.reduce((t, r) => t + num(r.value_sar), 0);
  const low = useMemo(() => {
    const byItem = {};
    stock.forEach((s) => { byItem[s.item_id] = (byItem[s.item_id] || 0) + num(s.qty); });
    return stockedItems.filter((i) => num(i.reorder_level) > 0 && (byItem[i.id] || 0) <= num(i.reorder_level));
  }, [stock, stockedItems]);
  const negatives = stock.filter((s) => num(s.qty) < 0);

  const openModal = (kind) => setModal({ kind, warehouse: defaultWh, to: '', reason: '', lines: [{ itemId: '', qty: '', unitCost: '', serials: '' }] });

  const post = async (e) => {
    e.preventDefault();
    const m = modal;
    const lines = m.lines.filter((l) => l.itemId);
    const serialList = (s) => String(s || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
    let call;
    if (m.kind === 'OPENING') call = supabase.rpc('post_opening_stock', { p_warehouse: m.warehouse, p_notes: m.reason || null, p_lines: lines.map((l) => ({ itemId: l.itemId, qty: num(l.qty), unitCost: num(l.unitCost), serials: serialList(l.serials) })) });
    if (m.kind === 'ADJUST') call = supabase.rpc('post_stock_adjustment', { p_warehouse: m.warehouse, p_reason: m.reason, p_lines: lines.map((l) => ({ itemId: l.itemId, qty: num(l.qty), unitCost: l.unitCost === '' ? null : num(l.unitCost) })) });
    if (m.kind === 'COUNT') call = supabase.rpc('post_stock_count', { p_warehouse: m.warehouse, p_notes: m.reason || null, p_counts: lines.map((l) => ({ itemId: l.itemId, countedQty: num(l.qty) })) });
    if (m.kind === 'TRANSFER') call = supabase.rpc('post_stock_transfer', { p_from: m.warehouse, p_to: m.to, p_notes: m.reason || null, p_lines: lines.map((l) => ({ itemId: l.itemId, qty: num(l.qty), serials: serialList(l.serials) })) });
    setBusy(true);
    const { data, error: err } = await call;
    setBusy(false);
    if (err) {
      window.alert(err.message);
      return;
    }
    setModal(null);
    const s = data?.summary || {};
    window.alert(m.kind === 'OPENING'
      ? `${data.doc_number}: opening stock SAR ${formatSAR(s.stock_value)}. GL 1200 adjusted by SAR ${formatSAR(s.to_1200)} (GRNI ${formatSAR(s.to_grni)}, retained earnings ${formatSAR(s.to_retained_earnings)}).`
      : `${data.doc_number} posted (SAR ${formatSAR(data.value_sar)}).`);
    await load();
    onRefresh?.();
  };

  const saveItemSettings = async (it) => {
    const e = itemEdits[it.id];
    if (!e) return;
    const { error: err } = await supabase.from('items').update({
      is_stocked_item: e.is_stocked_item ?? it.is_stocked_item,
      is_serialized: (e.is_stocked_item ?? it.is_stocked_item) ? (e.is_serialized ?? it.is_serialized) : false,
      reorder_level: num(e.reorder_level ?? it.reorder_level),
    }).eq('id', it.id);
    if (err) window.alert(err.message);
    else {
      setItemEdits({ ...itemEdits, [it.id]: undefined });
      onRefresh?.();
    }
  };

  const addWarehouse = async (e) => {
    e.preventDefault();
    const { error: err } = await supabase.from('warehouses').insert({ code: newWh.code.trim().toUpperCase(), name_en: newWh.name_en.trim(), city: newWh.city.trim() || null });
    if (err) window.alert(err.message);
    else {
      setNewWh({ code: '', name_en: '', city: '' });
      onRefresh?.();
    }
  };

  const TabBtn = ({ id, label }) => (
    <button type="button" onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${tab === id ? 'bg-slate-900 text-white' : 'bg-white border border-slate-300'}`}>{label}</button>
  );

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2"><Boxes className="w-5 h-5 text-slate-500" /> Inventory &amp; Warehouses</h2>
          <p className="text-slate-500">Stock on hand at moving-average cost. Goods receipts add stock, deliveries remove it, and every movement posts to GL 1200.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('stock.opening') && <button type="button" onClick={() => openModal('OPENING')} className="px-3 py-2 rounded-xl border border-slate-300 font-semibold cursor-pointer">Opening stock</button>}
          {can('stock.count') && <button type="button" onClick={() => openModal('COUNT')} className="px-3 py-2 rounded-xl border border-slate-300 font-semibold cursor-pointer">Stock count</button>}
          {can('stock.adjust') && <button type="button" onClick={() => openModal('ADJUST')} className="px-3 py-2 rounded-xl border border-slate-300 font-semibold cursor-pointer">Adjustment</button>}
          {can('stock.transfer') && warehouses.length > 1 && <button type="button" onClick={() => openModal('TRANSFER')} className="px-3 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">Transfer</button>}
          <button type="button" onClick={load} className="px-3 py-2 rounded-xl border border-slate-300 cursor-pointer"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3">{error}</div>}

      {recon && (
        <div className={`rounded-2xl border p-3 flex items-start gap-2 ${Math.abs(num(recon.difference_sar)) < 0.01 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
          {Math.abs(num(recon.difference_sar)) < 0.01 ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <div>
            Stock valuation SAR {formatSAR(recon.stock_value_sar)} • GL 1200 SAR {formatSAR(recon.gl_1200_sar)} • difference SAR {formatSAR(recon.difference_sar)} • goods received not invoiced (2150) SAR {formatSAR(recon.grni_open_sar)}
            {Math.abs(num(recon.difference_sar)) >= 0.01 && (
              <div className="mt-0.5">{moves.length === 0 ? 'No stock has been entered yet: count the warehouse and post Opening stock — the old GL 1200 balance is moved to retained earnings.' : 'GL 1200 has postings that are not stock movements (e.g. a manual journal). Investigate before closing the period.'}</div>
            )}
          </div>
        </div>
      )}
      {negatives.length > 0 && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3">Negative stock on {negatives.length} item/warehouse line(s): {negatives.slice(0, 5).map((n) => `${n.name_en} (${n.warehouse}: ${qtyFmt(n.qty)})`).join(', ')}. Receive or count them; the cost is corrected on receipt.</div>}
      {low.length > 0 && <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3">At or below reorder level: {low.slice(0, 8).map((i) => i.name_en).join(', ')}{low.length > 8 ? ` and ${low.length - 8} more` : ''}.</div>}

      <div className="flex flex-wrap gap-2">
        <TabBtn id="onhand" label="Stock on hand" />
        {canViewCost && <TabBtn id="moves" label="Movements" />}
        {canViewCost && <TabBtn id="docs" label="Stock documents" />}
        <TabBtn id="serials" label="Serial numbers" />
        {can('item.manage') && <TabBtn id="items" label="Item settings" />}
        <TabBtn id="wh" label="Warehouses" />
      </div>

      {tab === 'onhand' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <select value={whFilter} onChange={(e) => setWhFilter(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
              <option value="">All warehouses</option>
              {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code} — {w.name_en}</option>)}
            </select>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item" className="border border-slate-300 rounded-lg px-2 py-1.5" />
            {canViewCost && <span className="font-semibold">Value: SAR {formatSAR(totalValue)}</span>}
            <button type="button" onClick={() => downloadCsvFile('Stock_on_hand.csv', ['Item code', 'Item', 'Warehouse', 'Qty', 'UoM', ...(canViewCost ? ['Avg cost SAR', 'Value SAR'] : [])],
              rows.map((r) => [r.item_code, r.name_en, r.warehouse, r.qty, r.uom, ...(canViewCost ? [r.avg_cost, r.value_sar] : [])]))} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold cursor-pointer">CSV</button>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">Item</th><th className="p-2.5">Warehouse</th><th className="p-2.5 text-right">Qty</th>{canViewCost && <><th className="p-2.5 text-right">Avg cost</th><th className="p-2.5 text-right">Value SAR</th></>}<th className="p-2.5 text-right">Reorder at</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">No stock yet. Mark items as stocked (Item settings), then post Opening stock or receive goods.</td></tr>}
                {rows.map((r) => (
                  <tr key={`${r.item_id}-${r.warehouse}`} className={num(r.qty) < 0 ? 'bg-rose-50' : ''}>
                    <td className="p-2.5"><div className="font-semibold">{r.name_en}</div><div className="text-slate-400">{r.item_code}{r.is_serialized ? ' • serialised' : ''}</div></td>
                    <td className="p-2.5">{r.warehouse}</td>
                    <td className="p-2.5 text-right font-bold">{qtyFmt(r.qty)} {r.uom}</td>
                    {canViewCost && <><td className="p-2.5 text-right">{formatSAR(r.avg_cost)}</td><td className="p-2.5 text-right">{formatSAR(r.value_sar)}</td></>}
                    <td className="p-2.5 text-right text-slate-500">{num(r.reorder_level) > 0 ? qtyFmt(r.reorder_level) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'moves' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">Date</th><th className="p-2.5">Type</th><th className="p-2.5">Document</th><th className="p-2.5">Item</th><th className="p-2.5">Wh</th><th className="p-2.5 text-right">Qty</th><th className="p-2.5 text-right">Unit cost</th><th className="p-2.5 text-right">Value</th><th className="p-2.5 text-right">Balance</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {moves.map((m) => (
                <tr key={m.id} className={m.negative ? 'bg-rose-50' : ''}>
                  <td className="p-2.5">{m.move_date}</td><td className="p-2.5">{MOVE_LABEL[m.move_type] || m.move_type}</td><td className="p-2.5 font-mono">{m.source_doc_number}</td>
                  <td className="p-2.5">{itemName(m.item_id)}</td><td className="p-2.5">{m.warehouse}</td>
                  <td className={`p-2.5 text-right font-semibold ${num(m.qty) < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{num(m.qty) > 0 ? '+' : ''}{qtyFmt(m.qty)}</td>
                  <td className="p-2.5 text-right">{formatSAR(m.unit_cost_sar)}</td>
                  <td className="p-2.5 text-right">{formatSAR(m.value_sar)}{num(m.correction_sar) !== 0 && <div className="text-amber-700">corr. {formatSAR(-num(m.correction_sar))}</div>}</td>
                  <td className="p-2.5 text-right">{qtyFmt(m.qty_after)} @ {formatSAR(m.avg_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'docs' && (
        <div className="grid gap-2">
          {docs.length === 0 && <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-slate-500">No stock documents yet.</div>}
          {docs.map((d) => (
            <div key={d.id} className="bg-white border border-slate-200 rounded-2xl p-3">
              <div className="flex flex-wrap gap-2 items-center"><span className="font-mono font-bold">{d.doc_number}</span><span className="bg-slate-100 px-2 py-0.5 rounded font-semibold">{DOC_LABEL[d.doc_type]}</span><span>{d.warehouse}{d.to_warehouse ? ` → ${d.to_warehouse}` : ''}</span><span className="text-slate-500">{d.doc_date} • {d.posted_by}</span><span className="ms-auto font-semibold">SAR {formatSAR(d.value_sar)}</span></div>
              {d.reason && <div className="text-slate-600 mt-1">{d.reason}</div>}
              <div className="text-slate-500 mt-1">{(d.lines || []).map((l) => `${l.name || itemName(l.itemId)}: ${d.doc_type === 'COUNT' ? `${qtyFmt(l.systemQty)} → ${qtyFmt(l.countedQty)}` : qtyFmt(l.qty)}`).join(' • ')}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'serials' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">Serial</th><th className="p-2.5">Item</th><th className="p-2.5">Status</th><th className="p-2.5">Warehouse</th><th className="p-2.5">Received</th><th className="p-2.5">Delivered</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {serials.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">No serial numbers recorded. Mark an item “serialised” to capture serials on goods receipts and deliveries.</td></tr>}
              {serials.filter((s) => !search || `${s.serial} ${itemName(s.item_id)}`.toLowerCase().includes(search.toLowerCase())).map((s) => (
                <tr key={`${s.item_id}-${s.serial}`}><td className="p-2.5 font-mono font-bold">{s.serial}</td><td className="p-2.5">{itemName(s.item_id)}</td><td className="p-2.5">{s.status}</td><td className="p-2.5">{s.warehouse}</td><td className="p-2.5">{s.grn_number || ''} {s.received_at ? new Date(s.received_at).toLocaleDateString() : ''}</td><td className="p-2.5">{s.dn_number || ''} {s.delivered_at ? new Date(s.delivered_at).toLocaleDateString() : ''}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'items' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <p className="p-3 text-slate-500">Only stocked goods are counted, valued and relieved on delivery. Services and goods bought for one order and shipped by the supplier stay non-stock (their cost goes straight to cost of sales when billed).</p>
          <table className="w-full">
            <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">Item</th><th className="p-2.5">Stocked</th><th className="p-2.5">Serialised</th><th className="p-2.5">Reorder level</th><th className="p-2.5" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {items.filter((i) => (i.item_type || 'Goods') === 'Goods').map((i) => {
                const e = itemEdits[i.id] || {};
                const stocked = e.is_stocked_item ?? i.is_stocked_item;
                return (
                  <tr key={i.id}>
                    <td className="p-2.5"><div className="font-semibold">{i.name_en}</div><div className="text-slate-400">{i.item_code} • {i.uom}</div></td>
                    <td className="p-2.5"><input type="checkbox" checked={!!stocked} onChange={(ev) => setItemEdits({ ...itemEdits, [i.id]: { ...e, is_stocked_item: ev.target.checked } })} /></td>
                    <td className="p-2.5"><input type="checkbox" disabled={!stocked} checked={!!(e.is_serialized ?? i.is_serialized) && !!stocked} onChange={(ev) => setItemEdits({ ...itemEdits, [i.id]: { ...e, is_serialized: ev.target.checked } })} /></td>
                    <td className="p-2.5"><input type="number" min="0" step="any" disabled={!stocked} value={e.reorder_level ?? i.reorder_level ?? 0} onChange={(ev) => setItemEdits({ ...itemEdits, [i.id]: { ...e, reorder_level: ev.target.value } })} className="w-24 border border-slate-300 rounded-lg px-2 py-1" /></td>
                    <td className="p-2.5">{itemEdits[i.id] && <button type="button" onClick={() => saveItemSettings(i)} className="px-3 py-1 rounded-lg bg-blue-600 text-white font-semibold cursor-pointer">Save</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'wh' && (
        <div className="space-y-2">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2.5">Code</th><th className="p-2.5">Name</th><th className="p-2.5">City</th><th className="p-2.5">Default</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{warehouses.map((w) => <tr key={w.code}><td className="p-2.5 font-mono font-bold">{w.code}</td><td className="p-2.5">{w.name_en}</td><td className="p-2.5">{w.city}</td><td className="p-2.5">{w.is_default ? '●' : ''}</td></tr>)}</tbody>
            </table>
          </div>
          {can('warehouse.manage') && (
            <form onSubmit={addWarehouse} className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap gap-2 items-center">
              <input required pattern="[A-Za-z0-9_-]{2,20}" value={newWh.code} onChange={(e) => setNewWh({ ...newWh, code: e.target.value })} placeholder="Code (e.g. RUH)" className="border border-slate-300 rounded-lg px-2 py-1.5 font-mono w-32" />
              <input required value={newWh.name_en} onChange={(e) => setNewWh({ ...newWh, name_en: e.target.value })} placeholder="Name" className="border border-slate-300 rounded-lg px-2 py-1.5" />
              <input value={newWh.city} onChange={(e) => setNewWh({ ...newWh, city: e.target.value })} placeholder="City" className="border border-slate-300 rounded-lg px-2 py-1.5" />
              <button type="submit" className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold cursor-pointer flex items-center gap-1"><Plus className="w-4 h-4" /> Add warehouse</button>
            </form>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={post} className="bg-white rounded-t-3xl sm:rounded-2xl max-w-2xl w-full p-5 space-y-3 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">{DOC_LABEL[modal.kind]}</h3>
              <button type="button" onClick={() => setModal(null)}><X className="w-5 h-5" /></button>
            </div>
            {modal.kind === 'OPENING' && <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5 text-blue-900">For a warehouse with no movements yet. Enter what you counted and its cost. GL 1200 is set to the stock value; on the first opening, goods received but not yet billed move to GRNI (2150) and the rest of the old 1200 balance to retained earnings (3020).</div>}
            {modal.kind === 'COUNT' && <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">Enter the counted quantity. Differences from the system quantity are posted to 5020 Inventory adjustments at average cost.</div>}
            <div className="grid grid-cols-2 gap-2">
              <select value={modal.warehouse} onChange={(e) => setModal({ ...modal, warehouse: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-2 bg-white">
                {warehouses.map((w) => <option key={w.code} value={w.code}>{modal.kind === 'TRANSFER' ? 'From ' : ''}{w.code} — {w.name_en}</option>)}
              </select>
              {modal.kind === 'TRANSFER' ? (
                <select required value={modal.to} onChange={(e) => setModal({ ...modal, to: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-2 bg-white">
                  <option value="">To warehouse…</option>
                  {warehouses.filter((w) => w.code !== modal.warehouse).map((w) => <option key={w.code} value={w.code}>{w.code} — {w.name_en}</option>)}
                </select>
              ) : <span />}
            </div>
            <input required={modal.kind === 'ADJUST'} value={modal.reason} onChange={(e) => setModal({ ...modal, reason: e.target.value })} placeholder={modal.kind === 'ADJUST' ? 'Reason (damage, loss, found…) *' : 'Notes'} className="w-full border border-slate-300 rounded-lg px-2 py-2" />
            <LineEditor kind={modal.kind} lines={modal.lines} setLines={(lines) => setModal({ ...modal, lines })} stockedItems={stockedItems} />
            {stockedItems.length === 0 && <div className="text-amber-800">No item is marked as stocked yet — use the Item settings tab first.</div>}
            <button type="submit" disabled={busy} className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer disabled:bg-slate-300">{busy ? 'Posting…' : `Post ${DOC_LABEL[modal.kind].toLowerCase()}`}</button>
          </form>
        </div>
      )}
    </div>
  );
}
