// Horizon ERP shell: sign-in gate, navigation, routing. Screens live in src/features/*, state in src/app/useErpStore.js.
import { lazy, Suspense } from 'react';
import { ErpContext } from './app/ErpContext';
import { useErpStore } from './app/useErpStore';
import { setFinanceLang } from './ui/financeI18n';
import { Lock, RefreshCw } from 'lucide-react';
import LoginLandingPage from './app/LoginLandingPage';
import { GlobalSmartDiscoveryModal } from './erp/SmartDiscovery';
import { ZatcaPhase2View } from './erp/ZatcaPhase2View';
import { formatSAR } from './erp/erpEngine';
import { can, canOpen } from './lib/permissions';
import { supabase } from './lib/supabase';
import { Launchpad, MessageStrip, PageHeader, ShellBar, SideNavigation } from './ui/FioriShell';
import { t } from './ui/i18n';

const AdminScreens = lazy(() => import('./features/admin/AdminScreens.jsx'));
const FinanceScreens = lazy(() => import('./features/finance/FinanceScreens.jsx'));
const InventoryScreens = lazy(() => import('./features/inventory/InventoryScreens.jsx'));
const ProjectsScreens = lazy(() => import('./features/projects/ProjectsScreens.jsx'));
const PurchaseScreens = lazy(() => import('./features/purchase/PurchaseScreens.jsx'));
const SalesScreens = lazy(() => import('./features/sales/SalesScreens.jsx'));
const SalesModals = lazy(() => import('./features/sales/SalesModals.jsx'));
const PurchaseModals = lazy(() => import('./features/purchase/PurchaseModals.jsx'));
const AdminModals = lazy(() => import('./features/admin/AdminModals.jsx'));
const ObjectScreens = lazy(() => import('./features/objects/ObjectScreens.jsx'));

// screen id -> feature bundle (each feature is loaded on first use)
const SCREEN_FEATURE = {
  'cat_items': 'inventory',
  'comm_ledger': 'sales',
  'fin_aging': 'finance',
  'fin_bank_cash': 'finance',
  'fin_budget': 'finance',
  'fin_cash_flow': 'finance',
  'fin_collections': 'finance',
  'fin_dashboard': 'finance',
  'fin_expenses': 'finance',
  'fin_fixed_assets': 'finance',
  'fin_gl': 'finance',
  'fin_period_close': 'finance',
  'fin_profitability': 'finance',
  'fin_statements': 'finance',
  'fin_statements_of_account': 'finance',
  'fin_supplier_payments': 'finance',
  'fin_vat_return': 'finance',
  'fin_zatca_advisor': 'finance',
  'inv_stock': 'inventory',
  'proj_contracts': 'projects',
  'proj_job_cost': 'projects',
  'proj_projects': 'projects',
  'proj_tickets': 'projects',
  'pur_bills': 'purchase',
  'pur_grn': 'purchase',
  'pur_orders': 'purchase',
  'pur_requisitions': 'purchase',
  'pur_vendors': 'purchase',
  'sales_credit_notes': 'sales',
  'sales_customers': 'sales',
  'sales_deliveries': 'sales',
  'sales_invoices': 'sales',
  'sales_orders': 'sales',
  'sales_pipeline': 'sales',
  'sales_quotes': 'sales',
  'set_audit_log': 'admin',
  'set_company': 'admin',
  'set_notifications': 'admin',
  'set_num_ranges': 'admin',
  'set_salesmen': 'admin'
};

const ScreenLoading = () => <div className="p-6 text-xs text-slate-400">Loading…</div>;

export default function App() {
  const erp = useErpStore();
  const { activeParent, activeSub, activeSubModule, amendSO, annualTaxableRevenueSAR, authLoading, billModalPO, company, customers,
    deliveryModalSO, expandedModules, globalSearchOpen, goHome, grnModalPO, importVatForm, inquiries, invoices, isHome, items, lang,
    launchpadGroups, launchpadInsights, missingTables, mobileDrawerOpen, navTree, noAccess, objectPage, paymentModalInv,
    phase2Active, previewDN, previewInvoice, previewPO, previewQuotation, previewSO, profile, purchaseOrders,
    quickCreateType, refreshAllErpData, salesOrders, selectSubModule, selectedInq, session, setExpandedModules, setGlobalSearchOpen,
    setMobileDrawerOpen, setSelectedInqId, setSession, setSidebarCollapsed, setUxPrefs, shellNotifications, showNewInqModal,
    showNewPOModal, sidebarCollapsed, syncStatus, teamProfiles, toggleMainModule, uxPrefs, vendors, view, zatcaAdvice } = erp;
  setFinanceLang(lang); // finance screens translate through tr() (src/ui/financeI18n.js)
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!session) {
    return <LoginLandingPage company={company} onLoginSuccess={(u) => setSession({ user: u })} />;
  }

  if (noAccess) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-3 text-center">
          <Lock className="w-8 h-8 mx-auto text-amber-600" />
          <h1 className="text-base font-bold text-slate-900">
            {lang === 'ar' ? 'لا توجد صلاحية لهذا الحساب' : 'This account has no access yet'}
          </h1>
          <p className="text-xs text-slate-600">
            {lang === 'ar'
              ? 'لم يتم تعيين دور نشط لحسابك. اطلب من مسؤول النظام تعيين دورك في شاشة الفريق.'
              : 'No active role is assigned to your account. Ask a System Administrator to set your role in Team & Salesmen Master.'}
          </p>
          <p className="text-[11px] text-slate-400">{session.user?.email}</p>
          <button type="button" onClick={() => supabase.auth.signOut()} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold cursor-pointer">
            {lang === 'ar' ? 'تسجيل الخروج' : 'Sign out'}
          </button>
        </div>
      </div>
    );
  }


  const renderSideNav = (isMobile = false) => (
    <SideNavigation
      lang={lang}
      navTree={navTree}
      activeId={activeSubModule}
      expanded={expandedModules}
      onToggleGroup={toggleMainModule}
      onSelect={selectSubModule}
      collapsed={sidebarCollapsed}
      onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
      onHome={goHome}
      isMobile={isMobile}
      onClose={() => setMobileDrawerOpen(false)}
    />
  );


  return (
    <ErpContext.Provider value={erp}>
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      <ShellBar
        lang={lang}
        company={company}
        appTitle={activeSub ? t(lang, `nav.${activeSub.id}`, activeSub.label) : ''}
        isHome={isHome}
        onHome={goHome}
        onToggleNav={() => {
          if (window.innerWidth < 1024) setMobileDrawerOpen(true);
          else setSidebarCollapsed(!sidebarCollapsed);
        }}
        onSearch={() => setGlobalSearchOpen(true)}
        notifications={shellNotifications}
        profile={profile}
        prefs={uxPrefs}
        setPrefs={setUxPrefs}
        onSignOut={() => supabase.auth.signOut()}
        syncStatus={syncStatus}
        ytdSales={formatSAR(annualTaxableRevenueSAR)}
      />

      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div className="w-72 max-w-[85vw] h-full shadow-2xl">{renderSideNav(true)}</div>
          <div className="flex-1 bg-slate-950/60" onClick={() => setMobileDrawerOpen(false)} />
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <aside className={`hidden lg:block shrink-0 transition-all duration-200 no-print ${sidebarCollapsed ? 'w-16' : 'w-64'}`}>
          <div className="sticky top-12 h-[calc(100vh-3rem)]">{renderSideNav(false)}</div>
        </aside>

      <div className="flex-1 min-w-0 flex flex-col">

        <main className={`flex-1 w-full mx-auto px-4 sm:px-6 py-5 space-y-5 ${isHome ? 'max-w-7xl' : 'max-w-6xl'}`}>
          {!isHome && activeSub && !objectPage && (
            <PageHeader
              lang={lang}
              crumbs={[
                { label: t(lang, 'shell.home'), onClick: goHome },
                { label: t(lang, `nav.${activeParent.id}`, activeParent.label), onClick: () => setExpandedModules((p) => ({ ...p, [activeParent.id]: true })) },
                { label: t(lang, `nav.${activeSub.id}`, activeSub.label) },
              ]}
              title={t(lang, `nav.${activeSub.id}`, activeSub.label)}
              subtitle={`${company.nameEn} • VAT ${company.vatNumber}`}
              icon={activeSub.icon}
            />
          )}

          {missingTables.length > 0 && canOpen(profile, 'set_company') && (
            <MessageStrip type="error">
              <span className="font-bold">{t(lang, 'notif.schema', '', { n: missingTables.length })}: </span>
              <span className="font-mono">{missingTables.join(', ')}</span>. Apply the database migrations in{' '}
              <span className="font-mono">supabase/migrations/</span> in the order given in the README (Database migrations).
            </MessageStrip>
          )}

          {(isHome || activeSubModule === 'sales_invoices' || activeSubModule === 'fin_zatca_advisor') && !objectPage && (
            <MessageStrip type={phase2Active ? 'success' : 'information'}>
              <span className="font-bold">{zatcaAdvice.wave}: </span>
              {zatcaAdvice.statusText}
            </MessageStrip>
          )}

          {view === '__restricted__' && (
            <MessageStrip type="warning" onClose={() => selectSubModule('home', 'home')}>
              {lang === 'ar' ? 'لا تملك صلاحية لفتح هذه الشاشة.' : 'Access restricted: your role cannot open this screen.'}
            </MessageStrip>
          )}
          {isHome && !objectPage && <Launchpad lang={lang} profile={profile} groups={launchpadGroups} insights={launchpadInsights} />}

          {/* ===== OBJECT PAGES (full-page document detail) ===== */}
          <Suspense fallback={<ScreenLoading />}>{objectPage && <ObjectScreens />}</Suspense>

          {/* MASTER DATA VIEWS IN THEIR RELATED MODULES */}
          <Suspense fallback={<ScreenLoading />}>
            {SCREEN_FEATURE[view] === 'admin' && <AdminScreens />}
            {SCREEN_FEATURE[view] === 'finance' && <FinanceScreens />}
            {SCREEN_FEATURE[view] === 'inventory' && <InventoryScreens />}
            {SCREEN_FEATURE[view] === 'projects' && <ProjectsScreens />}
            {SCREEN_FEATURE[view] === 'purchase' && <PurchaseScreens />}
            {SCREEN_FEATURE[view] === 'sales' && <SalesScreens />}
          </Suspense>



          {/* SUB-MODULE: 1.2 INQUIRIES & QUOTES */}

          {/* SUB-MODULE: 1.3 SALES ORDERS */}

          {/* SUB-MODULE: 1.4 DELIVERIES */}


          {/* SUB-MODULE: 1.5 ZATCA INVOICES */}

          {/* SUB-MODULE: 2.1 AR CUSTOMER RECEIPTS */}
          {/* ===== FINANCE & ACCOUNTING SUITE ===== */}


          {/* SUB-MODULE: 2.2 ZATCA WAVE & VAT */}

          {/* SUB-MODULES: 3.2 / 3.3 / 3.4 PURCHASE CYCLE */}


          {/* SUB-MODULE: 5.1 SALES PROFIT SHARE LEDGER */}

          {/* SUB-MODULE: 6.1 TEAM & SALESMEN MASTER (CREATE NEW SALESMEN & STAFF) */}



          {/* SUB-MODULE: 6.2 COMPANY SETTINGS */}

          {view === 'set_zatca_phase2' && (
            <ZatcaPhase2View supabase={supabase} company={company} lang={lang} canOnboard={can(profile, 'zatca.onboard')} onChanged={refreshAllErpData} />
          )}

        </main>
      </div>
      </div>

      {/* GLOBAL SMART SEARCH & DISCOVERY MODAL */}
      <GlobalSmartDiscoveryModal
        isOpen={globalSearchOpen}
        onClose={() => setGlobalSearchOpen(false)}
        customers={customers}
        vendors={vendors}
        items={items}
        inquiries={inquiries}
        salesOrders={salesOrders}
        invoices={invoices}
        purchaseOrders={purchaseOrders}
        teamProfiles={teamProfiles}
        onNavigate={(modId, subId, recordId) => {
          if (modId === 'OPEN_SEARCH') {
            setGlobalSearchOpen(true);
            return;
          }
          selectSubModule(modId, subId);
          if (recordId && subId === 'sales_quotes') setSelectedInqId(recordId);
        }}
      />

      {/* INQUIRY BOQ & MULTI-CURRENCY COSTING DRAWER (WITH SMART ITEM PICKER + CREATE NEW) */}

      {/* MODAL: NEW INQUIRY WITH SMART FIELD DROPDOWNS + INLINE "+ CREATE NEW" */}

      {/* MODAL: NEW PURCHASE ORDER WITH SMART VENDOR, SO & ITEM DROPDOWNS + "+ CREATE NEW" */}

      {/* CUSTOMS IMPORT VAT (0009): VAT paid to customs on imported goods is input VAT (box 8) */}

      {/* INLINE QUICK-CREATE MODALS TRIGGERED FROM ANY "+ CREATE NEW" DROPDOWN */}




      {/* MODAL: FULL OR PARTIAL DELIVERY NOTE */}


      {/* GOODS RECEIPT / SUPPLIER BILL (0012) */}

      {/* MODALS: PRINTABLE A4 QUOTATION / SALES ORDER / DELIVERY NOTE / PURCHASE ORDER */}

      {/* MODAL: ZATCA BILINGUAL INVOICE PREVIEW */}

      {/* MODAL: CUSTOMER PAYMENT RECEIPT */}
      {(amendSO || deliveryModalSO || paymentModalInv || previewDN || previewInvoice || previewQuotation || previewSO || selectedInq || showNewInqModal) && <Suspense fallback={null}><SalesModals /></Suspense>}
      {(billModalPO || grnModalPO || importVatForm || previewPO || showNewPOModal) && <Suspense fallback={null}><PurchaseModals /></Suspense>}
      {((quickCreateType === 'customer') || (quickCreateType === 'item') || (quickCreateType === 'salesman') || (quickCreateType === 'vendor')) && <Suspense fallback={null}><AdminModals /></Suspense>}
    </div>
    </ErpContext.Provider>
  );
}
