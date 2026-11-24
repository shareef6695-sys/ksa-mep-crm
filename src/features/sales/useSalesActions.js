// Quotes, sales orders, deliveries, invoices, receipts — handlers moved verbatim from App.jsx (Prompt 15). `s` is the store built so far.
import { isMissingObject } from '../../lib/dbHelpers';
import { canEditQuotes } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { blocksSharing, callZatca, submitAfterPosting, zatcaStatus } from '../../lib/zatca';


export function useSalesActions(s) {
  const { callPosting, customers, deliveryModalSO, deliveryNotesText, deliveryQtys, deliverySerials, deliveryWarehouse, inquirySaveSeq, items, newInq, paymentAmount, paymentMethod, paymentModalInv, paymentRef, profile, refreshAllErpData, salesmenList, selectSubModule, setDeliveryModalSO, setDeliveryNotesText, setDeliveryQtys, setDeliverySerials, setInquiries, setNewInq, setPaymentAmount, setPaymentModalInv, setPaymentRef, setPreviewInvoice, setSelectedInqId, setShowNewInqModal, setZatcaBusyId, teamProfiles } = s;
  const handleSelectCustomerForInq = (custId) => {
    const c = customers.find((x) => x.id === custId);
    if (!c) {
      setNewInq({ ...newInq, customerId: '' });
      return;
    }
    setNewInq({
      ...newInq,
      customerId: c.id,
      clientName: c.name_en,
      clientVat: c.vat_number || '',
      contactPerson: c.contact_person,
      phone: c.phone,
      email: c.email || '',
      salesmanId: c.assigned_salesman_id || newInq.salesmanId,
    });
  };

  const handleSelectItemForInq = (itemId) => {
    const it = items.find((x) => x.id === itemId);
    if (!it) {
      setNewInq({ ...newInq, itemId: '' });
      return;
    }
    setNewInq({
      ...newInq,
      itemId: it.id,
      firstItemDesc: it.name_ar ? `${it.name_en} (${it.name_ar})` : it.name_en,
      firstItemUom: it.uom,
      firstItemCost: Number(it.purchase_price || 0),
      firstItemCurrency: it.purchase_currency || 'SAR',
    });
  };

  const handleCreateInquiry = async (e) => {
    e.preventDefault();
    const { data: seqInqId } = await supabase.rpc('next_master_code', { p_doc_type: 'INQUIRY' }); const chosenSalesman = teamProfiles.find((p) => p.id === newInq.salesmanId) || salesmenList[0]; const obj = { id: seqInqId, refNo: seqInqId,
      customerId: newInq.customerId || null,
      clientName: newInq.clientName,
      clientVat: newInq.clientVat,
      contactPerson: newInq.contactPerson,
      phone: newInq.phone,
      email: newInq.email,
      division: newInq.division,
      salesmanId: chosenSalesman?.id || null,
      assignedSalesName: chosenSalesman?.full_name || 'Unassigned',
      commissionPct: Number(chosenSalesman?.commission_pct || 0),
      stage: 'new_inquiry',
      marginPercent: 20,
      managerApproved: false,
      createdAt: new Date().toISOString(),
      boqItems: [
        {
          id: `b-${Date.now()}`,
          itemId: newInq.itemId || null,
          desc: newInq.firstItemDesc,
          qty: Number(newInq.firstItemQty) || 1,
          unit: newInq.firstItemUom || 'PCS',
          buyCurrency: newInq.firstItemCurrency || 'USD',
          buyUnitCost: Number(newInq.firstItemCost) || 0,
        },
      ],
    };
    const saved = await persistInquiry(obj);
    if (!saved) return;
    setShowNewInqModal(false);
    setSelectedInqId(obj.id);
    setNewInq({
      customerId: '', clientName: '', clientVat: '', contactPerson: '', phone: '', email: '',
      division: 'MEP', salesmanId: '', itemId: '', firstItemDesc: '', firstItemQty: 1,
      firstItemUom: 'PCS', firstItemCost: 0, firstItemCurrency: 'USD',
    });
    refreshAllErpData();
  };

  // Quotes are saved through save_inquiry() (0002_roles_rls.sql), which enforces ownership and
  // keeps costs / margin / approval out of reach of sales roles. Returns the saved quote as this user may see it.
  const persistInquiry = async (obj) => {
    const { data, error } = await supabase.rpc('save_inquiry', { p_id: obj.id, p_data: obj });
    if (error && isMissingObject(error)) {
      const { error: upErr } = await supabase.from('inquiries').upsert({
        id: obj.id,
        data: obj,
        updated_at: new Date().toISOString(),
        updated_by: profile?.full_name || 'ERP User',
      });
      if (upErr) {
        alert(`Quote could not be saved: ${upErr.message}`);
        return null;
      }
      return obj;
    }
    if (error) {
      alert(`Quote could not be saved: ${error.message}`);
      return null;
    }
    return data;
  };

  const saveInquiryPatch = async (inq, patch) => {
    if (!canEditQuotes(profile)) return;
    const updated = { ...inq, ...patch };
    setInquiries((prev) => prev.map((i) => (i.id === inq.id ? updated : i)));
    const seq = (inquirySaveSeq.current[inq.id] || 0) + 1;
    inquirySaveSeq.current[inq.id] = seq;
    const saved = await persistInquiry(updated);
    // apply the server's version (e.g. recomputed prices) only if no newer edit is in flight
    if (inquirySaveSeq.current[inq.id] !== seq) return;
    if (saved) setInquiries((prev) => prev.map((i) => (i.id === inq.id ? saved : i)));
    else refreshAllErpData();
  };

  const handleConvertQuoteToSO = async (inq) => {
    const so = await callPosting('post_sales_order', { p_inquiry_id: inq.id });
    if (!so) return;
    setSelectedInqId(null);
    selectSubModule('sales', 'sales_orders');
    refreshAllErpData();
  };

  const openDeliveryModal = (so) => {
    const initialQtys = {};
    (so.items || []).forEach((it) => {
      const remaining = Math.max(0, Number(it.orderedQty) - Number(it.deliveredQty || 0));
      initialQtys[it.id] = remaining;
    });
    setDeliveryQtys(initialQtys);
    setDeliveryNotesText('');
    setDeliveryModalSO(so);
  };

  const handleRecordDelivery = async (e) => {
    e.preventDefault();
    if (!deliveryModalSO) return;
    const dn = await callPosting('post_delivery_note', {
      p_so_id: deliveryModalSO.id,
      p_qtys: Object.fromEntries(Object.entries(deliveryQtys).map(([id, q]) => [id, Number(q) || 0])),
      p_notes: deliveryNotesText,
      p_serials: Object.fromEntries(Object.entries(deliverySerials).map(([id, txt]) => [id, String(txt || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)])),
      p_warehouse: deliveryWarehouse || null,
    });
    if (!dn) return;
    if ((dn.stock_warnings || []).length) alert(`${dn.dn_number} issued with stock warnings:\n${dn.stock_warnings.join('\n')}`);
    setDeliverySerials({});
    setDeliveryModalSO(null);
    selectSubModule('sales', 'sales_deliveries');
    refreshAllErpData();
  };

  const handleGenerateZatcaInvoiceFromDN = async (dn) => {
    const inv = await callPosting('post_invoice', { p_dn_id: dn.id });
    if (!inv) return;
    selectSubModule('sales', 'sales_invoices');
    await afterInvoicePosted(inv);
  };

  // Project / contract invoices (0014) go through the same ZATCA step as delivery invoices
  const afterInvoicePosted = async (inv) => {
    // Phase 2: a B2B invoice is cleared by ZATCA before anyone sees or shares it; B2C is reported now (or by the queue)
    const msg = await submitAfterPosting(supabase, 'invoice', inv);
    const { data: fresh } = await supabase.from('invoices_v').select('*').eq('id', inv.id).maybeSingle();
    const current = fresh || inv;
    if (!blocksSharing(current)) setPreviewInvoice(current);
    if (msg) alert(`${current.invoice_number}: ${msg}`);
    refreshAllErpData();
  };

  const handleSubmitToZatca = async (docType, doc) => {
    setZatcaBusyId(doc.id);
    try {
      const r = await callZatca(supabase, 'submit', { doc_type: docType, doc_id: doc.id });
      const msgs = [...(r?.errors || []), ...(r?.warnings || [])].map((x) => x.message || x).join('\n');
      alert(`ZATCA: ${r?.status || 'done'}${msgs ? `\n${msgs}` : ''}`);
    } catch (e) {
      alert(`ZATCA submission failed: ${e.message}`);
    } finally {
      setZatcaBusyId(null);
      refreshAllErpData();
    }
  };

  const openInvoicePrint = (inv) => {
    if (blocksSharing(inv)) {
      alert(`${inv.invoice_number} is a B2B tax invoice that ZATCA has not cleared yet (${zatcaStatus(inv).label}). It can be printed or shared once it is cleared.`);
      return;
    }
    setPreviewInvoice(inv);
  };

  const handleRecordCustomerPayment = async (e) => {
    e.preventDefault();
    if (!paymentModalInv) return;
    const amt = parseFloat(paymentAmount) || 0;
    if (amt <= 0) return;
    const rcp = await callPosting('post_customer_receipt', {
      p_invoice_id: paymentModalInv.id,
      p_amount: amt,
      p_method: paymentMethod,
      p_reference: paymentRef,
    });
    if (!rcp) return;
    setPaymentModalInv(null);
    setPaymentAmount('');
    setPaymentRef('');
    refreshAllErpData();
  };


  return { afterInvoicePosted, handleConvertQuoteToSO, handleCreateInquiry, handleGenerateZatcaInvoiceFromDN, handleRecordCustomerPayment, handleRecordDelivery, handleSelectCustomerForInq, handleSelectItemForInq, handleSubmitToZatca, openDeliveryModal, openInvoicePrint, persistInquiry, saveInquiryPatch };
}
