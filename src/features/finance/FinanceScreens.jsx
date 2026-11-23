// Finance screens — moved verbatim from App.jsx (Prompt 15). Data and handlers come from the store (useErp).
import { useErp } from '../../app/ErpContext';
import { CustomerReceiptsPanel } from '../../erp/CustomerReceiptsPanel';
import { ExecutiveDashboardView } from '../../erp/ExecutiveDashboardView';
import { BankCashView, BudgetVsActualView, CashFlowStatementView, ExpenseVouchersView, FixedAssetsView, PartyStatementsView, PeriodCloseView } from './suite';
import { FinancialStatementsView } from '../../erp/FinancialStatementsView';
import { GeneralLedgerView } from '../../erp/GeneralLedgerView';
import { AgingReportView, SupplierPaymentsView } from '../../erp/PaymentsAndAgingView';
import { DealProfitabilityView, ZatcaVatReturnView } from '../../erp/VatAndProfitabilityView';
import { VatReturnView } from '../../erp/VatReturnView';
import { formatSAR } from '../../erp/erpEngine';
import { can } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { SmartFilterBar } from '../../ui/SmartFilterBar';

export default function FinanceScreens() {
  const { annualTaxableRevenueSAR, bankReconciliations, budgets, commissions, company, creditNotes, customerCreditLedger, customers,
    expenses, fixedAssets, glAccounts, glEntries, glLockDate, inquiries, invoices, items, lang, navTree, openObject, profile,
    projects, purchaseOrders, receipts, refreshAllErpData, salesOrders, selectSubModule, supplierBills, supplierPayments, vendors,
    view, zatcaAdvice } = useErp();
  return (
    <>
          {view === 'fin_dashboard' && (
            <ExecutiveDashboardView
              company={company}
              profile={profile}
              inquiries={inquiries}
              salesOrders={salesOrders}
              invoices={invoices}
              creditNotes={creditNotes}
              purchaseOrders={purchaseOrders}
              receipts={receipts}
              supplierPayments={supplierPayments}
              items={items}
              commissions={commissions}
              glEntries={glEntries}
              onNavigate={(_moduleLabel, rawSubId) => {
                const aliases = { sales_inquiries: 'sales_quotes', fin_deal_pnl: 'fin_profitability', cat_inventory: 'cat_items' };
                const subId = aliases[rawSubId] || rawSubId;
                const parent = navTree.find((m) => m.subModules.some((s) => s.id === subId));
                if (parent) selectSubModule(parent.id, subId);
              }}
            />
          )}
          {view === 'fin_supplier_payments' && (
            <SupplierPaymentsView readOnly={!can(profile, 'supplier_payment.create')} supabase={supabase} glAccounts={glAccounts} purchaseOrders={purchaseOrders} supplierPayments={supplierPayments} profile={profile} onRefresh={refreshAllErpData} />
          )}
          {view === 'fin_aging' && <AgingReportView invoices={invoices} purchaseOrders={purchaseOrders} supplierBills={supplierBills.length || purchaseOrders.every((p) => !p.bill_number) ? supplierBills : null} />}
          {view === 'fin_statements_of_account' && (
            <PartyStatementsView
              company={company}
              customers={customers}
              vendors={vendors}
              invoices={invoices}
              creditNotes={creditNotes}
              receipts={receipts}
              purchaseOrders={purchaseOrders}
              supplierPayments={supplierPayments}
              customerCreditLedger={customerCreditLedger}
            />
          )}
          {view === 'fin_bank_cash' && (
            <BankCashView supabase={supabase} glAccounts={glAccounts} glEntries={glEntries} bankReconciliations={bankReconciliations} profile={profile} lockDate={glLockDate} onRefresh={refreshAllErpData} />
          )}
          {view === 'fin_expenses' && (
            <ExpenseVouchersView supabase={supabase} glAccounts={glAccounts} expenses={expenses} vendors={vendors} projects={projects} profile={profile} lockDate={glLockDate} onRefresh={refreshAllErpData} />
          )}
          {view === 'fin_fixed_assets' && (
            <FixedAssetsView supabase={supabase} glAccounts={glAccounts} fixedAssets={fixedAssets} profile={profile} lockDate={glLockDate} onRefresh={refreshAllErpData} />
          )}
          {view === 'fin_gl' && (
            <GeneralLedgerView supabase={supabase} glAccounts={glAccounts} glEntries={glEntries} profile={profile} onRefresh={refreshAllErpData} />
          )}
          {view === 'fin_statements' && <FinancialStatementsView supabase={supabase} company={company} glAccounts={glAccounts} glEntries={glEntries} />}
          {view === 'fin_cash_flow' && <CashFlowStatementView company={company} glAccounts={glAccounts} glEntries={glEntries} />}
          {view === 'fin_budget' && (
            <BudgetVsActualView supabase={supabase} glAccounts={glAccounts} glEntries={glEntries} budgets={budgets} onRefresh={refreshAllErpData} />
          )}
          {view === 'fin_vat_return' && (
            <VatReturnView supabase={supabase} lang={lang} legacy={<ZatcaVatReturnView company={company} invoices={invoices} creditNotes={creditNotes} purchaseOrders={purchaseOrders} expenses={expenses} />} />
          )}
          {view === 'fin_profitability' && (
            <DealProfitabilityView invoices={invoices} creditNotes={creditNotes} commissions={commissions} supplierPayments={supplierPayments} salesOrders={salesOrders} />
          )}
          {view === 'fin_period_close' && (
            <PeriodCloseView supabase={supabase} glAccounts={glAccounts} glEntries={glEntries} lockDate={glLockDate} profile={profile} onRefresh={refreshAllErpData} />
          )}
          {view === 'fin_collections' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Accounts Receivable &amp; Customer Receipts</h2>
                <p className="text-xs text-slate-500">Collected customer payments unlock Salesman Net Profit Share automatically.</p>
              </div>

              <CustomerReceiptsPanel supabase={supabase} invoices={invoices} glAccounts={glAccounts} canPost={can(profile, 'receipt.create')} onRefresh={refreshAllErpData} lang={lang} />

              {receipts.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                  No customer payments recorded yet.
                </div>
              ) : (
                <SmartFilterBar lang={lang} rows={receipts} storageKey="receipts" searchKeys={['receipt_number', 'invoice_number', 'client_name', 'reference_no']} filters={[{ key: 'payment_method', label: lang === 'ar' ? 'طريقة الدفع' : 'Method', type: 'select' }, { key: 'received_at', label: lang === 'ar' ? 'التاريخ' : 'Date', type: 'daterange' }, { key: 'amount_sar', label: lang === 'ar' ? 'المبلغ' : 'Amount', type: 'numberrange' }]} sortOptions={[{ key: 'received_at', label: 'Date' }, { key: 'amount_sar', label: 'Amount' }]} defaultSort={{ key: 'received_at', dir: 'desc' }} csv={{ filename: 'Customer_Receipts', columns: [{ key: 'receipt_number', label: 'Receipt #' }, { key: 'invoice_number', label: 'Invoice #' }, { key: 'client_name', label: 'Client' }, { key: 'payment_method', label: 'Method' }, { key: 'reference_no', label: 'Reference' }, { key: 'amount_sar', label: 'Amount (SAR)' }, { key: 'received_at', label: 'Date' }] }}>
                {(rows) => (
                <div className="grid gap-3">
                  {rows.map((r) => (
                    <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-emerald-700">{r.receipt_number} • Invoice{' '}{invoices.some((x) => x.id === r.invoice_id) ? <button type="button" onClick={() => openObject('invoice', r.invoice_id)} className="underline decoration-dotted underline-offset-2 cursor-pointer">{r.invoice_number}</button> : r.invoice_number}</div>
                        <div className="font-bold text-sm mt-0.5">{r.client_name}</div>
                        <div className="text-xs text-slate-500">{r.payment_method} {r.reference_no ? `• Ref: ${r.reference_no}` : ''}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-bold text-emerald-600">+ SAR {formatSAR(r.amount_sar)}</div>
                        <div className="text-[11px] text-slate-400">{new Date(r.received_at).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
                )}
                </SmartFilterBar>
              )}
            </div>
          )}
          {view === 'fin_zatca_advisor' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <h2 className="text-base font-bold text-slate-900">ZATCA Fatoora Wave Readiness &amp; VAT Output Summary</h2>
              <div className="grid sm:grid-cols-3 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">YTD Taxable Sales (Excl. VAT)</div>
                  <div className="text-xl font-bold mt-1">SAR {formatSAR(annualTaxableRevenueSAR)}</div>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Output VAT Collected (15%)</div>
                  <div className="text-xl font-bold text-blue-700 mt-1">
                    SAR {formatSAR(invoices.reduce((s, i) => s + Number(i.vat_sar || 0), 0))}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Applicable ZATCA Phase</div>
                  <div className="text-sm font-bold text-emerald-700 mt-1">{zatcaAdvice.wave}</div>
                </div>
              </div>
            </div>
          )}
    </>
  );
}
