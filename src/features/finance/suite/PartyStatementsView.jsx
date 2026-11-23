// PartyStatementsView (split from erp/FinanceSuiteViews.jsx, Prompt 15).
import { Download, FileText, Lock, Printer, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { downloadCsvFile } from '../../../erp/csvExport';
import { formatSAR } from '../../../erp/erpEngine';
import { Header, TabButton, btnCsv, btnDark, inputCls, labelCls, num, todayStr } from './shared';
import { tr } from '../../../ui/financeI18n';

const norm = (s) => String(s || '').trim().toLowerCase();

export function PartyStatementsView({ company = {}, customers = [], vendors = [], invoices = [], creditNotes = [], receipts = [], purchaseOrders = [], supplierPayments = [], customerCreditLedger = [] }) {
  const [side, setSide] = useState('customer');
  const [party, setParty] = useState('');
  const [fromDate, setFromDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [toDate, setToDate] = useState(todayStr());

  const isBilledPO = (p) => ['billed', 'partially_billed', 'paid', 'closed'].includes(p.status) || ['posted', 'partial', 'paid'].includes(p.bill_status);

  const parties = useMemo(() => {
    const set = new Map();
    const add = (name) => {
      const n = String(name || '').trim();
      if (n && !set.has(norm(n))) set.set(norm(n), n);
    };
    if (side === 'customer') {
      customers.forEach((c) => add(c.name_en));
      invoices.forEach((i) => add(i.client_name));
      creditNotes.forEach((c) => add(c.client_name));
      receipts.forEach((r) => add(r.client_name));
    } else {
      vendors.forEach((v) => add(v.name_en));
      purchaseOrders.forEach((p) => add(p.supplier_name));
      supplierPayments.forEach((p) => add(p.supplier_name));
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [side, customers, vendors, invoices, creditNotes, receipts, purchaseOrders, supplierPayments]);

  const activeParty = parties.find((p) => p === party) || parties[0] || '';
  const master = side === 'customer' ? customers.find((c) => norm(c.name_en) === norm(activeParty)) : vendors.find((v) => norm(v.name_en) === norm(activeParty));

  const statement = useMemo(() => {
    const n = norm(activeParty);
    const tx = [];
    if (side === 'customer') {
      invoices.filter((i) => norm(i.client_name) === n).forEach((i) => tx.push({ date: String(i.issued_at || i.created_at || '').slice(0, 10), type: 'Tax Invoice', doc: i.invoice_number, desc: i.so_number ? `SO ${i.so_number}` : '', debit: num(i.grand_total_sar), credit: 0 }));
      creditNotes.filter((c) => norm(c.client_name) === n).forEach((c) => tx.push({ date: String(c.issued_at || c.created_at || '').slice(0, 10), type: 'Credit Note', doc: c.credit_note_number, desc: c.original_invoice_number ? `vs ${c.original_invoice_number}` : c.reason || '', debit: 0, credit: num(c.grand_total_sar) }));
      customerCreditLedger.filter((x) => x.kind === 'refunded' && norm(x.client_name) === n).forEach((x) => tx.push({ date: String(x.entry_date || '').slice(0, 10), type: 'Refund', doc: x.source_doc, desc: x.notes || 'Refund of customer credit', debit: Math.abs(num(x.amount_sar)), credit: 0 }));
      receipts.filter((r) => norm(r.client_name) === n).forEach((r) => tx.push({ date: String(r.received_at || r.created_at || '').slice(0, 10), type: 'Receipt', doc: r.receipt_number, desc: `${r.payment_method || ''} ${r.reference_no || ''} ${r.invoice_number ? `for ${r.invoice_number}` : ''}`.trim(), debit: 0, credit: num(r.amount_sar) }));
    } else {
      purchaseOrders.filter((p) => norm(p.supplier_name) === n && isBilledPO(p)).forEach((p) => tx.push({ date: String(p.billed_at || p.updated_at || p.created_at || '').slice(0, 10), type: 'Supplier Bill', doc: p.po_number, desc: `${p.currency || 'SAR'} goods + landed cost + VAT`, debit: 0, credit: num(p.goods_total_sar) + num(p.landed_cost_sar) + num(p.supplier_vat_sar) }));
      supplierPayments.filter((p) => norm(p.supplier_name) === n).forEach((p) => tx.push({ date: String(p.payment_date || p.created_at || '').slice(0, 10), type: 'Payment', doc: p.voucher_number, desc: `${p.payment_method || ''} ${p.bank_reference || ''} ${p.po_number ? `for ${p.po_number}` : ''}`.trim(), debit: num(p.amount_sar), credit: 0 }));
    }
    tx.sort((a, b) => a.date.localeCompare(b.date));
    const sign = side === 'customer' ? 1 : -1; // customer: receivable (Dr+), supplier: payable (Cr+)
    const opening = tx.filter((t) => t.date < fromDate).reduce((s, t) => s + sign * (t.debit - t.credit), 0);
    let bal = opening;
    const rows = tx
      .filter((t) => t.date >= fromDate && t.date <= toDate)
      .map((t) => {
        bal += sign * (t.debit - t.credit);
        return { ...t, balance: bal };
      });
    const totDr = rows.reduce((s, r) => s + r.debit, 0);
    const totCr = rows.reduce((s, r) => s + r.credit, 0);
    return { opening, rows, closing: bal, totDr, totCr };
  }, [side, activeParty, invoices, creditNotes, receipts, purchaseOrders, supplierPayments, customerCreditLedger, fromDate, toDate]);

  const exportCsv = () =>
    downloadCsvFile(
      `Statement_${side}_${activeParty.replace(/[^A-Za-z0-9]+/g, '_')}_${toDate}.csv`,
      ['Date', 'Type', 'Document', 'Description', 'Debit (SAR)', 'Credit (SAR)', 'Balance (SAR)'],
      [['', '', '', 'Opening Balance', '', '', statement.opening.toFixed(2)], ...statement.rows.map((r) => [r.date, r.type, r.doc, r.desc, r.debit.toFixed(2), r.credit.toFixed(2), r.balance.toFixed(2)]), ['', '', '', 'Closing Balance', statement.totDr.toFixed(2), statement.totCr.toFixed(2), statement.closing.toFixed(2)]]
    );

  return (
    <div className="space-y-4">
      <Header icon={FileText} title={tr("Statements of Account • كشوف الحسابات")} subtitle={tr("Running-balance customer and supplier statements with opening balance — print on A4 or export to Excel.")}>
        <button type="button" onClick={exportCsv} disabled={!activeParty} className={btnCsv}><Download className="w-4 h-4" /> {tr("Export CSV")}</button>
        <button type="button" onClick={() => window.print()} disabled={!activeParty} className={btnDark}><Printer className="w-4 h-4" /> {tr("Print A4")}</button>
      </Header>

      <div className="no-print flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-2xl p-4">
        <div className="flex gap-1.5">
          <TabButton active={side === 'customer'} onClick={() => { setSide('customer'); setParty(''); }}>{tr("Customer (AR)")}</TabButton>
          <TabButton active={side === 'supplier'} onClick={() => { setSide('supplier'); setParty(''); }}>{tr("Supplier (AP)")}</TabButton>
        </div>
        <div className="min-w-[240px]">
          <label className={labelCls}>{side === 'customer' ? tr('Customer') : tr('Supplier')}</label>
          <select className={inputCls} value={activeParty} onChange={(e) => setParty(e.target.value)}>
            {parties.length === 0 && <option value="">{tr("No parties found")}</option>}
            {parties.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div><label className={labelCls}>{tr("From")}</label><input type="date" className={inputCls} value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
        <div><label className={labelCls}>{tr("To")}</label><input type="date" className={inputCls} value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
      </div>

      {!activeParty ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">{tr("No")}{" "}{side === 'customer' ? 'customers' : 'suppliers'}{" "}{tr("with transactions yet.")}</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-5 border-b border-slate-200 flex flex-wrap justify-between gap-4">
            <div className="flex items-start gap-3">
              {company?.logoUrl && <img src={company.logoUrl} alt="Company Logo" className="h-12 max-w-[150px] object-contain" />}
              <div className="text-xs">
                <div className="font-bold text-sm text-slate-900">{company?.nameEn}</div>
                {company?.nameAr && <div className="font-semibold text-slate-700">{company.nameAr}</div>}
                <div className="text-slate-500">{tr("VAT TIN:")} <span className="font-mono">{company?.vatNumber}</span></div>
              </div>
            </div>
            <div className="text-end text-xs">
              <div className="font-bold text-sm text-slate-900">{tr("STATEMENT OF ACCOUNT • كشف حساب")}</div>
              <div className="text-slate-500">{fromDate} → {toDate}</div>
              <div className="mt-2 font-bold text-slate-900">{activeParty}</div>
              {master?.vat_number && <div className="text-slate-500">{tr("VAT:")} <span className="font-mono">{master.vat_number}</span></div>}
              {(master?.customer_code || master?.vendor_code) && <div className="text-slate-500">{master.customer_code || master.vendor_code}</div>}
            </div>
          </div>
          <table className="w-full text-start text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr><th className="p-3">{tr("Date")}</th><th className="p-3">{tr("Type")}</th><th className="p-3">{tr("Document")}</th><th className="p-3">{tr("Description")}</th><th className="p-3 text-end">{tr("Debit")}</th><th className="p-3 text-end">{tr("Credit")}</th><th className="p-3 text-end">{tr("Balance")}</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="font-semibold bg-slate-50/60"><td className="p-3" colSpan={6}>{tr("Opening Balance")}</td><td className="p-3 text-end font-mono">{formatSAR(statement.opening)}</td></tr>
              {statement.rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">{tr("No transactions in this period.")}</td></tr>}
              {statement.rows.map((r, i) => (
                <tr key={`${r.doc}-${i}`}>
                  <td className="p-3 whitespace-nowrap">{r.date}</td>
                  <td className="p-3">{tr(r.type)}</td>
                  <td className="p-3 font-mono text-blue-700">{r.doc}</td>
                  <td className="p-3 text-slate-500">{r.desc}</td>
                  <td className="p-3 text-end font-mono">{r.debit > 0 ? formatSAR(r.debit) : '—'}</td>
                  <td className="p-3 text-end font-mono">{r.credit > 0 ? formatSAR(r.credit) : '—'}</td>
                  <td className="p-3 text-end font-mono font-bold">{formatSAR(r.balance)}</td>
                </tr>
              ))}
              <tr className="bg-slate-900 text-white font-bold">
                <td className="p-3" colSpan={4}>{side === 'customer' ? tr('Balance due from customer') : tr('Balance payable to supplier')} • الرصيد المستحق</td>
                <td className="p-3 text-end font-mono">{formatSAR(statement.totDr)}</td>
                <td className="p-3 text-end font-mono">{formatSAR(statement.totCr)}</td>
                <td className="p-3 text-end font-mono text-emerald-400">{tr("SAR")}{" "}{formatSAR(statement.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 7. Period Lock & Year-End Close                                     */
/* ------------------------------------------------------------------ */
