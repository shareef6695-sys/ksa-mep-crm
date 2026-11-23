// Document object pages (invoice / SO / PO) — moved verbatim from App.jsx (Prompt 15). Data and handlers come from the store (useErp).
import { useErp } from '../../app/ErpContext';
import { InvoiceObjectPage, PurchaseOrderObjectPage, SalesOrderObjectPage } from '../../erp/ObjectPages';
import { invoiceOpenSar } from '../../erp/erpEngine';
import { can } from '../../lib/permissions';
import { MessageStrip } from '../../ui/FioriShell';

export default function ObjectScreens() {
  const { closeObject, commissions, company, creditNotes, deliveryNotes, glEntries, invoices, lang, objInvoice, objPO, objSO,
    objectPage, openDeliveryModal, openInvoicePrint, openObject, profile, purchaseOrders, receiptAllocations, receipts, salesOrders,
    selectSubModule, setPaymentAmount, setPaymentModalInv, setPreviewPO, setPreviewSO, supplierPayments, userCanViewCost, vendors } = useErp();
  return (
    <>
          {objInvoice && (
            <InvoiceObjectPage
              lang={lang}
              invoice={objInvoice}
              company={company}
              receipts={receipts}
              creditNotes={creditNotes}
              glEntries={glEntries}
              commissions={commissions}
              salesOrders={salesOrders}
              deliveryNotes={deliveryNotes}
              onBack={closeObject}
              onRecordPayment={can(profile, 'receipt.create') ? (inv) => {
                setPaymentModalInv(inv);
                setPaymentAmount(Math.max(0, invoiceOpenSar(inv)).toFixed(2));
              } : undefined}
              onPrint={openInvoicePrint}
              onOpenSalesOrder={(so) => openObject('so', so.id)}
              canViewCost={userCanViewCost}
              receiptAllocations={receiptAllocations}
            />
          )}
          {objSO && (
            <SalesOrderObjectPage
              lang={lang}
              so={objSO}
              deliveryNotes={deliveryNotes}
              invoices={invoices}
              purchaseOrders={purchaseOrders}
              receipts={receipts}
              glEntries={glEntries}
              onBack={closeObject}
              onPrint={(so) => setPreviewSO(so)}
              onDeliver={can(profile, 'delivery.create') ? (so) => openDeliveryModal(so) : undefined}
              onOpenInvoice={(inv) => openObject('invoice', inv.id)}
              onOpenPurchaseOrder={(po) => openObject('po', po.id)}
              canViewCost={userCanViewCost}
            />
          )}
          {objPO && (
            <PurchaseOrderObjectPage
              lang={lang}
              po={objPO}
              supplierPayments={supplierPayments}
              glEntries={glEntries}
              vendors={vendors}
              salesOrders={salesOrders}
              onBack={closeObject}
              onPrint={(po) => setPreviewPO(po)}
              onPay={can(profile, 'supplier_payment.create') ? () => selectSubModule('finance', 'fin_supplier_payments') : undefined}
              onOpenSalesOrder={(so) => openObject('so', so.id)}
            />
          )}
          {objectPage && !objInvoice && !objSO && !objPO && (
            <MessageStrip type="warning" onClose={closeObject}>
              This document is no longer available.
            </MessageStrip>
          )}
    </>
  );
}
