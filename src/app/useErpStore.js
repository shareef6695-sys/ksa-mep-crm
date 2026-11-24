// Application state: data tables, settings, navigation, derived values (moved from App.jsx, Prompt 15).
// The feature action hooks (features/*/use*Actions.js) add the handlers; App.jsx is the shell.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BellRing, Banknote, BookOpen, Boxes, Building, Building2, Calculator, CalendarCheck, ClipboardList, CreditCard, FileMinus, FileSignature, FileSpreadsheet, FileText, FolderKanban, Gauge, HandCoins, Hash, History, Landmark, Layers, LineChart, Lock, Package, PackageCheck, Percent, PieChart, Receipt, ReceiptText, Scale, Settings, ShieldCheck, ShoppingBag, Sliders, Truck, UserPlus, Users, Wallet, Waves, Wrench } from 'lucide-react';
import { emptyPoLine, openToBill, openToReceive } from '../erp/ProcurementPanels';
import { formatSAR, getZatcaComplianceAdvice, invoiceOpenSar } from '../erp/erpEngine';
import { isMissingObject } from '../lib/dbHelpers';
import { fetchAllRows } from '../lib/fetchAll';
import { can, canOpen, canPriceQuotes, canViewCost, filterNavTree } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { useUxPrefs } from '../ui/FioriShell';
import { t } from '../ui/i18n';
import { DEFAULT_COMPANY, DEFAULT_FX, ROLE_OPTIONS } from './constants';
import { useSalesActions } from '../features/sales/useSalesActions';
import { usePurchaseActions } from '../features/purchase/usePurchaseActions';
import { useAdminActions } from '../features/admin/useAdminActions';

function useErpCore() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [noAccess, setNoAccess] = useState(false);
  const inquirySaveSeq = useRef({});
  const [teamProfiles, setTeamProfiles] = useState([]);
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [fxRates, setFxRates] = useState(DEFAULT_FX);
  const [syncStatus, setSyncStatus] = useState('connecting');

  // Navigation & Global Smart Search
  const lastScreenRef = useRef(null);
  // Navigation: the screen is the URL path (/fin_gl), a document is /object/<type>/<id> (Prompt 15)
  const location = useLocation();
  const navigate = useNavigate();
  const pathParts = location.pathname.split('/').filter(Boolean);
  const objectPage = pathParts[0] === 'object' && pathParts[2] ? { type: pathParts[1], id: decodeURIComponent(pathParts.slice(2).join('/')) } : null;
  const activeSubModule = objectPage ? (lastScreenRef.current || 'home') : (pathParts[0] || 'home');
  if (!objectPage) lastScreenRef.current = activeSubModule;
  const setActiveSubModule = (id) => navigate(!id || id === 'home' ? '/' : `/${id}`);
  const setObjectPage = (o) => {
    if (o) navigate(`/object/${o.type}/${encodeURIComponent(o.id)}`);
    else if (objectPage) navigate(lastScreenRef.current && lastScreenRef.current !== 'home' ? `/${lastScreenRef.current}` : '/');
  };
  const [uxPrefs, setUxPrefs] = useUxPrefs();
  const lang = uxPrefs.lang; // { type: 'invoice' | 'so' | 'po', id }
  const openObject = (type, id) => {
    setObjectPage({ type, id });
    window.scrollTo({ top: 0 });
  };
  const closeObject = () => setObjectPage(null);
  const [expandedModules, setExpandedModules] = useState({
    sales: true,
    finance: true,
    purchase: true,
    master_catalog: true,
    profit_share: true,
    settings: true,
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

  // Core ERP & Master Data Tables
  const [inquiries, setInquiries] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [deliveryNotes, setDeliveryNotes] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [customerCreditLedger, setCustomerCreditLedger] = useState([]);
  const [receiptAllocations, setReceiptAllocations] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [customUoms, setCustomUoms] = useState([]);
  const [numberRanges, setNumberRanges] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [debitNotes, setDebitNotes] = useState([]);
  const [phase2Active, setPhase2Active] = useState(false); // a real ZATCA EGS unit is active (migration 0010)
  const [zatcaBusyId, setZatcaBusyId] = useState(null);

  // Finance & Accounting Tables
  const [glAccounts, setGlAccounts] = useState([]);
  const [glEntries, setGlEntries] = useState([]);
  const [supplierPayments, setSupplierPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [fixedAssets, setFixedAssets] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [bankReconciliations, setBankReconciliations] = useState([]);
  const [glLockDate, setGlLockDate] = useState('');
  const [missingTables, setMissingTables] = useState([]);

  // A4 Document Preview Modals
  const [previewQuotation, setPreviewQuotation] = useState(null);
  const [previewSO, setPreviewSO] = useState(null);
  const [previewDN, setPreviewDN] = useState(null);
  const [previewPO, setPreviewPO] = useState(null);

  // Team / Salesman Creation State
  const [showNewMemberForm, setShowNewMemberForm] = useState(false);
  const [memberCreating, setMemberCreating] = useState(false);
  const [memberFeedback, setMemberFeedback] = useState('');
  const [newMember, setNewMember] = useState({
    full_name: '',
    email: '',
    password: '',
    phone: '',
    role_key: 'sales_mep',
    division: 'MEP',
    is_salesman: true,
    commission_pct: 10,
  });

  // Inline Quick-Create Modals triggered directly from any "+ Create New" field dropdown
  const [quickCreateType, setQuickCreateType] = useState(null); // 'customer' | 'vendor' | 'item' | 'salesman'
  const [quickCust, setQuickCust] = useState({ name_en: '', name_ar: '', customer_type: 'B2B', vat_number: '', cr_number: '', contact_person: '', phone: '', email: '', city: 'Jeddah', address_en: 'Jeddah, KSA' });
  const [quickVend, setQuickVend] = useState({ name_en: '', vendor_origin: 'KSA', vat_number: '', cr_number: '', contact_person: '', phone: '', email: '', country: 'Saudi Arabia', city: 'Jeddah', address: 'Jeddah', default_currency: 'SAR' });
  const [quickItem, setQuickItem] = useState({ item_type: 'Goods', name_en: '', name_ar: '', category: 'MEP', uom: 'PCS', sales_price_sar: '', purchase_price: '', purchase_currency: 'SAR', zatca_vat_type: 'S' });

  // Modals & Drawers
  const [selectedInqId, setSelectedInqId] = useState(null);
  const [showNewInqModal, setShowNewInqModal] = useState(false);
  const [newInq, setNewInq] = useState({
    customerId: '',
    clientName: '',
    clientVat: '',
    contactPerson: '',
    phone: '',
    email: '',
    division: 'MEP',
    salesmanId: '',
    itemId: '',
    firstItemDesc: '',
    firstItemQty: 1,
    firstItemUom: 'PCS',
    firstItemCost: 0,
    firstItemCurrency: 'USD',
  });

  const [deliveryModalSO, setDeliveryModalSO] = useState(null);
  const [deliveryQtys, setDeliveryQtys] = useState({});
  const [deliveryNotesText, setDeliveryNotesText] = useState('');
  const [deliveryWarehouse, setDeliveryWarehouse] = useState('');
  const [deliverySerials, setDeliverySerials] = useState({});
  const [warehouses, setWarehouses] = useState([]);
  const [stockLevels, setStockLevels] = useState([]); // item_stock_v (quantities; value only for cost viewers)
  const [grnModalPO, setGrnModalPO] = useState(null); // {po, warehouse, serials: {lineIndex: text}}
  const [previewInvoice, setPreviewInvoice] = useState(null);

  const [paymentModalInv, setPaymentModalInv] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Bank Transfer');
  const [paymentRef, setPaymentRef] = useState('');

  const [showNewPOModal, setShowNewPOModal] = useState(false);
  const [newPO, setNewPO] = useState({
    soId: '',
    vendorId: '',
    supplierName: '',
    supplierVat: '',
    currency: 'USD',
    fxRate: 3.75,
    landedCostSar: 0,
    itemId: '',
    itemDesc: '',
    itemQty: 1,
    unitCostFx: 0,
    isStockedItem: false,
    supplyType: 'goods',
    lines: [emptyPoLine()], // 0012: multi-line POs
    prId: '',
    paymentTerms: '',
  });
  const [billModalPO, setBillModalPO] = useState(null);
  const [quoteApprovals, setQuoteApprovals] = useState({}); // inquiry id -> approval state (0013)
  const [salesSettings, setSalesSettings] = useState({ minMarginPct: 10, approvalAboveSar: 250000, overdueBlockDays: 90 });
  const [amendSO, setAmendSO] = useState(null);
  const [supplierBills, setSupplierBills] = useState([]);
  const [goodsReceipts, setGoodsReceipts] = useState([]);
  const [requisitions, setRequisitions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [procSettings, setProcSettings] = useState({ managerApprovalAboveSar: 20000, ceoApprovalAboveSar: 100000, priceTolerancePct: 2, qtyTolerancePct: 0 });
  const [importVatForm, setImportVatForm] = useState(null); // customs import VAT (0009)

  const [settingsSavedMsg, setSettingsSavedMsg] = useState('');

  // Hierarchical ERP Navigation Tree
  const fullNavTree = useMemo(
    () => [
      {
        id: 'sales',
        label: '1. Sales & Fulfillment',
        icon: Layers,
        subModules: [
          { id: 'sales_customers', label: 'Customers Master', icon: Users, count: customers.length },
          { id: 'sales_quotes', label: 'Inquiries & Quotes', icon: ClipboardList, count: inquiries.length },
          { id: 'sales_pipeline', label: 'Sales Pipeline', icon: ClipboardList },
          { id: 'sales_orders', label: 'Sales Orders (SO)', icon: ShoppingBag, count: salesOrders.length },
          { id: 'sales_deliveries', label: 'Deliveries (Full/Partial)', icon: Truck, count: deliveryNotes.length },
          { id: 'sales_invoices', label: 'ZATCA Invoices', icon: ReceiptText, count: invoices.length },
          { id: 'sales_credit_notes', label: 'ZATCA Credit Notes', icon: FileMinus, count: creditNotes.length },
        ],
      },
      {
        id: 'projects',
        label: 'Projects, Contracts & Service',
        icon: FolderKanban,
        subModules: [
          { id: 'proj_projects', label: 'Projects & Progress Billing', icon: FolderKanban, count: projects.filter((p) => p.status === 'active').length },
          { id: 'proj_job_cost', label: 'Project Job Cost', icon: LineChart },
          { id: 'proj_contracts', label: 'Service Contracts (AMC)', icon: FileSignature },
          { id: 'proj_tickets', label: 'Service Tickets', icon: Wrench },
        ],
      },
      {
        id: 'finance',
        label: '2. Finance & Collections',
        icon: CreditCard,
        subModules: [
          { id: 'fin_dashboard', label: 'CEO Executive Dashboard', icon: Gauge },
          { id: 'fin_collections', label: 'AR Customer Receipts', icon: HandCoins, count: receipts.length },
          { id: 'fin_supplier_payments', label: 'AP Supplier Payments', icon: Banknote, count: supplierPayments.length },
          { id: 'fin_aging', label: 'AR / AP Aging', icon: CalendarCheck },
          { id: 'fin_statements_of_account', label: 'Customer / Supplier Statements', icon: FileSpreadsheet },
          { id: 'fin_bank_cash', label: 'Bank, Cash & Reconciliation', icon: Landmark },
          { id: 'fin_expenses', label: 'Expense Vouchers & Petty Cash', icon: Wallet, count: expenses.length },
          { id: 'fin_fixed_assets', label: 'Fixed Assets & Depreciation', icon: Building, count: fixedAssets.length },
          { id: 'fin_gl', label: 'General Ledger, CoA & JV', icon: BookOpen, count: glEntries.length },
          { id: 'fin_statements', label: 'P&L & Balance Sheet', icon: Scale },
          { id: 'fin_cash_flow', label: 'Cash Flow Statement', icon: Waves },
          { id: 'fin_budget', label: 'Budget vs Actual', icon: PieChart },
          { id: 'fin_vat_return', label: 'ZATCA VAT Return', icon: Calculator },
          { id: 'fin_profitability', label: 'Deal & Division Profitability', icon: LineChart },
          { id: 'fin_period_close', label: 'Period Lock & Year-End Close', icon: Lock },
          { id: 'fin_zatca_advisor', label: 'ZATCA Wave & VAT', icon: ShieldCheck },
        ],
      },
      {
        id: 'purchase',
        label: '3. Purchase Full Cycle',
        icon: ShoppingBag,
        subModules: [
          { id: 'pur_vendors', label: 'Vendors / Suppliers Master', icon: Building2, count: vendors.length },
          { id: 'pur_requisitions', label: 'Purchase Requisitions', icon: FileText, count: requisitions.filter((r) => r.status === 'open').length },
          { id: 'pur_orders', label: 'Purchase Orders (PO)', icon: FileText, count: purchaseOrders.filter((p) => p.status === 'pending_approval').length || purchaseOrders.filter((p) => p.status === 'po_issued').length },
          { id: 'pur_grn', label: 'Goods Receipt (GRN)', icon: PackageCheck, count: purchaseOrders.filter(openToReceive).length },
          { id: 'pur_bills', label: 'Supplier Bills & Landed Cost', icon: Receipt, count: purchaseOrders.filter(openToBill).length },
        ],
      },
      {
        id: 'master_catalog',
        label: '4. Items & Services Catalog',
        icon: Package,
        subModules: [
          { id: 'cat_items', label: 'Items Master (Goods/Services)', icon: Boxes, count: items.length },
          { id: 'inv_stock', label: 'Inventory & Warehouses', icon: Package },
        ],
      },
      {
        id: 'profit_share',
        label: '5. Sales Profit Share',
        icon: Percent,
        subModules: [
          { id: 'comm_ledger', label: 'Collection Commission Ledger', icon: Percent, count: commissions.length },
        ],
      },
      {
        id: 'settings',
        label: '6. Team & Administration',
        icon: Settings,
        subModules: [
          { id: 'set_salesmen', label: 'Team & Salesmen Master', icon: UserPlus, count: teamProfiles.length },
          { id: 'set_company', label: 'Company & ZATCA Profile', icon: Sliders },
          { id: 'set_zatca_phase2', label: 'ZATCA Phase 2 (Fatoora)', icon: ShieldCheck },
          { id: 'set_num_ranges', label: 'Document Number Ranges', icon: Hash, count: numberRanges.length },
          { id: 'set_audit_log', label: 'Audit Log', icon: History },
          { id: 'set_notifications', label: 'Notifications (reminders)', icon: BellRing },
        ],
      },
    ],
    [customers.length, inquiries.length, salesOrders.length, deliveryNotes.length, invoices.length, receipts.length, vendors.length, purchaseOrders, items.length, commissions.length, teamProfiles.length, numberRanges.length, creditNotes.length, supplierPayments.length, expenses.length, fixedAssets.length, glEntries.length, requisitions]
  );
  // Only the modules this user's role may open (src/lib/permissions.js, mirrors the database rules)
  const navTree = useMemo(() => filterNavTree(profile, fullNavTree), [profile, fullNavTree]);

  const toggleMainModule = (modId) => {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      setExpandedModules((prev) => ({ ...prev, [modId]: true }));
      return;
    }
    setExpandedModules((prev) => ({ ...prev, [modId]: !prev[modId] }));
  };

  const selectSubModule = (modId, subId) => {
    setExpandedModules((prev) => ({ ...prev, [modId]: true }));
    setObjectPage(null);
    setActiveSubModule(subId);
    setMobileDrawerOpen(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) loadProfiles(s.user);
      else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      // Passwords are reset by an administrator (Team & Salesmen -> Reset password). A Supabase recovery link would
      // otherwise sign its holder straight in, so it is closed again without showing any data.
      if (event === 'PASSWORD_RECOVERY') {
        supabase.auth.signOut();
        setSession(null);
        setAuthLoading(false);
        window.alert('Password reset links are not used in this app. Ask your administrator to reset your password.');
        return;
      }
      setSession(s);
      if (s?.user) loadProfiles(s.user);
      else setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfiles = async (user) => {
    const [{ data: all }, roleRes] = await Promise.all([
      // team_profiles_v (0020): everyone sees names and roles; contacts and commission only where the role allows
      supabase.from('team_profiles_v').select('*').order('full_name').then((r) => (r.error ? supabase.from('team_profiles').select('*').order('full_name') : r)),
      supabase.from('user_roles').select('role, division, active').eq('user_id', user.id).maybeSingle(),
    ]);
    if (all) setTeamProfiles(all);
    const me = (all || []).find((p) => p.id === user.id);
    // Roles come from user_roles (0002_roles_rls.sql). Before that migration, fall back to team_profiles.role_key.
    const roleKey = roleRes.error && isMissingObject(roleRes.error)
      ? me?.role_key
      : roleRes.data?.active ? roleRes.data.role : null;
    if (!roleKey || (me && me.active === false)) {
      setProfile(null);
      setNoAccess(true);
    } else {
      const roleMeta = ROLE_OPTIONS.find((r) => r.key === roleKey);
      setNoAccess(false);
      setProfile({
        ...(me || { id: user.id, email: user.email, full_name: user.email.split('@')[0] }),
        role_key: roleKey,
        role_label: roleMeta?.label || roleKey,
        division: roleRes.data?.division ?? me?.division,
      });
    }
    setAuthLoading(false);
  };

  // ---------------- Data loading ----------------
  // One line per table: where to read it (role-aware view first, table as fallback), how to order it
  // (always ending in a unique key so pages never overlap), and where to put it. Every table is read in
  // pages of 1,000 (src/lib/fetchAll.js) so nothing is silently cut off at Supabase's row limit.
  // `gate` skips tables the user's role can't read anyway (saves requests; RLS still applies).
  const isFinanceUser = can(profile, 'finance.post');
  const DATA_TABLES = [
    { key: 'inquiries', view: 'inquiries_v', table: 'inquiries', order: [['updated_at', false], ['id', true]], set: (rows) => setInquiries(rows.map((r) => r.data)) },
    { key: 'sales_orders', view: 'sales_orders_v', table: 'sales_orders', order: [['created_at', false], ['id', true]], set: setSalesOrders },
    { key: 'delivery_notes', view: 'delivery_notes_v', table: 'delivery_notes', order: [['delivered_at', false], ['id', true]], set: setDeliveryNotes },
    { key: 'invoices', view: 'invoices_v', table: 'invoices', order: [['issued_at', false], ['id', true]], set: setInvoices },
    { key: 'purchase_orders', table: 'purchase_orders', order: [['created_at', false], ['id', true]], set: setPurchaseOrders },
    { key: 'customer_receipts', table: 'customer_receipts', order: [['received_at', false], ['id', true]], set: setReceipts },
    { key: 'commission_ledger', view: 'commission_ledger_v', table: 'commission_ledger', order: [['updated_at', false], ['id', true]], set: setCommissions },
    { key: 'team_profiles', view: 'team_profiles_v', table: 'team_profiles', order: [['full_name', true], ['id', true]], set: setTeamProfiles },
    { key: 'customers', table: 'customers', order: [['name_en', true], ['id', true]], set: setCustomers },
    { key: 'vendors', table: 'vendors', order: [['name_en', true], ['id', true]], set: setVendors },
    { key: 'items', view: 'items_v', table: 'items', order: [['name_en', true], ['id', true]], set: setItems },
    { key: 'custom_uoms', table: 'custom_uoms', order: [['code', true]], set: setCustomUoms },
    { key: 'document_number_ranges', table: 'document_number_ranges', order: [['doc_type', true]], set: setNumberRanges },
    { key: 'credit_notes', view: 'credit_notes_v', table: 'credit_notes', order: [['issued_at', false], ['id', true]], set: setCreditNotes },
    { key: 'debit_notes', view: 'debit_notes_v', table: 'debit_notes', order: [['issued_at', false], ['id', true]], set: setDebitNotes, optional: true },
    { key: 'warehouses', table: 'warehouses', order: [['code', true]], set: setWarehouses, optional: true },
    { key: 'supplier_bills', table: 'supplier_bills', order: [['bill_date', false], ['bill_number', false]], set: setSupplierBills, optional: true },
    { key: 'goods_receipts', table: 'goods_receipts', order: [['receipt_date', false], ['grn_number', false]], set: setGoodsReceipts, optional: true },
    { key: 'projects', table: 'projects', order: [['project_code', false]], set: setProjects, optional: true, gate: can(profile, 'project.view') },
    { key: 'purchase_requisitions', table: 'purchase_requisitions', order: [['created_at', false], ['id', true]], set: setRequisitions, optional: true },
    { key: 'item_stock', view: 'item_stock_v', table: 'item_stock_v', order: [['item_id', true], ['warehouse', true]], set: setStockLevels, optional: true },
    { key: 'gl_accounts', table: 'gl_accounts', order: [['account_code', true]], set: setGlAccounts },
    { key: 'gl_journal_entries', table: 'gl_journal_entries', order: [['entry_date', false], ['created_at', false], ['id', true]], set: setGlEntries, gate: isFinanceUser },
    { key: 'supplier_payments', table: 'supplier_payments', order: [['payment_date', false], ['id', true]], set: setSupplierPayments },
    { key: 'expense_vouchers', table: 'expense_vouchers', order: [['expense_date', false], ['id', true]], set: setExpenses, gate: isFinanceUser },
    { key: 'fixed_assets', table: 'fixed_assets', order: [['acquisition_date', false], ['id', true]], set: setFixedAssets, gate: isFinanceUser },
    { key: 'gl_budgets', table: 'gl_budgets', order: [['account_code', true], ['id', true]], set: setBudgets, gate: isFinanceUser },
    { key: 'bank_reconciliations', table: 'bank_reconciliations', order: [['statement_date', false], ['id', true]], set: setBankReconciliations, gate: isFinanceUser },
    { key: 'customer_credit_ledger', table: 'customer_credit_ledger', order: [['entry_date', false], ['id', true]], set: setCustomerCreditLedger, optional: true },
    { key: 'receipt_allocations', table: 'receipt_allocations', order: [['id', true]], set: setReceiptAllocations, optional: true },
  ];
  // Tables whose absence means the schema scripts weren't run (shown as a warning to Finance)
  const REQUIRED_TABLES = ['sales_orders', 'invoices', 'purchase_orders', 'customer_receipts', 'customers', 'gl_accounts',
    'gl_journal_entries', 'supplier_payments', 'expense_vouchers', 'fixed_assets', 'gl_budgets', 'bank_reconciliations'];

  const orderedQuery = (source, order) => {
    let q = supabase.from(source).select('*');
    order.forEach(([col, asc]) => { q = q.order(col, { ascending: asc }); });
    return q;
  };

  // Load one table completely; returns 'missing' | 'error' | 'ok'
  const loadTable = async (cfg) => {
    if (cfg.gate === false) {
      cfg.set([]);
      return 'ok';
    }
    let res = cfg.view ? await fetchAllRows(() => orderedQuery(cfg.view, cfg.order)) : { error: { code: 'PGRST205' } };
    if (res.error && isMissingObject(res.error)) res = await fetchAllRows(() => orderedQuery(cfg.table, cfg.order));
    if (res.error) {
      if (isMissingObject(res.error)) {
        cfg.set([]);
        return 'missing';
      }
      console.error(`Loading ${cfg.key} failed`, { code: res.error.code, message: res.error.message }); // no row details: they can hold personal data
      return 'error'; // keep what's on screen
    }
    cfg.set(res.data);
    return 'ok';
  };

  const loadSettings = async () => {
    const { data } = await supabase.from('app_settings').select('*');
    if (!data) return;
    const fxRow = data.find((r) => r.key === 'fx_rates');
    const compRow = data.find((r) => r.key === 'company_profile');
    if (fxRow?.value) setFxRates(fxRow.value);
    if (compRow?.value) setCompany({ ...DEFAULT_COMPANY, ...compRow.value });
    const lockRow = data.find((r) => r.key === 'gl_period_lock');
    setGlLockDate(lockRow?.value?.lockDate || '');
    const procRow = data.find((r) => r.key === 'procurement_settings');
    if (procRow?.value) setProcSettings((prev) => ({ ...prev, ...procRow.value }));
    const salesRow = data.find((r) => r.key === 'sales_settings');
    if (salesRow?.value) setSalesSettings((prev) => ({ ...prev, ...salesRow.value }));
    const { data: appr, error: apprErr } = await supabase.rpc('quote_approvals');
    if (!apprErr && Array.isArray(appr)) setQuoteApprovals(Object.fromEntries(appr.map((a) => [a.inquiry_id, a])));
    const { data: active, error: p2err } = await supabase.rpc('zatca_phase2_active');
    setPhase2Active(!p2err && active === true);
  };

  const refreshAllErpData = async () => {
    setSyncStatus('syncing');
    const [, ...results] = await Promise.all([loadSettings(), ...DATA_TABLES.map(loadTable)]);
    const missing = DATA_TABLES.filter((cfg, i) => results[i] === 'missing' && REQUIRED_TABLES.includes(cfg.key)).map((cfg) => cfg.key);
    setMissingTables(missing);
    setSyncStatus(results.includes('error') ? 'error' : 'live');
  };

  // Reload only the tables a change touched (realtime), coalescing bursts of changes
  const pendingReloads = useRef(new Set());
  const reloadTimer = useRef(null);
  const queueTableReload = (table) => {
    pendingReloads.current.add(table);
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(async () => {
      const tables = Array.from(pendingReloads.current);
      pendingReloads.current.clear();
      setSyncStatus('syncing');
      const jobs = [];
      if (tables.includes('app_settings') || tables.includes('gl_period_locks')) jobs.push(loadSettings());
      DATA_TABLES.filter((cfg) => tables.includes(cfg.table)).forEach((cfg) => jobs.push(loadTable(cfg)));
      await Promise.all(jobs);
      setSyncStatus('live');
    }, 400);
  };

  useEffect(() => {
    // wait for the role: what we load (and skip) depends on it
    if (!session || !profile?.role_key) return;
    refreshAllErpData();

    const channel = supabase
      .channel('horizon-erp-discovery')
      .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
        if (payload?.table) queueTableReload(payload.table);
        else refreshAllErpData();
      })
      .subscribe();

    return () => {
      clearTimeout(reloadTimer.current);
      supabase.removeChannel(channel);
    };
  }, [session, profile?.role_key]);

  const salesmenList = useMemo(
    () => teamProfiles.filter((p) => p.is_salesman || ['sales_mep', 'sales_it', 'manager'].includes(p.role_key)),
    [teamProfiles]
  );

  // Formatted Options for SmartEntitySelect across every field
  const customerSelectOptions = useMemo(
    () =>
      customers.map((c) => ({
        id: c.id,
        badge: c.customer_code,
        label: c.name_en,
        sublabel: [c.name_ar, c.customer_type, `VAT: ${c.vat_number || 'N/A'}`, c.phone].filter(Boolean).join(' • '),
        rightMeta: c.city,
      })),
    [customers]
  );

  const vendorSelectOptions = useMemo(
    () =>
      vendors.map((v) => ({
        id: v.id,
        badge: v.vendor_code,
        label: v.name_en,
        sublabel: `${v.vendor_origin} • ${v.contact_person} • ${v.phone}`,
        rightMeta: v.default_currency,
      })),
    [vendors]
  );

  const itemSelectOptions = useMemo(
    () =>
      items.map((it) => ({
        id: it.id,
        badge: it.item_code,
        label: `${it.name_en} (${it.uom})`,
        sublabel: [it.name_ar, it.item_type, `ZATCA VAT: ${it.zatca_vat_type}`].filter(Boolean).join(' • '),
        rightMeta: `SAR ${formatSAR(it.sales_price_sar)}`,
      })),
    [items]
  );

  const salesmanSelectOptions = useMemo(
    () =>
      salesmenList.map((s) => ({
        id: s.id,
        badge: s.division || 'SALES',
        label: s.full_name,
        sublabel: [s.role_label, s.email].filter(Boolean).join(' • '),
        rightMeta: s.commission_pct == null ? '' : `${s.commission_pct}% Share`,
      })),
    [salesmenList]
  );

  const salesOrderSelectOptions = useMemo(
    () =>
      salesOrders.map((so) => ({
        id: so.id,
        badge: so.so_number,
        label: so.client_name,
        sublabel: `Status: ${so.status} • Salesman: ${so.salesman_name}`,
        rightMeta: `SAR ${formatSAR(so.grand_total_sar)}`,
      })),
    [salesOrders]
  );

  const annualTaxableRevenueSAR = useMemo(
    () => invoices.reduce((sum, inv) => sum + Number(inv.subtotal_sar || 0), 0),
    [invoices]
  );
  // Wave check uses the revenue per year entered in Company & ZATCA Profile; until then, this year's invoiced sales
  const zatcaAdvice = useMemo(() => {
    const byYear = company.taxableRevenueByYear || {};
    const entered = Object.values(byYear).some((v) => Number(v) > 0);
    return getZatcaComplianceAdvice(entered ? byYear : annualTaxableRevenueSAR, phase2Active);
  }, [annualTaxableRevenueSAR, phase2Active, company.taxableRevenueByYear]);

  /* ---------------- Launchpad: live KPIs per app, insights & notifications ---------------- */
  const openApp = (subId) => {
    const parent = navTree.find((m) => m.subModules.some((s) => s.id === subId));
    if (parent) selectSubModule(parent.id, subId);
    window.scrollTo({ top: 0 });
  };

  const compactNum = (n) =>
    new Intl.NumberFormat(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0);

  const financeKpis = useMemo(() => {
    const now = new Date();
    const ym = now.toISOString().slice(0, 7);
    const year = String(now.getFullYear());
    const daysOld = (d) => (d ? Math.floor((now - new Date(d)) / 86400000) : 0);
    const activeGl = glEntries.filter((e) => e.status !== 'void');
    const sumGl = (pred) =>
      activeGl.reduce((s, e) => s + (e.lines || []).reduce((a, l) => (pred(String(l.account_code || ''), e) ? a + Number(l.debit || 0) - Number(l.credit || 0) : a), 0), 0);

    const openInvoices = invoices.filter((i) => invoiceOpenSar(i) > 0.01);
    const arOpen = openInvoices.reduce((s, i) => s + invoiceOpenSar(i), 0);
    // 0013: overdue = past the invoice's due date (payment terms), not 30 days from issue
    const overdue = openInvoices.filter((i) => (i.due_date ? new Date(`${i.due_date}T23:59:59+03:00`) < new Date() : daysOld(i.issued_at || i.created_at) > 30));
    const billedPOs = purchaseOrders.filter((p) => (['billed', 'partially_billed'].includes(p.status) || ['posted', 'partial'].includes(p.bill_status)) && p.payment_status !== 'paid' && p.bill_status !== 'paid');
    const apOpen = billedPOs.reduce(
      (s, p) => s + Math.max(0, Number(p.total_landed_sar || 0) + Number(p.input_vat_sar ?? p.supplier_vat_sar ?? 0) - Number(p.paid_amount_sar || 0)),
      0
    );
    const cash = sumGl((c) => c.length === 4 && c >= '1010' && c <= '1099');
    const ytdRevenue =
      invoices.filter((i) => String(i.issued_at || '').startsWith(year)).reduce((s, i) => s + Number(i.subtotal_sar || 0), 0) -
      creditNotes.filter((c) => String(c.issued_at || '').startsWith(year)).reduce((s, c) => s + Number(c.subtotal_sar || 0), 0);
    const ytdCogs = invoices.filter((i) => String(i.issued_at || '').startsWith(year)).reduce((s, i) => s + Number(i.landed_cost_sar || 0), 0);
    const glNetProfit = -sumGl((c, e) => (c.startsWith('4') || c.startsWith('5')) && String(e.entry_date || '').startsWith(year) && e.source_module !== 'YEAR_END_CLOSE');
    const outputVat = invoices.reduce((s, i) => s + Number(i.vat_sar || 0), 0) - creditNotes.reduce((s, c) => s + Number(c.vat_sar || 0), 0);
    const inputVat =
      purchaseOrders.filter((p) => p.is_ksa_vat_recoverable !== false).reduce((s, p) => s + Number(p.input_vat_sar || 0), 0) +
      expenses.filter((e) => e.status !== 'void' && e.vat_recoverable).reduce((s, e) => s + Number(e.vat_sar || 0), 0);
    const monthExpenses = expenses.filter((e) => e.status !== 'void' && String(e.expense_date || '').startsWith(ym)).reduce((s, e) => s + Number(e.total_sar || 0), 0);
    const monthReceipts = receipts.filter((r) => String(r.received_at || r.created_at || '').startsWith(ym)).reduce((s, r) => s + Number(r.amount_sar || 0), 0);
    const nbv = fixedAssets.filter((a) => a.status !== 'disposed').reduce((s, a) => s + Number(a.cost_sar || 0) - Number(a.accumulated_depreciation_sar || 0), 0);
    const readyPayout = commissions.filter((c) => c.status === 'ready_for_payout');

    return {
      openInvoices, arOpen, overdue, billedPOs, apOpen, cash, ytdRevenue, ytdCogs, glNetProfit,
      netVat: outputVat - inputVat, monthExpenses, monthReceipts, nbv, readyPayout,
      grossMarginPct: ytdRevenue > 0 ? ((ytdRevenue - ytdCogs) / ytdRevenue) * 100 : 0,
      openSOs: salesOrders.filter((s) => s.status !== 'delivered'),
      awaitingBill: purchaseOrders.filter(openToBill),
    };
  }, [invoices, creditNotes, purchaseOrders, glEntries, expenses, receipts, fixedAssets, commissions, salesOrders]);

  const launchpadGroups = useMemo(() => {
    const k = financeKpis;
    const sar = (n) => `SAR ${compactNum(n)}`;
    const tileData = {
      sales_customers: { value: customers.length, unit: t(lang, 'tile.records') },
      sales_quotes: { value: inquiries.length, unit: t(lang, 'tile.records') },
      sales_orders: { value: k.openSOs.length, unit: `${t(lang, 'tile.open')} • ${sar(k.openSOs.reduce((s, o) => s + Number(o.grand_total_sar || 0), 0))}` },
      sales_deliveries: { value: deliveryNotes.length, unit: t(lang, 'tile.records') },
      sales_invoices: { value: k.openInvoices.length, unit: `${t(lang, 'tile.open')} • ${sar(k.arOpen)}`, tone: k.overdue.length ? 'critical' : 'info' },
      sales_credit_notes: { value: creditNotes.length, unit: t(lang, 'tile.records') },
      fin_dashboard: { value: compactNum(k.ytdRevenue), unit: 'SAR • YTD', tone: 'positive' },
      fin_collections: { value: compactNum(k.monthReceipts), unit: 'SAR • MTD', tone: 'positive' },
      fin_supplier_payments: { value: compactNum(k.apOpen), unit: `SAR ${t(lang, 'tile.open')}`, tone: k.apOpen > 0 ? 'critical' : 'neutral' },
      fin_aging: { value: k.overdue.length, unit: `${t(lang, 'tile.overdue')} > 30d`, tone: k.overdue.length ? 'negative' : 'positive' },
      fin_statements_of_account: { value: '' },
      fin_bank_cash: { value: compactNum(k.cash), unit: 'SAR', tone: k.cash < 0 ? 'negative' : 'positive' },
      fin_expenses: { value: compactNum(k.monthExpenses), unit: 'SAR • MTD', tone: 'neutral' },
      fin_fixed_assets: { value: compactNum(k.nbv), unit: 'SAR NBV', tone: 'neutral' },
      fin_gl: { value: glEntries.length, unit: t(lang, 'tile.entries') },
      fin_statements: { value: compactNum(k.glNetProfit), unit: 'SAR • Net YTD', tone: k.glNetProfit < 0 ? 'negative' : 'positive' },
      fin_cash_flow: { value: '' },
      fin_budget: { value: budgets.length || '', unit: budgets.length ? t(lang, 'tile.records') : '' },
      fin_vat_return: { value: compactNum(k.netVat), unit: 'SAR VAT', tone: k.netVat > 0 ? 'critical' : 'positive' },
      fin_profitability: { value: `${k.grossMarginPct.toFixed(1)}%`, unit: 'Gross margin', tone: k.grossMarginPct < 10 ? 'critical' : 'positive' },
      fin_period_close: { value: '', subtitle: glLockDate ? `🔒 ${glLockDate}` : '' },
      fin_zatca_advisor: { value: '', subtitle: zatcaAdvice.wave },
      pur_vendors: { value: vendors.length, unit: t(lang, 'tile.records') },
      pur_orders: { value: purchaseOrders.filter((p) => p.status === 'pending_approval').length || purchaseOrders.filter((p) => p.status === 'po_issued').length, unit: purchaseOrders.some((p) => p.status === 'pending_approval') ? 'to approve' : t(lang, 'tile.open'), tone: purchaseOrders.some((p) => p.status === 'pending_approval') ? 'critical' : undefined },
      pur_requisitions: { value: requisitions.filter((r) => r.status === 'open').length, unit: t(lang, 'tile.open') },
      pur_grn: { value: k.awaitingBill.length, unit: 'awaiting bill', tone: k.awaitingBill.length ? 'critical' : 'neutral' },
      pur_bills: { value: k.billedPOs.length, unit: 'unpaid', tone: k.billedPOs.length ? 'critical' : 'neutral' },
      cat_items: { value: items.length, unit: t(lang, 'tile.records') },
      inv_stock: { value: stockLevels.filter((x) => Number(x.qty) < 0).length || '', unit: stockLevels.some((x) => Number(x.qty) < 0) ? 'negative' : '', tone: stockLevels.some((x) => Number(x.qty) < 0) ? 'negative' : 'neutral' },
      comm_ledger: { value: compactNum(k.readyPayout.reduce((s, c) => s + Number(c.unlocked_commission_sar || 0), 0)), unit: 'SAR ready', tone: 'positive' },
      set_salesmen: { value: teamProfiles.length, unit: t(lang, 'tile.records') },
      set_company: { value: '' },
      set_zatca_phase2: { value: phase2Active ? 'ON' : 'OFF', tone: phase2Active ? 'positive' : 'critical' },
      set_num_ranges: { value: numberRanges.length, unit: t(lang, 'tile.records') },
      set_audit_log: { value: '', subtitle: lang === 'ar' ? 'من غيّر ماذا ومتى' : 'Who changed what, when' },
    };
    return navTree.map((mod) => ({
      id: mod.id,
      icon: mod.icon,
      title: t(lang, `nav.${mod.id}`, mod.label),
      tiles: mod.subModules.map((sub) => ({
        id: sub.id,
        title: t(lang, `nav.${sub.id}`, sub.label),
        icon: sub.icon,
        ...tileData[sub.id],
        onClick: () => openApp(sub.id),
      })),
    }));
  }, [navTree, financeKpis, lang, customers.length, inquiries.length, deliveryNotes.length, creditNotes.length, glEntries.length, budgets.length, glLockDate, zatcaAdvice.wave, vendors.length, purchaseOrders, items.length, teamProfiles.length, numberRanges.length]);

  const launchpadInsights = useMemo(() => {
    const k = financeKpis;
    return [
      { id: 'rev', label: lang === 'ar' ? 'الإيرادات منذ بداية السنة' : 'Revenue YTD', value: `SAR ${compactNum(k.ytdRevenue)}`, tone: 'info', footer: `${k.grossMarginPct.toFixed(1)}% gross margin`, trend: k.grossMarginPct >= 0 ? 'up' : 'down', onClick: () => openApp('fin_dashboard') },
      { id: 'ar', label: lang === 'ar' ? 'الذمم المدينة المفتوحة' : 'Open Receivables', value: `SAR ${compactNum(k.arOpen)}`, tone: k.overdue.length ? 'critical' : 'neutral', footer: `${k.overdue.length} ${t(lang, 'tile.overdue')} > 30d`, onClick: () => openApp('fin_aging') },
      { id: 'cash', label: lang === 'ar' ? 'النقدية والبنوك' : 'Cash & Bank', value: `SAR ${compactNum(k.cash)}`, tone: k.cash < 0 ? 'negative' : 'positive', footer: `AP open SAR ${compactNum(k.apOpen)}`, onClick: () => openApp('fin_bank_cash') },
      { id: 'vat', label: lang === 'ar' ? 'صافي ضريبة القيمة المضافة' : 'Net VAT Payable', value: `SAR ${compactNum(k.netVat)}`, tone: k.netVat > 0 ? 'critical' : 'positive', footer: 'Output − input VAT', onClick: () => openApp('fin_vat_return') },
    ].filter((ins) => canOpen(profile, { rev: 'fin_dashboard', ar: 'fin_aging', cash: 'fin_bank_cash', vat: 'fin_vat_return' }[ins.id]));
  }, [financeKpis, lang, profile]);

  const shellNotifications = useMemo(() => {
    const k = financeKpis;
    const list = [];
    const allowed = (app) => canOpen(profile, app);
    if (missingTables.length && allowed('set_company')) list.push({ id: 'schema', tone: 'negative', text: t(lang, 'notif.schema', '', { n: missingTables.length }) });
    if (k.overdue.length && allowed('fin_aging')) list.push({ id: 'overdue', tone: 'negative', text: t(lang, 'notif.overdueInvoices', '', { n: k.overdue.length }), onClick: () => openApp('fin_aging') });
    if (k.awaitingBill.length && allowed('pur_grn')) list.push({ id: 'grn', tone: 'critical', text: t(lang, 'notif.unbilledGrn', '', { n: k.awaitingBill.length }), onClick: () => openApp('pur_grn') });
    if (k.billedPOs.length && allowed('fin_supplier_payments')) list.push({ id: 'ap', tone: 'critical', text: t(lang, 'notif.payablesDue', '', { n: k.billedPOs.length }), onClick: () => openApp('fin_supplier_payments') });
    if (k.readyPayout.length && allowed('comm_ledger')) list.push({ id: 'comm', tone: 'info', text: t(lang, 'notif.readyPayout', '', { n: k.readyPayout.length }), onClick: () => openApp('comm_ledger') });
    return list;
  }, [financeKpis, missingTables.length, lang, profile]);

  // Every business event is one database function (supabase/migrations/0004_posting.sql): it checks the role,
  // computes totals / VAT / numbers, and writes the document + journal + side effects in one transaction.
  // Returns the function's result, or null after telling the user why it was refused.
  const callPosting = async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      const missing = isMissingObject(error);
      alert(missing
        ? `This action needs database update 0004_posting.sql, which hasn't been applied yet. Ask your administrator to run it. (${fn})`
        : error.message);
      return null;
    }
    return data;
  };

  const userCanViewCost = canViewCost(profile);
  const itemsById = Object.fromEntries(items.map((it) => [it.id, it]));
  const isAdminUser = profile?.role_key === 'admin';
  const userCanPriceQuotes = canPriceQuotes(profile);
  const selectedInq = inquiries.find((i) => i.id === selectedInqId) || null;

  const activeParent = navTree.find((m) => m.subModules.some((s) => s.id === activeSubModule));
  const activeSub = activeParent?.subModules.find((s) => s.id === activeSubModule);
  const isHome = activeSubModule === 'home';
  const view = objectPage ? '__object__' : canOpen(profile, activeSubModule) ? activeSubModule : '__restricted__';
  const objInvoice = objectPage?.type === 'invoice' ? invoices.find((x) => x.id === objectPage.id) : null;
  const objSO = objectPage?.type === 'so' ? salesOrders.find((x) => x.id === objectPage.id) : null;
  const objPO = objectPage?.type === 'po' ? purchaseOrders.find((x) => x.id === objectPage.id) : null;
  const goHome = () => {
    setObjectPage(null);
    setActiveSubModule('home');
    setMobileDrawerOpen(false);
    window.scrollTo({ top: 0 });
  };


  return {
    DATA_TABLES,
    REQUIRED_TABLES,
    activeParent,
    activeSub,
    activeSubModule,
    amendSO,
    annualTaxableRevenueSAR,
    authLoading,
    bankReconciliations,
    billModalPO,
    budgets,
    callPosting,
    closeObject,
    commissions,
    compactNum,
    company,
    creditNotes,
    customUoms,
    customerCreditLedger,
    customerSelectOptions,
    customers,
    debitNotes,
    deliveryModalSO,
    deliveryNotes,
    deliveryNotesText,
    deliveryQtys,
    deliverySerials,
    deliveryWarehouse,
    expandedModules,
    expenses,
    financeKpis,
    fixedAssets,
    fullNavTree,
    fxRates,
    glAccounts,
    glEntries,
    glLockDate,
    globalSearchOpen,
    goHome,
    goodsReceipts,
    grnModalPO,
    importVatForm,
    inquiries,
    inquirySaveSeq,
    invoices,
    isAdminUser,
    isFinanceUser,
    isHome,
    itemSelectOptions,
    items,
    itemsById,
    lang,
    launchpadGroups,
    launchpadInsights,
    loadProfiles,
    loadSettings,
    loadTable,
    location,
    memberCreating,
    memberFeedback,
    missingTables,
    mobileDrawerOpen,
    navTree,
    navigate,
    newInq,
    newMember,
    newPO,
    noAccess,
    numberRanges,
    objInvoice,
    objPO,
    objSO,
    objectPage,
    openApp,
    openObject,
    orderedQuery,
    paymentAmount,
    paymentMethod,
    paymentModalInv,
    paymentRef,
    pendingReloads,
    phase2Active,
    previewDN,
    previewInvoice,
    previewPO,
    previewQuotation,
    previewSO,
    procSettings,
    profile,
    projects,
    purchaseOrders,
    queueTableReload,
    quickCreateType,
    quickCust,
    quickItem,
    quickVend,
    quoteApprovals,
    receiptAllocations,
    receipts,
    refreshAllErpData,
    reloadTimer,
    requisitions,
    salesOrderSelectOptions,
    salesOrders,
    salesSettings,
    salesmanSelectOptions,
    salesmenList,
    selectSubModule,
    selectedInq,
    selectedInqId,
    session,
    setActiveSubModule,
    setAmendSO,
    setAuthLoading,
    setBankReconciliations,
    setBillModalPO,
    setBudgets,
    setCommissions,
    setCompany,
    setCreditNotes,
    setCustomUoms,
    setCustomerCreditLedger,
    setCustomers,
    setDebitNotes,
    setDeliveryModalSO,
    setDeliveryNotes,
    setDeliveryNotesText,
    setDeliveryQtys,
    setDeliverySerials,
    setDeliveryWarehouse,
    setExpandedModules,
    setExpenses,
    setFixedAssets,
    setFxRates,
    setGlAccounts,
    setGlEntries,
    setGlLockDate,
    setGlobalSearchOpen,
    setGoodsReceipts,
    setGrnModalPO,
    setImportVatForm,
    setInquiries,
    setInvoices,
    setItems,
    setMemberCreating,
    setMemberFeedback,
    setMissingTables,
    setMobileDrawerOpen,
    setNewInq,
    setNewMember,
    setNewPO,
    setNoAccess,
    setNumberRanges,
    setObjectPage,
    setPaymentAmount,
    setPaymentMethod,
    setPaymentModalInv,
    setPaymentRef,
    setPhase2Active,
    setPreviewDN,
    setPreviewInvoice,
    setPreviewPO,
    setPreviewQuotation,
    setPreviewSO,
    setProcSettings,
    setProfile,
    setProjects,
    setPurchaseOrders,
    setQuickCreateType,
    setQuickCust,
    setQuickItem,
    setQuickVend,
    setQuoteApprovals,
    setReceiptAllocations,
    setReceipts,
    setRequisitions,
    setSalesOrders,
    setSalesSettings,
    setSelectedInqId,
    setSession,
    setSettingsSavedMsg,
    setShowNewInqModal,
    setShowNewMemberForm,
    setShowNewPOModal,
    setSidebarCollapsed,
    setStockLevels,
    setSupplierBills,
    setSupplierPayments,
    setSyncStatus,
    setTeamProfiles,
    setUxPrefs,
    setVendors,
    setWarehouses,
    setZatcaBusyId,
    settingsSavedMsg,
    shellNotifications,
    showNewInqModal,
    showNewMemberForm,
    showNewPOModal,
    sidebarCollapsed,
    stockLevels,
    supplierBills,
    supplierPayments,
    syncStatus,
    teamProfiles,
    toggleMainModule,
    userCanPriceQuotes,
    userCanViewCost,
    uxPrefs,
    vendorSelectOptions,
    vendors,
    view,
    warehouses,
    zatcaAdvice,
    zatcaBusyId,
  };
}

export function useErpStore() {
  const core = useErpCore();
  const withSales = { ...core, ...useSalesActions(core) };
  const withPurchase = { ...withSales, ...usePurchaseActions(withSales) };
  return { ...withPurchase, ...useAdminActions(withPurchase) };
}
