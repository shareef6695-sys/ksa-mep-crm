// Purchase orders, receipts, bills, requisitions — handlers moved verbatim from App.jsx (Prompt 15). `s` is the store built so far.
import { emptyPoLine } from '../../erp/ProcurementPanels';
import { formatSAR } from '../../erp/erpEngine';


export function usePurchaseActions(s) {
  const { callPosting, fxRates, newPO, refreshAllErpData, selectSubModule, setBillModalPO, setGrnModalPO, setNewPO, setShowNewPOModal, vendors } = s;
  const handleSelectVendorForPO = (vendId) => {
    const v = vendors.find((x) => x.id === vendId);
    if (!v) {
      setNewPO({ ...newPO, vendorId: '' });
      return;
    }
    setNewPO({
      ...newPO,
      vendorId: v.id,
      supplierName: v.name_en,
      supplierVat: v.vat_number || '',
      currency: v.default_currency || 'SAR',
      fxRate: fxRates[v.default_currency] || 1,
    });
  };


  const handleCreatePO = async (e) => {
    e.preventDefault();
    const po = await callPosting('post_purchase_order', {
      p: {
        so_id: newPO.soId || null,
        supplier_name: newPO.supplierName,
        supplier_vat: newPO.supplierVat,
        vendor_id: newPO.vendorId || null,
        supply_type: newPO.supplyType || 'goods',
        project_id: newPO.projectId || null,
        cost_type: newPO.costType === 'subcontract' ? 'subcontract' : 'material',
        currency: newPO.currency,
        fx_rate: Number(newPO.fxRate) || 1,
        landed_cost_sar: Number(newPO.landedCostSar) || 0,
        pr_id: newPO.prId || null,
        payment_terms: newPO.paymentTerms || null,
        items: (newPO.lines || []).map((l) => ({
          itemId: l.itemId || null, desc: l.desc, qty: Number(l.qty) || 0, uom: l.uom, unitCostFx: Number(l.unitCostFx) || 0,
          vatCategory: l.vatCategory, is_stocked_item: !!(l.itemId && l.stocked), soLineId: l.soLineId || null,
        })),
      },
    });
    if (!po) return;
    if (po.status === 'pending_approval') alert(`${po.po_number} needs ${po.approval_level === 'ceo' ? 'CEO' : 'Sales Manager / CEO'} approval before it can be sent to the supplier.`);
    setNewPO((prev) => ({ ...prev, lines: [emptyPoLine()], prId: '', soId: '' }));
    setShowNewPOModal(false);
    selectSubModule('purchase', 'pur_orders');
    refreshAllErpData();
  };

  // Goods receipt (0012): quantities per line, warehouse, serials — one GRN document per receipt
  const handleRecordGoodsReceipt = (po) => setGrnModalPO({ po });
  const postGoodsReceipt = async (args) => {
    const grn = await callPosting('post_goods_receipt', args);
    if (!grn) return;
    setGrnModalPO(null);
    alert(`${grn.grn_number} posted${Number(grn.value_sar) ? ` — stock value SAR ${formatSAR(grn.value_sar)}` : ''}.`);
    refreshAllErpData();
  };
  const handleApprovePO = async (po) => {
    if (!(await callPosting('approve_purchase_order', { p_po_id: po.id }))) return;
    refreshAllErpData();
  };
  const handleRejectPO = async (po) => {
    const reason = window.prompt(`Reason for rejecting ${po.po_number}?`);
    if (!reason) return;
    if (!(await callPosting('reject_purchase_order', { p_po_id: po.id, p_reason: reason }))) return;
    refreshAllErpData();
  };
  const handleClosePO = async (po) => {
    const reason = window.prompt(`${po.po_number}: close the quantities still open (or cancel it if nothing was received). Reason?`);
    if (!reason) return;
    if (!(await callPosting('close_purchase_order', { p_po_id: po.id, p_reason: reason }))) return;
    refreshAllErpData();
  };
  const handleRaiseRequisition = async (soId) => {
    const pr = await callPosting('create_requisition_from_so', { p_so_id: soId });
    if (!pr) return;
    alert(`${pr.pr_number}: ${(pr.lines || []).map((l) => `${l.desc} × ${l.qty}`).join(', ')}`);
    selectSubModule('purchase', 'pur_requisitions');
    refreshAllErpData();
  };
  const handlePoFromRequisition = (pr) => {
    setNewPO((prev) => ({
      ...prev, soId: pr.so_id || '', prId: pr.id,
      lines: (pr.lines || []).map((l) => ({ ...emptyPoLine(), itemId: l.itemId || '', desc: l.desc, qty: l.qty, uom: l.uom || 'PCS',
        stocked: !!l.stocked, soLineId: l.soLineId || '', unitCostFx: prev.currency === 'SAR' ? Number(l.estUnitCostSar || 0) : '' })),
    }));
    setShowNewPOModal(true);
  };

  // Supplier bill: AP liability + recoverable input VAT, goods + landed cost into inventory (one transaction)
  // Supplier bill (0012): supplier invoice, 3-way match, variance warnings, landed cost allocation
  const handlePostSupplierBill = (po) => setBillModalPO(po);
  const postSupplierBill = async (args) => {
    const bill = await callPosting('post_supplier_bill', args);
    if (!bill) return;
    setBillModalPO(null);
    alert(`${bill.bill_number} posted: SAR ${formatSAR(bill.total_sar)}, due ${bill.due_date}.${(bill.warnings || []).length ? `\n\nVariances:\n${bill.warnings.join('\n')}` : ''}`);
    selectSubModule('purchase', 'pur_bills');
    refreshAllErpData();
  };


  return { handleApprovePO, handleClosePO, handleCreatePO, handlePoFromRequisition, handlePostSupplierBill, handleRaiseRequisition, handleRecordGoodsReceipt, handleRejectPO, handleSelectVendorForPO, postGoodsReceipt, postSupplierBill };
}
