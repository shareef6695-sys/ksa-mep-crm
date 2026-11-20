import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Plus, AlertTriangle, Building2, X,
  Lock, Eye, EyeOff, LogOut, RefreshCw, ArrowRight, Layers,
  Truck, Receipt, ShoppingBag, Percent, Settings, Printer, QrCode,
  ChevronDown, ChevronRight, Menu, PanelLeftClose, PanelLeftOpen,
  FileText, CreditCard, PackageCheck, Users, Sliders, Package, Search, UserPlus
} from 'lucide-react';
import { generateZatcaQrBase64, getZatcaComplianceAdvice, formatSAR } from './erp/erpEngine';
import { CustomersMasterView, VendorsMasterView, ItemsMasterView, STANDARD_UOMS, ZATCA_VAT_TYPES } from './erp/MasterDataViews';
import { SmartEntitySelect, GlobalSmartDiscoveryModal } from './erp/SmartDiscovery';
import { NumberRangesView } from './erp/NumberRangesView';
import { CreditNotesView } from './erp/CreditNotesView';

const SUPABASE_URL = 'https://jknuhynysewoizjxbidw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprbnVoeW55c2V3b2l6anhiaWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxODgwMDMsImV4cCI6MjExMDc2NDAwM30.cM0tm_pnvgIN40MYrIB92RR4g4bLvFQx415hvOWuLsU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Secondary non-persistent client so Admins can create new Salesman/Team logins without logging themselves out
const supabaseProvisioner = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const CURRENCIES = ['SAR', 'USD', 'EUR', 'GBP', 'AED'];
const DEFAULT_FX = { SAR: 1, USD: 3.75, EUR: 4.08, GBP: 4.78, AED: 1.021 };

const DEFAULT_COMPANY = {
  nameEn: 'Horizon Business Solutions Est.',
  nameAr: 'مؤسسة حلول الأفق للأعمال',
  vatNumber: '300000000000003',
  crNumber: '4030000000',
  city: 'Jeddah',
  addressEn: 'Jeddah, Kingdom of Saudi Arabia',
  addressAr: 'جدة، المملكة العربية السعودية',
  phone: '+966 12 000 0000',
  email: 'info@horizon-ksa.com',
  zatcaPhase2Connected: false,
};

const ROLE_OPTIONS = [
  { key: 'sales_mep', label: 'Sales Executive (MEP)', isSalesman: true },
  { key: 'sales_it', label: 'Sales Executive (IT & ELV)', isSalesman: true },
  { key: 'manager', label: 'Sales Manager', isSalesman: true },
  { key: 'procurement', label: 'Procurement & Logistics Officer', isSalesman: false },
  { key: 'finance', label: 'Finance & ZATCA Accountant', isSalesman: false },
  { key: 'admin', label: 'System Administrator', isSalesman: false },
];

const computeQuoteFinancials = (inquiry, fxRates) => {
  const totalCostSAR = (inquiry.boqItems || []).reduce((sum, item) => {
    const rate = fxRates[item.buyCurrency] || 1;
    return sum + (Number(item.qty) || 0) * (Number(item.buyUnitCost) || 0) * rate;
  }, 0);
  const margin = Number(inquiry.marginPercent) || 0;
  const sellNetSAR = margin >= 100 ? totalCostSAR : totalCostSAR / (1 - margin / 100);
  const profitSAR = sellNetSAR - totalCostSAR;
  const vatSAR = sellNetSAR * 0.15;
  const grandTotalSAR = sellNetSAR + vatSAR;
  return { totalCostSAR, sellNetSAR, profitSAR, vatSAR, grandTotalSAR };
};

function LoginLandingPage({ company, onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSignIn = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) setErrorMsg(error.message || 'Invalid credentials.');
      else if (data?.user) onLoginSuccess(data.user);
    } catch {
      setErrorMsg('Unable to connect to authentication server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col lg:flex-row">
      <div className="lg:w-7/12 p-6 sm:p-10 lg:p-16 flex flex-col justify-between bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 border-b lg:border-b-0 lg:border-r border-slate-800">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-400/20 text-blue-300 text-[11px] font-semibold uppercase mb-4 sm:mb-8">
            <Building2 className="w-3.5 h-3.5" /> KSA Enterprise Resource Planning (ERP)
          </div>
          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight">{company.nameEn}</h1>
          <p className="text-base sm:text-xl text-blue-300 font-semibold mt-1">{company.nameAr}</p>
          <p className="mt-3 text-sm sm:text-base text-slate-300 max-w-xl leading-relaxed">
            Integrated Master Data, Sales Orders, Partial/Full Deliveries, ZATCA E-Invoicing, Multi-Currency Purchase Cycle &amp; Collection-Based Profit Share.
          </p>
        </div>
        <div className="hidden lg:flex mt-12 pt-6 border-t border-slate-800/80 items-center justify-between text-xs text-slate-500">
          <span>© {new Date().getFullYear()} {company.nameEn}</span>
          <span>VAT: {company.vatNumber} • CR: {company.crNumber}</span>
        </div>
      </div>

      <div className="flex-1 lg:w-5/12 p-5 sm:p-10 lg:p-16 flex items-center justify-center bg-slate-950">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="w-11 h-11 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-4">
            <Lock className="w-5 h-5" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white">ERP Staff Sign In</h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">Sign in with your corporate credentials.</p>

          {errorMsg && (
            <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSignIn} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Work Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@horizon-ksa.com"
                className="w-full px-3.5 py-3 bg-slate-950 border border-slate-700 rounded-xl text-base sm:text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-3.5 pr-12 py-3 bg-slate-950 border border-slate-700 rounded-xl text-base sm:text-sm text-white focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 p-1"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <>Sign In to ERP <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [teamProfiles, setTeamProfiles] = useState([]);
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [fxRates, setFxRates] = useState(DEFAULT_FX);
  const [syncStatus, setSyncStatus] = useState('connecting');

  // Navigation & Global Smart Search
  const [activeSubModule, setActiveSubModule] = useState('sales_quotes');
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
  const [commissions, setCommissions] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [customUoms, setCustomUoms] = useState([]);
  const [numberRanges, setNumberRanges] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);

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
  });

  const [settingsSavedMsg, setSettingsSavedMsg] = useState('');

  // Hierarchical ERP Navigation Tree
  const navTree = useMemo(
    () => [
      {
        id: 'sales',
        label: '1. Sales & Fulfillment',
        icon: Layers,
        subModules: [
          { id: 'sales_customers', label: 'Customers Master', icon: Users, count: customers.length },
          { id: 'sales_quotes', label: 'Inquiries & Quotes', icon: FileText, count: inquiries.length },
          { id: 'sales_orders', label: 'Sales Orders (SO)', icon: ShoppingBag, count: salesOrders.length },
          { id: 'sales_deliveries', label: 'Deliveries (Full/Partial)', icon: Truck, count: deliveryNotes.length },
          { id: 'sales_invoices', label: 'ZATCA Invoices', icon: Receipt, count: invoices.length },
          { id: 'sales_credit_notes', label: 'ZATCA Credit Notes', icon: FileText, count: creditNotes.length },
        ],
      },
      {
        id: 'finance',
        label: '2. Finance & Collections',
        icon: CreditCard,
        subModules: [
          { id: 'fin_collections', label: 'AR Customer Receipts', icon: CreditCard, count: receipts.length },
          { id: 'fin_zatca_advisor', label: 'ZATCA Wave & VAT', icon: QrCode },
        ],
      },
      {
        id: 'purchase',
        label: '3. Purchase Full Cycle',
        icon: ShoppingBag,
        subModules: [
          { id: 'pur_vendors', label: 'Vendors / Suppliers Master', icon: Building2, count: vendors.length },
          { id: 'pur_orders', label: 'Purchase Orders (PO)', icon: FileText, count: purchaseOrders.filter((p) => p.status === 'po_issued').length },
          { id: 'pur_grn', label: 'Goods Receipt (GRN)', icon: PackageCheck, count: purchaseOrders.filter((p) => p.status === 'grn_completed').length },
          { id: 'pur_bills', label: 'Supplier Bills & Landed Cost', icon: Receipt, count: purchaseOrders.filter((p) => p.status === 'billed').length },
        ],
      },
      {
        id: 'master_catalog',
        label: '4. Items & Services Catalog',
        icon: Package,
        subModules: [
          { id: 'cat_items', label: 'Items Master (Goods/Services)', icon: Package, count: items.length },
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
          { id: 'set_num_ranges', label: 'Document Number Ranges', icon: FileText, count: numberRanges.length },
        ],
      },
    ],
    [customers.length, inquiries.length, salesOrders.length, deliveryNotes.length, invoices.length, receipts.length, vendors.length, purchaseOrders, items.length, commissions.length, teamProfiles.length, numberRanges.length, creditNotes.length]
  );

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
    setActiveSubModule(subId);
    setMobileDrawerOpen(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) loadProfiles(s.user);
      else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) loadProfiles(s.user);
      else setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfiles = async (user) => {
    const { data: all } = await supabase.from('team_profiles').select('*').order('full_name');
    if (all) {
      setTeamProfiles(all);
      const me = all.find((p) => p.id === user.id);
      setProfile(me || { id: user.id, email: user.email, full_name: user.email.split('@')[0], role_key: 'manager', role_label: 'Sales Manager' });
    }
    setAuthLoading(false);
  };

  const refreshAllErpData = async () => {
    setSyncStatus('syncing');
    const [
      settingsRes,
      inqRes,
      soRes,
      dnRes,
      invRes,
      poRes,
      recRes,
      commRes,
      profRes,
      custRes,
      vendRes,
      itemRes,
      uomRes,
      rangeRes,
      cnRes,
    ] = await Promise.all([
      supabase.from('app_settings').select('*'),
      supabase.from('inquiries').select('*').order('updated_at', { ascending: false }),
      supabase.from('sales_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('delivery_notes').select('*').order('delivered_at', { ascending: false }),
      supabase.from('invoices').select('*').order('issued_at', { ascending: false }),
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('customer_receipts').select('*').order('received_at', { ascending: false }),
      supabase.from('commission_ledger').select('*').order('updated_at', { ascending: false }),
      supabase.from('team_profiles').select('*').order('full_name'),
      supabase.from('customers').select('*').order('name_en'),
      supabase.from('vendors').select('*').order('name_en'),
      supabase.from('items').select('*').order('name_en'),
      supabase.from('custom_uoms').select('*').order('code'),
      supabase.from('document_number_ranges').select('*').order('doc_type'),
      supabase.from('credit_notes').select('*').order('issued_at', { ascending: false }),
    ]);

    if (settingsRes.data) {
      const fxRow = settingsRes.data.find((r) => r.key === 'fx_rates');
      const compRow = settingsRes.data.find((r) => r.key === 'company_profile');
      if (fxRow?.value) setFxRates(fxRow.value);
      if (compRow?.value) setCompany({ ...DEFAULT_COMPANY, ...compRow.value });
    }
    if (inqRes.data) setInquiries(inqRes.data.map((r) => r.data));
    if (soRes.data) setSalesOrders(soRes.data);
    if (dnRes.data) setDeliveryNotes(dnRes.data);
    if (invRes.data) setInvoices(invRes.data);
    if (poRes.data) setPurchaseOrders(poRes.data);
    if (recRes.data) setReceipts(recRes.data);
    if (commRes.data) setCommissions(commRes.data);
    if (profRes.data) setTeamProfiles(profRes.data);
    if (custRes.data) setCustomers(custRes.data);
    if (vendRes.data) setVendors(vendRes.data);
    if (itemRes.data) setItems(itemRes.data);
    if (uomRes.data) setCustomUoms(uomRes.data);
    if (rangeRes.data) setNumberRanges(rangeRes.data);
    if (cnRes.data) setCreditNotes(cnRes.data);
    setSyncStatus('live');
  };

  useEffect(() => {
    if (!session) return;
    refreshAllErpData();

    const channel = supabase
      .channel('horizon-erp-discovery')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        refreshAllErpData();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session]);

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
        sublabel: `${c.name_ar || ''} • ${c.customer_type} • VAT: ${c.vat_number || 'N/A'} • ${c.phone}`,
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
        sublabel: `${it.name_ar || ''} • ${it.item_type} • ZATCA VAT: ${it.zatca_vat_type}`,
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
        sublabel: `${s.role_label} • ${s.email}`,
        rightMeta: `${s.commission_pct || 0}% Share`,
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
  const zatcaAdvice = useMemo(
    () => getZatcaComplianceAdvice(annualTaxableRevenueSAR, company.zatcaPhase2Connected),
    [annualTaxableRevenueSAR, company.zatcaPhase2Connected]
  );

  // Create New Salesman / Team Member (Provisions Supabase Auth User + team_profiles)
  const handleCreateTeamMember = async (e) => {
    e.preventDefault();
    setMemberCreating(true);
    setMemberFeedback('');
    try {
      const roleMeta = ROLE_OPTIONS.find((r) => r.key === newMember.role_key) || ROLE_OPTIONS[0];
      const { data: signUpData, error: signUpError } = await supabaseProvisioner.auth.signUp({
        email: newMember.email.trim(),
        password: newMember.password,
        options: {
          data: { full_name: newMember.full_name.trim() },
        },
      });

      if (signUpError) {
        setMemberFeedback(`Error: ${signUpError.message}`);
        setMemberCreating(false);
        return;
      }

      const createdUserId = signUpData?.user?.id;
      if (createdUserId) {
        await supabase.from('team_profiles').upsert({
          id: createdUserId,
          email: newMember.email.trim(),
          full_name: newMember.full_name.trim(),
          phone: newMember.phone,
          role_key: roleMeta.key,
          role_label: roleMeta.label,
          division: newMember.division,
          is_salesman: newMember.is_salesman,
          commission_pct: newMember.is_salesman ? parseFloat(newMember.commission_pct) || 0 : 0,
          active: true,
        });

        // Auto-select if triggered from inline "+ Create Salesman" dropdown
        if (quickCreateType === 'salesman') {
          setNewInq((prev) => ({ ...prev, salesmanId: createdUserId }));
          setQuickCreateType(null);
        }
      }

      setMemberFeedback(`Created ${newMember.full_name} (${roleMeta.label}) — ready to sign in immediately.`);
      setShowNewMemberForm(false);
      setNewMember({
        full_name: '', email: '', password: '', phone: '',
        role_key: 'sales_mep', division: 'MEP', is_salesman: true, commission_pct: 10,
      });
      refreshAllErpData();
    } catch (err) {
      setMemberFeedback(`Failed to create user: ${err.message}`);
    } finally {
      setMemberCreating(false);
    }
  };

  // Inline Quick-Create Handlers from any "+ Create New" Field Dropdown
  const handleQuickCreateCustomer = async (e) => {
    e.preventDefault();
    const id = `cust-${Date.now()}`;
    const { data: code } = await supabase.rpc('next_doc_number', { p_doc_type: 'CUSTOMER' });
    await supabase.from('customers').insert({
      id,
      customer_code: code,
      ...quickCust,
      credit_limit_sar: 50000,
      payment_terms: 'Net 30',
    });
    await refreshAllErpData();
    setNewInq((prev) => ({
      ...prev,
      customerId: id,
      clientName: quickCust.name_en,
      clientVat: quickCust.vat_number,
      contactPerson: quickCust.contact_person,
      phone: quickCust.phone,
      email: quickCust.email,
    }));
    setQuickCreateType(null);
  };

  const handleQuickCreateVendor = async (e) => {
    e.preventDefault();
    const id = `vend-${Date.now()}`;
    const { data: code } = await supabase.rpc('next_doc_number', { p_doc_type: 'VENDOR' });
    await supabase.from('vendors').insert({
      id,
      vendor_code: code,
      ...quickVend,
      payment_terms: 'Net 30',
    });
    await refreshAllErpData();
    setNewPO((prev) => ({
      ...prev,
      vendorId: id,
      supplierName: quickVend.name_en,
      supplierVat: quickVend.vat_number,
      currency: quickVend.default_currency,
      fxRate: fxRates[quickVend.default_currency] || 1,
    }));
    setQuickCreateType(null);
  };

  const handleQuickCreateItem = async (e) => {
    e.preventDefault();
    const id = `item-${Date.now()}`;
    const qDocKey = quickItem.item_type === 'Service' ? 'ITEM_SERVICE' : 'ITEM_GOODS'; const { data: item_code } = await supabase.rpc('next_doc_number', { p_doc_type: qDocKey });
    await supabase.from('items').insert({
      id,
      item_code,
      ...quickItem,
      sales_price_sar: parseFloat(quickItem.sales_price_sar) || 0,
      purchase_price: parseFloat(quickItem.purchase_price) || 0,
    });
    await refreshAllErpData();
    setNewInq((prev) => ({
      ...prev,
      itemId: id,
      firstItemDesc: `${quickItem.name_en} (${quickItem.name_ar})`,
      firstItemUom: quickItem.uom,
      firstItemCost: parseFloat(quickItem.purchase_price) || 0,
      firstItemCurrency: quickItem.purchase_currency,
    }));
    setNewPO((prev) => ({
      ...prev,
      itemId: id,
      itemDesc: `${quickItem.name_en} (${quickItem.uom})`,
      unitCostFx: parseFloat(quickItem.purchase_price) || 0,
      currency: quickItem.purchase_currency,
      fxRate: fxRates[quickItem.purchase_currency] || 1,
    }));
    setQuickCreateType(null);
  };

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
      firstItemDesc: `${it.name_en} (${it.name_ar})`,
      firstItemUom: it.uom,
      firstItemCost: Number(it.purchase_price || 0),
      firstItemCurrency: it.purchase_currency || 'SAR',
    });
  };

  const handleCreateInquiry = async (e) => {
    e.preventDefault();
    const { data: seqInqId } = await supabase.rpc('next_doc_number', { p_doc_type: 'INQUIRY' }); const chosenSalesman = teamProfiles.find((p) => p.id === newInq.salesmanId) || salesmenList[0]; const obj = { id: seqInqId, refNo: seqInqId,
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
    await supabase.from('inquiries').upsert({
      id: obj.id,
      data: obj,
      updated_at: new Date().toISOString(),
      updated_by: profile?.full_name || 'ERP User',
    });
    setShowNewInqModal(false);
    setSelectedInqId(obj.id);
    setNewInq({
      customerId: '', clientName: '', clientVat: '', contactPerson: '', phone: '', email: '',
      division: 'MEP', salesmanId: '', itemId: '', firstItemDesc: '', firstItemQty: 1,
      firstItemUom: 'PCS', firstItemCost: 0, firstItemCurrency: 'USD',
    });
    refreshAllErpData();
  };

  const saveInquiryPatch = async (inq, patch) => {
    const updated = { ...inq, ...patch };
    setInquiries((prev) => prev.map((i) => (i.id === inq.id ? updated : i)));
    await supabase.from('inquiries').upsert({
      id: inq.id,
      data: updated,
      updated_at: new Date().toISOString(),
      updated_by: profile?.full_name || 'ERP User',
    });
  };

  const handleConvertQuoteToSO = async (inq) => {
    const fin = computeQuoteFinancials(inq, fxRates);
    const marginFactor = fin.totalCostSAR > 0 ? fin.sellNetSAR / fin.totalCostSAR : 1.25;
    const { data: soNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'SO' });

    const soItems = (inq.boqItems || []).map((b) => {
      const unitCostSar = (Number(b.buyUnitCost) || 0) * (fxRates[b.buyCurrency] || 1);
      const unitSellSar = unitCostSar > 0 ? unitCostSar * marginFactor : 0;
      return {
        id: b.id,
        desc: b.desc,
        orderedQty: Number(b.qty) || 1,
        deliveredQty: 0,
        invoicedQty: 0,
        unit: b.unit || 'PCS',
        unitCostSar,
        unitSellSar,
      };
    });

    const newSO = {
      id: `so-${Date.now()}`,
      so_number: soNum,
      division: inq.division || 'MEP',
      inquiry_id: inq.id,
      client_name: inq.clientName,
      client_vat: inq.clientVat || '',
      contact_person: inq.contactPerson,
      phone: inq.phone,
      email: inq.email || '',
      division: inq.division,
      salesman_id: inq.salesmanId || null,
      salesman_name: inq.assignedSalesName,
      commission_pct: Number(inq.commissionPct || 0),
      status: 'open',
      items: soItems,
      subtotal_sar: Number(fin.sellNetSAR.toFixed(2)),
      vat_sar: Number(fin.vatSAR.toFixed(2)),
      grand_total_sar: Number(fin.grandTotalSAR.toFixed(2)),
      total_cost_sar: Number(fin.totalCostSAR.toFixed(2)),
    };

    await supabase.from('sales_orders').insert(newSO);
    await saveInquiryPatch(inq, { stage: 'won' });

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

    const deliveredLines = [];
    let allDelivered = true;

    const updatedItems = (deliveryModalSO.items || []).map((it) => {
      const shipNow = Math.min(
        Number(deliveryQtys[it.id] || 0),
        Math.max(0, Number(it.orderedQty) - Number(it.deliveredQty || 0))
      );
      if (shipNow > 0) {
        deliveredLines.push({
          id: it.id,
          desc: it.desc,
          qty: shipNow,
          unit: it.unit,
          unitSellSar: it.unitSellSar,
          unitCostSar: it.unitCostSar,
        });
      }
      const nextDelivered = Number(it.deliveredQty || 0) + shipNow;
      if (nextDelivered < Number(it.orderedQty)) allDelivered = false;
      return { ...it, deliveredQty: nextDelivered };
    });

    if (deliveredLines.length === 0) return;

    const { data: dnNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'DN' });
    await supabase.from('delivery_notes').insert({
      id: `dn-${Date.now()}`,
      dn_number: dnNum,
      division: so.division || 'MEP',
      so_id: deliveryModalSO.id,
      so_number: deliveryModalSO.so_number,
      client_name: deliveryModalSO.client_name,
      delivery_type: allDelivered ? 'full' : 'partial',
      items: deliveredLines,
      delivered_by: profile?.full_name || 'Logistics',
      notes: deliveryNotesText,
    });

    await supabase
      .from('sales_orders')
      .update({
        items: updatedItems,
        status: allDelivered ? 'delivered' : 'partially_delivered',
        updated_at: new Date().toISOString(),
      })
      .eq('id', deliveryModalSO.id);

    setDeliveryModalSO(null);
    selectSubModule('sales', 'sales_deliveries');
    refreshAllErpData();
  };

  const handleGenerateZatcaInvoiceFromDN = async (dn) => {
    const parentSO = salesOrders.find((s) => s.id === dn.so_id);
    const subtotal = (dn.items || []).reduce((s, it) => s + Number(it.qty) * Number(it.unitSellSar), 0);
    const landedCost = (dn.items || []).reduce((s, it) => s + Number(it.qty) * Number(it.unitCostSar || 0), 0);
    const vat = subtotal * 0.15;
    const grandTotal = subtotal + vat;
    const { data: invNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'INVOICE' });
    const issuedIso = new Date().toISOString();

    const qrBase64 = generateZatcaQrBase64({
      sellerName: company.nameEn,
      vatNumber: company.vatNumber,
      timestampIso: issuedIso,
      totalWithVat: grandTotal,
      vatAmount: vat,
    });

    const newInv = {
      id: `inv-${Date.now()}`,
      invoice_number: invNum,
      division: dn.division || 'MEP',
      invoice_type: parentSO?.client_vat ? 'standard' : 'simplified',
      so_id: dn.so_id,
      so_number: dn.so_number,
      dn_id: dn.id,
      client_name: dn.client_name,
      client_vat: parentSO?.client_vat || '',
      salesman_id: parentSO?.salesman_id || null,
      salesman_name: parentSO?.salesman_name || 'Unassigned',
      commission_pct: Number(parentSO?.commission_pct || 0),
      items: dn.items,
      subtotal_sar: Number(subtotal.toFixed(2)),
      vat_sar: Number(vat.toFixed(2)),
      grand_total_sar: Number(grandTotal.toFixed(2)),
      landed_cost_sar: Number(landedCost.toFixed(2)),
      paid_amount_sar: 0,
      payment_status: 'unpaid',
      zatca_status: company.zatcaPhase2Connected ? 'cleared' : 'phase1_qr_ready',
      qr_base64: qrBase64,
      locked: true,
      issued_at: issuedIso,
    };

    const { data: insertedInv } = await supabase.from('invoices').insert(newInv).select().single();

    const netProfit = Math.max(0, subtotal - landedCost);
    const commPct = Number(parentSO?.commission_pct || 0);
    const totalEligibleComm = (netProfit * commPct) / 100;

    if (commPct > 0 && totalEligibleComm > 0) {
      await supabase.from('commission_ledger').insert({
        id: `comm-${Date.now()}`,
        invoice_id: insertedInv?.id || newInv.id,
        invoice_number: invNum,
      division: dn.division || 'MEP',
        client_name: dn.client_name,
        salesman_id: parentSO?.salesman_id || null,
        salesman_name: parentSO?.salesman_name || 'Salesman',
        commission_pct: commPct,
        net_profit_sar: Number(netProfit.toFixed(2)),
        total_eligible_commission_sar: Number(totalEligibleComm.toFixed(2)),
        unlocked_commission_sar: 0,
        paid_out_sar: 0,
        status: 'awaiting_collection',
      });
    }

    selectSubModule('sales', 'sales_invoices');
    if (insertedInv) setPreviewInvoice(insertedInv);
    refreshAllErpData();
  };

  const handleRecordCustomerPayment = async (e) => {
    e.preventDefault();
    if (!paymentModalInv) return;

    const amt = parseFloat(paymentAmount) || 0;
    if (amt <= 0) return;

    const newPaidTotal = Math.min(
      Number(paymentModalInv.grand_total_sar),
      Number(paymentModalInv.paid_amount_sar || 0) + amt
    );
    const isFullyPaid = newPaidTotal >= Number(paymentModalInv.grand_total_sar) - 0.01;

    await supabase.from('customer_receipts').insert({
      id: `rcp-${Date.now()}`,
      receipt_number: (await supabase.rpc('next_doc_number', { p_doc_type: 'RECEIPT' })).data,
      invoice_id: paymentModalInv.id,
      invoice_number: paymentModalInv.invoice_number,
      client_name: paymentModalInv.client_name,
      amount_sar: amt,
      payment_method: paymentMethod,
      reference_no: paymentRef,
      recorded_by: profile?.full_name || 'Finance',
    });

    await supabase
      .from('invoices')
      .update({
        paid_amount_sar: Number(newPaidTotal.toFixed(2)),
        payment_status: isFullyPaid ? 'paid' : 'partial',
      })
      .eq('id', paymentModalInv.id);

    const commRow = commissions.find((c) => c.invoice_id === paymentModalInv.id);
    if (commRow) {
      const collectionRatio = Math.min(1, newPaidTotal / Number(paymentModalInv.grand_total_sar || 1));
      const unlockedSar = Number((Number(commRow.total_eligible_commission_sar) * collectionRatio).toFixed(2));
      await supabase
        .from('commission_ledger')
        .update({
          unlocked_commission_sar: unlockedSar,
          status: collectionRatio >= 0.999 ? 'ready_for_payout' : 'partially_unlocked',
          updated_at: new Date().toISOString(),
        })
        .eq('id', commRow.id);
    }

    setPaymentModalInv(null);
    setPaymentAmount('');
    setPaymentRef('');
    refreshAllErpData();
  };

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

  const handleSelectItemForPO = (itemId) => {
    const it = items.find((x) => x.id === itemId);
    if (!it) {
      setNewPO({ ...newPO, itemId: '' });
      return;
    }
    setNewPO({
      ...newPO,
      itemId: it.id,
      itemDesc: `${it.name_en} (${it.uom})`,
      unitCostFx: Number(it.purchase_price || 0),
      currency: it.purchase_currency || newPO.currency,
      fxRate: fxRates[it.purchase_currency] || newPO.fxRate,
    });
  };

  const handleCreatePO = async (e) => {
    e.preventDefault();
    const linkedSO = salesOrders.find((s) => s.id === newPO.soId);
    const goodsFx = (Number(newPO.itemQty) || 1) * (Number(newPO.unitCostFx) || 0);
    const goodsSar = goodsFx * (Number(newPO.fxRate) || 1);
    const landedSar = Number(newPO.landedCostSar) || 0;
    const vatSar = newPO.supplierVat ? (goodsSar + landedSar) * 0.15 : 0;

    await supabase.from('purchase_orders').insert({
      id: `po-${Date.now()}`,
      po_number: (await supabase.rpc('next_doc_number', { p_doc_type: 'PO' })).data,
      so_id: linkedSO?.id || null,
      so_number: linkedSO?.so_number || '',
      supplier_name: newPO.supplierName,
      supplier_vat: newPO.supplierVat,
      currency: newPO.currency,
      fx_rate: Number(newPO.fxRate) || 1,
      status: 'po_issued',
      items: [
        {
          desc: newPO.itemDesc,
          qty: Number(newPO.itemQty) || 1,
          unitCostFx: Number(newPO.unitCostFx) || 0,
          is_stocked_item: newPO.isStockedItem,
        },
      ],
      goods_total_fx: Number(goodsFx.toFixed(2)),
      goods_total_sar: Number(goodsSar.toFixed(2)),
      landed_cost_sar: Number(landedSar.toFixed(2)),
      supplier_vat_sar: Number(vatSar.toFixed(2)),
      bill_status: 'unbilled',
    });

    setShowNewPOModal(false);
    selectSubModule('purchase', 'pur_orders');
    refreshAllErpData();
  };

  const advancePurchaseStage = async (po, nextStatus, extraPatch = {}, nextSubTab = null) => {
    await supabase
      .from('purchase_orders')
      .update({ status: nextStatus, ...extraPatch, updated_at: new Date().toISOString() })
      .eq('id', po.id);
    if (nextSubTab) selectSubModule('purchase', nextSubTab);
    refreshAllErpData();
  };

  const handleSaveCompanySettings = async (e) => {
    e.preventDefault();
    await supabase.from('app_settings').upsert({
      key: 'company_profile',
      value: company,
      updated_at: new Date().toISOString(),
    });
    setSettingsSavedMsg('Company & ZATCA settings saved and synced across all users.');
    setTimeout(() => setSettingsSavedMsg(''), 4000);
  };

  const handleUpdateSalesmanRule = async (userId, isSalesman, commissionPct) => {
    await supabase
      .from('team_profiles')
      .update({
        is_salesman: isSalesman,
        commission_pct: parseFloat(commissionPct) || 0,
      })
      .eq('id', userId);
    refreshAllErpData();
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!session) {
    return <LoginLandingPage company={company} onLoginSuccess={(u) => setSession({ user: u })} />;
  }

  const selectedInq = inquiries.find((i) => i.id === selectedInqId) || null;

  const renderSidebarNav = (isMobile = false) => (
    <div className="flex flex-col h-full bg-slate-900 text-slate-200 select-none">
      <div className="p-3.5 border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-base shrink-0">
            H
          </div>
          {(!sidebarCollapsed || isMobile) && (
            <div className="min-w-0">
              <div className="font-bold text-xs text-white truncate">{company.nameEn}</div>
              <div className="text-[10px] text-emerald-400 font-semibold">
                ERP Phase 1 • {syncStatus === 'live' ? 'Live' : 'Sync'}
              </div>
            </div>
          )}
        </div>

        {isMobile ? (
          <button onClick={() => setMobileDrawerOpen(false)} className="p-1.5 rounded-lg bg-slate-800 text-slate-300">
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
            title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
        {navTree.map((mod) => {
          const ModIcon = mod.icon;
          const isExpanded = Boolean(expandedModules[mod.id]);
          const hasActiveSub = mod.subModules.some((s) => s.id === activeSubModule);

          return (
            <div key={mod.id} className="space-y-1">
              <button
                onClick={() => toggleMainModule(mod.id)}
                className={`w-full flex items-center justify-between px-2.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  hasActiveSub
                    ? 'bg-slate-800/90 text-white'
                    : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                }`}
                title={mod.label}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <ModIcon className={`w-4 h-4 shrink-0 ${hasActiveSub ? 'text-blue-400' : 'text-slate-400'}`} />
                  {(!sidebarCollapsed || isMobile) && <span className="truncate">{mod.label}</span>}
                </div>
                {(!sidebarCollapsed || isMobile) && (
                  isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
              </button>

              {isExpanded && (!sidebarCollapsed || isMobile) && (
                <div className="ml-3 pl-2.5 border-l border-slate-800 space-y-0.5">
                  {mod.subModules.map((sub) => {
                    const SubIcon = sub.icon;
                    const isActive = activeSubModule === sub.id;
                    return (
                      <button
                        key={sub.id}
                        onClick={() => selectSubModule(mod.id, sub.id)}
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                          isActive
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <SubIcon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{sub.label}</span>
                        </div>
                        {typeof sub.count === 'number' && (
                          <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${isActive ? 'bg-blue-800 text-white' : 'bg-slate-800 text-slate-400'}`}>
                            {sub.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-800 flex items-center justify-between gap-2">
        {(!sidebarCollapsed || isMobile) && (
          <div className="min-w-0">
            <div className="text-xs font-bold text-white truncate">{profile?.full_name}</div>
            <div className="text-[10px] text-slate-400 truncate">{profile?.role_label}</div>
          </div>
        )}
        <button
          onClick={() => supabase.auth.signOut()}
          className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-400 cursor-pointer shrink-0"
          title="Sign Out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex">
      <aside className={`hidden lg:block shrink-0 border-r border-slate-800 transition-all duration-200 ${sidebarCollapsed ? 'w-16' : 'w-68'}`}>
        <div className="sticky top-0 h-screen">{renderSidebarNav(false)}</div>
      </aside>

      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 max-w-[85vw] h-full shadow-2xl">{renderSidebarNav(true)}</div>
          <div className="flex-1 bg-slate-950/60" onClick={() => setMobileDrawerOpen(false)} />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* TOP HEADER WITH GLOBAL SMART DISCOVERY BAR */}
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden p-2 rounded-xl bg-slate-100 text-slate-700"
              aria-label="Open ERP Navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0 hidden sm:block">
              <div className="text-xs font-bold text-slate-900 truncate">{company.nameEn}</div>
              <div className="text-[11px] text-slate-500 truncate">VAT: {company.vatNumber}</div>
            </div>
          </div>

          {/* Global Smart Search & Discovery Trigger */}
          <button
            onClick={() => setGlobalSearchOpen(true)}
            className="flex-1 max-w-md mx-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-500 text-xs flex items-center justify-between gap-2 transition cursor-pointer"
          >
            <span className="flex items-center gap-2 truncate">
              <Search className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span className="truncate">Smart Search: Customers, Vendors, Items, Invoices...</span>
            </span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-white border border-slate-300 rounded text-slate-500">
              Ctrl K
            </kbd>
          </button>

          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase font-semibold text-slate-400">YTD Sales</div>
            <div className="text-xs sm:text-sm font-bold text-blue-700">SAR {formatSAR(annualTaxableRevenueSAR)}</div>
          </div>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-5 space-y-5">
          <div className={`p-3 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${zatcaAdvice.badgeClass}`}>
            <div className="flex items-start sm:items-center gap-2">
              <QrCode className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <span className="font-bold">{zatcaAdvice.wave}: </span>
                <span>{zatcaAdvice.statusText}</span>
              </div>
            </div>
          </div>

          {/* MASTER DATA VIEWS IN THEIR RELATED MODULES */}
          {activeSubModule === 'sales_customers' && (
            <CustomersMasterView
              supabase={supabase}
              customers={customers}
              salesmenList={salesmenList}
              onRefresh={refreshAllErpData}
            />
          )}

          {activeSubModule === 'pur_vendors' && (
            <VendorsMasterView
              supabase={supabase}
              vendors={vendors}
              currencies={CURRENCIES}
              onRefresh={refreshAllErpData}
            />
          )}

          {activeSubModule === 'cat_items' && (
            <ItemsMasterView
              supabase={supabase}
              items={items}
              customUoms={customUoms}
              vendors={vendors}
              customers={customers}
              currencies={CURRENCIES}
              onRefresh={refreshAllErpData}
            />
          )}

          {/* SUB-MODULE: 1.2 INQUIRIES & QUOTES */}
          {activeSubModule === 'sales_quotes' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Inquiries &amp; Commercial Quotations</h2>
                <button
                  onClick={() => setShowNewInqModal(true)}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> New Inquiry
                </button>
              </div>

              {inquiries.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
                  <p className="text-sm text-slate-500">No active inquiries yet. Log your first client RFQ to start the Order-to-Cash cycle.</p>
                  <button
                    onClick={() => setShowNewInqModal(true)}
                    className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" /> Create First Inquiry
                  </button>
                </div>
              ) : (
                <div className="grid gap-3">
                  {inquiries.map((inq) => {
                    const fin = computeQuoteFinancials(inq, fxRates);
                    return (
                      <div
                        key={inq.id}
                        onClick={() => setSelectedInqId(inq.id)}
                        className="bg-white border border-slate-200 hover:border-blue-400 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{inq.refNo}</span>
                            <span className="text-xs font-semibold bg-slate-100 px-2 py-0.5 rounded">{inq.division}</span>
                            <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded">
                              Sales: {inq.assignedSalesName} ({inq.commissionPct || 0}% Share)
                            </span>
                          </div>
                          <h3 className="text-base font-bold mt-1">{inq.clientName} <span className="ml-2"><ShareDocumentButtons company={company} customers={customers} docType="Quotation / RFQ" docNumber={inq.id} clientName={inq.clientName} division={inq.division} status={inq.status} directPhone={inq.phone} directEmail={inq.email} compact /></span></h3>
                          <p className="text-xs text-slate-500">{inq.contactPerson} • {inq.phone}</p>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-4">
                          <div className="text-right">
                            <div className="text-xs text-slate-400">Quote Total (Incl. VAT)</div>
                            <div className="text-base font-bold">SAR {formatSAR(fin.grandTotalSAR)}</div>
                          </div>
                          {inq.stage !== 'won' ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConvertQuoteToSO(inq);
                              }}
                              className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                            >
                              Convert to SO →
                            </button>
                          ) : (
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold">
                              SO Created
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SUB-MODULE: 1.3 SALES ORDERS */}
          {activeSubModule === 'sales_orders' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Sales Orders (SO)</h2>
                <p className="text-xs text-slate-500">Track line-item fulfillment and dispatch Full or Partial Deliveries.</p>
              </div>

              {salesOrders.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                  No Sales Orders yet. Convert an approved quote under <strong>Sales &amp; Fulfillment → Inquiries &amp; Quotes</strong>.
                </div>
              ) : (
                <div className="grid gap-4">
                  {salesOrders.map((so) => (
                    <div key={so.id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded">{so.so_number} <span className={ml-1.5 text-[10px] px-1.5 py-0.5 rounded font-bold }>{so.division || 'MEP'}</span> <div className="mt-1"><ShareDocumentButtons company={company} customers={customers} docType="Sales Order" docNumber={so.so_number} clientName={so.client_name} division={so.division} totalSar={so.grand_total_sar} status={so.status} compact /></div></span>
                            <span className="text-xs font-semibold uppercase px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                              {so.status.replace('_', ' ')}
                            </span>
                          </div>
                          <h3 className="text-base font-bold mt-1">{so.client_name}</h3>
                          <p className="text-xs text-slate-500">
                            Salesman: <strong>{so.salesman_name}</strong> • Total: <strong>SAR {formatSAR(so.grand_total_sar)}</strong>
                          </p>
                        </div>

                        {so.status !== 'delivered' && (
                          <button
                            onClick={() => openDeliveryModal(so)}
                            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Truck className="w-4 h-4" /> Record Delivery (Full / Partial)
                          </button>
                        )}
                      </div>

                      <div className="border border-slate-100 rounded-xl overflow-hidden text-xs">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50 text-slate-500">
                            <tr>
                              <th className="p-2">Item</th>
                              <th className="p-2 text-right">Ordered</th>
                              <th className="p-2 text-right">Delivered</th>
                              <th className="p-2 text-right">Pending</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {(so.items || []).map((it) => {
                              const pending = Math.max(0, Number(it.orderedQty) - Number(it.deliveredQty || 0));
                              return (
                                <tr key={it.id}>
                                  <td className="p-2 font-medium">{it.desc}</td>
                                  <td className="p-2 text-right">{it.orderedQty} {it.unit}</td>
                                  <td className="p-2 text-right text-emerald-600 font-semibold">{it.deliveredQty || 0}</td>
                                  <td className="p-2 text-right text-amber-600 font-semibold">{pending}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SUB-MODULE: 1.4 DELIVERIES */}
          {activeSubModule === 'sales_deliveries' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Delivery Notes (Full &amp; Partial Dispatches)</h2>
                <p className="text-xs text-slate-500">Issue ZATCA Tax Invoices directly against completed Delivery Notes.</p>
              </div>

              {deliveryNotes.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                  No Delivery Notes recorded yet.
                </div>
              ) : (
                <div className="grid gap-3">
                  {deliveryNotes.map((dn) => {
                    const alreadyInvoiced = invoices.some((inv) => inv.dn_id === dn.id);
                    return (
                      <div key={dn.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">{dn.dn_number}</span>
                            <span className="text-xs uppercase font-semibold bg-slate-100 px-2 py-0.5 rounded">{dn.delivery_type} Delivery</span>
                            <span className="text-xs text-slate-500">Ref: {dn.so_number}</span>
                          </div>
                          <div className="font-bold text-sm mt-1">{dn.client_name}</div>
                        </div>

                        {alreadyInvoiced ? (
                          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl">
                            ✓ ZATCA Invoice Issued
                          </span>
                        ) : (
                          <button
                            onClick={() => handleGenerateZatcaInvoiceFromDN(dn)}
                            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Receipt className="w-4 h-4" /> Issue ZATCA Tax Invoice
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeSubModule === 'sales_credit_notes' && (<CreditNotesView supabase={supabase} company={company} invoices={invoices} creditNotes={creditNotes} commissions={commissions} profile={profile} onRefresh={refreshAllErpData} />)}

          {/* SUB-MODULE: 1.5 ZATCA INVOICES */}
          {activeSubModule === 'sales_invoices' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">ZATCA E-Invoices (Phase 1 TLV QR &amp; Phase 2 Ready)</h2>
                <p className="text-xs text-slate-500">Posted invoices are locked against deletion/modification per ZATCA regulations.</p>
              </div>

              {invoices.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                  No ZATCA invoices issued yet.
                </div>
              ) : (
                <div className="grid gap-3">
                  {invoices.map((inv) => {
                    const balanceDue = Math.max(0, Number(inv.grand_total_sar) - Number(inv.paid_amount_sar || 0));
                    return (
                      <div key={inv.id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded">{inv.invoice_number} <span className={ml-1.5 text-[10px] px-1.5 py-0.5 rounded font-bold }>{inv.division || 'MEP'}</span> <div className="mt-1"><ShareDocumentButtons company={company} customers={customers} docType="ZATCA Tax Invoice" docNumber={inv.invoice_number} clientName={inv.client_name} division={inv.division} totalSar={inv.grand_total_sar} status={inv.payment_status} compact /></div></span>
                            <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full">
                              ZATCA {inv.zatca_status === 'cleared' ? 'Phase 2 Cleared' : 'Phase 1 TLV QR'}
                            </span>
                            <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${
                              inv.payment_status === 'paid'
                                ? 'bg-emerald-100 text-emerald-800'
                                : inv.payment_status === 'partial'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}>
                              {inv.payment_status}
                            </span>
                          </div>
                          <h3 className="text-base font-bold mt-1">{inv.client_name}</h3>
                          <p className="text-xs text-slate-500">
                            Salesman: <strong>{inv.salesman_name}</strong> • Total: <strong>SAR {formatSAR(inv.grand_total_sar)}</strong> • Paid: <strong>SAR {formatSAR(inv.paid_amount_sar)}</strong>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => setPreviewInvoice(inv)}
                            className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                          >
                            <QrCode className="w-4 h-4" /> View ZATCA Invoice
                          </button>
                          {balanceDue > 0.01 && (
                            <button
                              onClick={() => {
                                setPaymentModalInv(inv);
                                setPaymentAmount(balanceDue.toFixed(2));
                              }}
                              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                            >
                              + Receive Payment (SAR {formatSAR(balanceDue)})
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SUB-MODULE: 2.1 AR CUSTOMER RECEIPTS */}
          {activeSubModule === 'fin_collections' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Accounts Receivable &amp; Customer Receipts</h2>
                <p className="text-xs text-slate-500">Collected customer payments unlock Salesman Net Profit Share automatically.</p>
              </div>

              {receipts.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                  No customer payments recorded yet.
                </div>
              ) : (
                <div className="grid gap-3">
                  {receipts.map((r) => (
                    <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-emerald-700">{r.receipt_number} • Invoice {r.invoice_number}</div>
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
            </div>
          )}

          {/* SUB-MODULE: 2.2 ZATCA WAVE & VAT */}
          {activeSubModule === 'fin_zatca_advisor' && (
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

          {/* SUB-MODULES: 3.2 / 3.3 / 3.4 PURCHASE CYCLE */}
          {['pur_orders', 'pur_grn', 'pur_bills'].includes(activeSubModule) && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900">
                    {activeSubModule === 'pur_orders' && 'Purchase Orders (PO)'}
                    {activeSubModule === 'pur_grn' && 'Goods Receipt Notes (GRN)'}
                    {activeSubModule === 'pur_bills' && 'Supplier Bills & Landed Cost'}
                  </h2>
                  <p className="text-xs text-slate-500">PO Issuance → Goods Receipt Note (GRN) → Supplier Bill &amp; Customs/Freight Allocation.</p>
                </div>
                <button
                  onClick={() => setShowNewPOModal(true)}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> New Purchase Order
                </button>
              </div>

              {purchaseOrders.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                  No Purchase Orders created yet. Click <strong>New Purchase Order</strong> to issue a supplier PO.
                </div>
              ) : (
                <div className="grid gap-3">
                  {purchaseOrders.map((po) => {
                    const totalLandedSar = Number(po.goods_total_sar || 0) + Number(po.landed_cost_sar || 0);
                    return (
                      <div key={po.id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded">{po.po_number} <div className="mt-1"><button type="button" onClick={(e) => { e.stopPropagation(); setPreviewPO(po); }} className="no-print px-2 py-1 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer transition"><span>Preview A4 PO</span></button> <SharePurchaseOrderButtons company={company} suppliers={vendors} po={po} compact /></div></span>
                            {po.so_number && <span className="text-xs bg-slate-100 px-2 py-0.5 rounded">Linked: {po.so_number}</span>}
                            <span className="text-xs font-bold uppercase text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                              {po.status.replace('_', ' ')}
                            </span>
                          </div>
                          <h3 className="text-base font-bold mt-1">{po.supplier_name}</h3>
                          <p className="text-xs text-slate-500">
                            Goods: <strong>{po.currency} {formatSAR(po.goods_total_fx)}</strong> (SAR {formatSAR(po.goods_total_sar)}) + Freight/Customs: <strong>SAR {formatSAR(po.landed_cost_sar)}</strong> = Total Landed: <strong>SAR {formatSAR(totalLandedSar)}</strong>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {po.status === 'po_issued' && (
                            <button
                              onClick={() => advancePurchaseStage(po, 'grn_completed', {}, 'pur_grn')}
                              className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
                            >
                              Record GRN (Goods Received)
                            </button>
                          )}
                          {po.status === 'grn_completed' && (
                            <button
                              onClick={() => advancePurchaseStage(po, 'billed', { bill_status: 'posted' }, 'pur_bills')}
                              className="px-3 py-2 rounded-xl bg-purple-600 text-white text-xs font-semibold cursor-pointer"
                            >
                              Post Supplier Bill to Finance
                            </button>
                          )}
                          {po.status === 'billed' && po.bill_status !== 'paid' && (
                            <button
                              onClick={() => advancePurchaseStage(po, 'billed', { bill_status: 'paid', paid_sar: totalLandedSar + Number(po.supplier_vat_sar || 0) })}
                              className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                            >
                              Mark Supplier Paid
                            </button>
                          )}
                          {po.bill_status === 'paid' && (
                            <span className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-bold">
                              ✓ GRN &amp; Supplier Paid
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SUB-MODULE: 5.1 SALES PROFIT SHARE LEDGER */}
          {activeSubModule === 'comm_ledger' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Sales Profit Share Ledger (Collection-Based)</h2>
                <p className="text-xs text-slate-500">
                  Calculated strictly on <strong>Net Profit</strong> and unlocked proportionally as <strong>Customer Payments</strong> are collected.
                </p>
              </div>

              {commissions.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                  No profit-share entries yet.
                </div>
              ) : (
                <div className="grid gap-3">
                  {commissions.map((c) => (
                    <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-0.5 rounded">{c.salesman_name}</span>
                          <span className="text-xs font-semibold bg-slate-100 px-2 py-0.5 rounded">Rate: {c.commission_pct}% of Net Profit</span>
                          <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            c.status === 'ready_for_payout'
                              ? 'bg-emerald-100 text-emerald-800'
                              : c.status === 'partially_unlocked'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-200 text-slate-700'
                          }`}>
                            {c.status.replace('_', ' ')}
                          </span>
                        </div>
                        <h3 className="text-base font-bold mt-1">{c.client_name} ({c.invoice_number})</h3>
                        <p className="text-xs text-slate-500">
                          Deal Net Profit: <strong>SAR {formatSAR(c.net_profit_sar)}</strong> • Total Eligible Share: <strong>SAR {formatSAR(c.total_eligible_commission_sar)}</strong>
                        </p>
                      </div>

                      <div className="text-left sm:text-right bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div className="text-[11px] text-slate-500">Unlocked (Collected Cash Basis)</div>
                        <div className="text-lg font-bold text-emerald-600">SAR {formatSAR(c.unlocked_commission_sar)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SUB-MODULE: 6.1 TEAM & SALESMEN MASTER (CREATE NEW SALESMEN & STAFF) */}
          {activeSubModule === 'set_salesmen' && (
            <div className="space-y-4 max-w-3xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900">Team Members &amp; Salesmen Master</h2>
                  <p className="text-xs text-slate-500">
                    Create new Salesmen, Procurement, Finance, or Admin logins and configure their Net Profit Share (%).
                  </p>
                </div>
                <button
                  onClick={() => setShowNewMemberForm(!showNewMemberForm)}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" /> {showNewMemberForm ? 'Close Form' : '+ Create Salesman / Team Member'}
                </button>
              </div>

              {memberFeedback && (
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-semibold">
                  {memberFeedback}
                </div>
              )}

              {showNewMemberForm && (
                <form onSubmit={handleCreateTeamMember} className="bg-white border border-blue-200 rounded-2xl p-5 shadow-sm space-y-4 text-xs">
                  <div className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">
                    Register New Salesman or Team Member (All Fields Marked *)
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Full Name *</label>
                      <input
                        type="text"
                        required
                        value={newMember.full_name}
                        onChange={(e) => setNewMember({ ...newMember, full_name: e.target.value })}
                        placeholder="e.g. Tariq Al-Harbi"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Work Email (Login ID) *</label>
                      <input
                        type="email"
                        required
                        value={newMember.email}
                        onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
                        placeholder="tariq@horizon-ksa.com"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Initial Login Password *</label>
                      <input
                        type="text"
                        required
                        minLength={6}
                        value={newMember.password}
                        onChange={(e) => setNewMember({ ...newMember, password: e.target.value })}
                        placeholder="Min 6 characters"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Mobile / WhatsApp</label>
                      <input
                        type="tel"
                        value={newMember.phone}
                        onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })}
                        placeholder="+966 5X XXX XXXX"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Department / Role *</label>
                      <select
                        value={newMember.role_key}
                        onChange={(e) => {
                          const r = ROLE_OPTIONS.find((x) => x.key === e.target.value);
                          setNewMember({
                            ...newMember,
                            role_key: e.target.value,
                            is_salesman: r ? r.isSalesman : false,
                          });
                        }}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white font-semibold"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.key} value={r.key}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Assigned Division *</label>
                      <select
                        value={newMember.division}
                        onChange={(e) => setNewMember({ ...newMember, division: e.target.value })}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                      >
                        <option value="MEP">MEP Trading &amp; Contracting</option>
                        <option value="IT & ELV">IT &amp; ELV Systems</option>
                        <option value="MEP & IT">All Divisions (MEP &amp; IT)</option>
                      </select>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newMember.is_salesman}
                        onChange={(e) => setNewMember({ ...newMember, is_salesman: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span>Eligible as Salesman (Appears in Customer &amp; Inquiry Salesman dropdowns)</span>
                    </label>

                    {newMember.is_salesman && (
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-600">Net Profit Share %:</span>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          required
                          value={newMember.commission_pct}
                          onChange={(e) => setNewMember({ ...newMember, commission_pct: e.target.value })}
                          className="w-20 border border-slate-300 rounded-lg px-2.5 py-1 text-right font-bold bg-white"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setShowNewMemberForm(false)} className="px-4 py-2 rounded-xl border border-slate-300 font-semibold">
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={memberCreating}
                      className="px-5 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer"
                    >
                      {memberCreating ? 'Creating Account...' : 'Create Team Member'}
                    </button>
                  </div>
                </form>
              )}

              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                {teamProfiles.map((member) => (
                  <div key={member.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">{member.full_name}</span>
                        {member.is_salesman && (
                          <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 text-[10px] font-bold">
                            Salesman
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">{member.email} • {member.role_label}</div>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={Boolean(member.is_salesman)}
                          onChange={(e) => handleUpdateSalesmanRule(member.id, e.target.checked, member.commission_pct)}
                        />
                        Salesman
                      </label>

                      <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg px-2 py-1">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          defaultValue={member.commission_pct || 0}
                          onBlur={(e) => handleUpdateSalesmanRule(member.id, member.is_salesman, e.target.value)}
                          className="w-14 text-right font-bold text-xs focus:outline-none"
                        />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSubModule === 'set_num_ranges' && (['Admin', 'CEO', 'Finance'].includes(profile?.role || 'Admin') ? <NumberRangesView supabase={supabase} ranges={numberRanges} onRefresh={refreshAllErpData} /> : <div className='bg-amber-50 border border-amber-200 rounded-2xl p-6 text-xs text-amber-900 font-semibold'>Access Restricted: Only Admin / CEO or Finance roles can modify Document Number Ranges.</div>)}

          {/* SUB-MODULE: 6.2 COMPANY SETTINGS */}
          {activeSubModule === 'set_company' && (
            <form onSubmit={handleSaveCompanySettings} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 max-w-2xl">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">Company &amp; ZATCA Tax Profile (Editable)</h2>
              </div>

              {settingsSavedMsg && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                  {settingsSavedMsg}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Company Legal Name (English)</label>
                  <input type="text" value={company.nameEn} onChange={(e) => setCompany({ ...company, nameEn: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base sm:text-xs" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Company Legal Name (Arabic)</label>
                  <input type="text" dir="rtl" value={company.nameAr} onChange={(e) => setCompany({ ...company, nameAr: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base sm:text-xs" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">15-Digit ZATCA VAT Number</label>
                  <input type="text" maxLength={15} value={company.vatNumber} onChange={(e) => setCompany({ ...company, vatNumber: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono text-base sm:text-xs" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Commercial Registration (CR)</label>
                  <input type="text" value={company.crNumber} onChange={(e) => setCompany({ ...company, crNumber: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono text-base sm:text-xs" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Address (English)</label>
                  <input type="text" value={company.addressEn} onChange={(e) => setCompany({ ...company, addressEn: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base sm:text-xs" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Address (Arabic)</label>
                  <input type="text" dir="rtl" value={company.addressAr} onChange={(e) => setCompany({ ...company, addressAr: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base sm:text-xs" />
                </div>
              </div>

              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={company.zatcaPhase2Connected}
                  onChange={(e) => setCompany({ ...company, zatcaPhase2Connected: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="font-semibold text-slate-800">
                  ZATCA Fatoora Phase 2 CSID Active (Enable Real-Time B2B Clearance &amp; Reporting)
                </span>
              </label>

              <button type="submit" className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer">
                Save Company Settings
              </button>
            </form>
          )}
        </main>
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
      {selectedInq && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex justify-end">
          <div className="bg-white w-full max-w-3xl h-full overflow-y-auto p-5 sm:p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <div className="text-xs font-bold text-blue-600">{selectedInq.refNo} • {selectedInq.division}</div>
                <h3 className="text-lg font-bold">{selectedInq.clientName}</h3>
                <p className="text-xs text-slate-500">Sales: {selectedInq.assignedSalesName} ({selectedInq.commissionPct || 0}% Profit Share)</p>
              </div>
              <button onClick={() => setSelectedInqId(null)} className="p-2 rounded-xl bg-slate-100"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase text-slate-600">BOQ Multi-Currency Costing (→ SAR)</h4>
                <button
                  onClick={() =>
                    saveInquiryPatch(selectedInq, {
                      boqItems: [
                        ...(selectedInq.boqItems || []),
                        { id: `b-${Date.now()}`, desc: 'New Item', qty: 1, unit: 'PCS', buyCurrency: 'USD', buyUnitCost: 0 },
                      ],
                    })
                  }
                  className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer"
                >
                  + Add Line
                </button>
              </div>

              {(selectedInq.boqItems || []).map((item) => (
                <div key={item.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                  <SmartEntitySelect
                    label="Catalog Item / Service"
                    placeholder="Search Items Master or create new..."
                    items={itemSelectOptions}
                    value={item.itemId || ''}
                    createNewLabel="Create New Item / Service"
                    onCreateNew={() => setQuickCreateType('item')}
                    onChange={(chosenId) => {
                      const chosen = items.find((x) => x.id === chosenId);
                      if (!chosen) return;
                      saveInquiryPatch(selectedInq, {
                        boqItems: selectedInq.boqItems.map((b) =>
                          b.id === item.id
                            ? {
                                ...b,
                                itemId: chosen.id,
                                desc: `${chosen.name_en} (${chosen.name_ar})`,
                                unit: chosen.uom,
                                buyCurrency: chosen.purchase_currency,
                                buyUnitCost: Number(chosen.purchase_price || 0),
                              }
                            : b
                        ),
                      });
                    }}
                  />
                  <input
                    type="text"
                    value={item.desc}
                    onChange={(e) =>
                      saveInquiryPatch(selectedInq, {
                        boqItems: selectedInq.boqItems.map((b) => (b.id === item.id ? { ...b, desc: e.target.value } : b)),
                      })
                    }
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="number"
                      value={item.qty}
                      onChange={(e) =>
                        saveInquiryPatch(selectedInq, {
                          boqItems: selectedInq.boqItems.map((b) => (b.id === item.id ? { ...b, qty: parseFloat(e.target.value) || 0 } : b)),
                        })
                      }
                      className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                      placeholder="Qty"
                    />
                    <select
                      value={item.buyCurrency}
                      onChange={(e) =>
                        saveInquiryPatch(selectedInq, {
                          boqItems: selectedInq.boqItems.map((b) => (b.id === item.id ? { ...b, buyCurrency: e.target.value } : b)),
                        })
                      }
                      className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-semibold"
                    >
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      value={item.buyUnitCost}
                      onChange={(e) =>
                        saveInquiryPatch(selectedInq, {
                          boqItems: selectedInq.boqItems.map((b) => (b.id === item.id ? { ...b, buyUnitCost: parseFloat(e.target.value) || 0 } : b)),
                        })
                      }
                      className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                      placeholder="Unit Cost"
                    />
                  </div>
                </div>
              ))}
            </div>

            {(() => {
              const fin = computeQuoteFinancials(selectedInq, fxRates);
              return (
                <div className="bg-slate-900 text-white rounded-2xl p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span>Gross Margin (%):</span>
                    <input
                      type="number"
                      value={selectedInq.marginPercent}
                      onChange={(e) => saveInquiryPatch(selectedInq, { marginPercent: parseFloat(e.target.value) || 0 })}
                      className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-right font-bold text-amber-300"
                    />
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Landed Cost (SAR):</span>
                    <span>SAR {formatSAR(fin.totalCostSAR)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-400 font-semibold">
                    <span>Net Profit (SAR):</span>
                    <span>SAR {formatSAR(fin.profitSAR)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-blue-400 pt-2 border-t border-slate-800">
                    <span>Total Quote (Incl. 15% VAT):</span>
                    <span>SAR {formatSAR(fin.grandTotalSAR)}</span>
                  </div>
                </div>
              );
            })()}

            {selectedInq.stage !== 'won' && (
              <button
                onClick={() => handleConvertQuoteToSO(selectedInq)}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
              >
                Approve &amp; Convert Quote to Sales Order (SO) →
              </button>
            )}
          </div>
        </div>
      )}

      {/* MODAL: NEW INQUIRY WITH SMART FIELD DROPDOWNS + INLINE "+ CREATE NEW" */}
      {showNewInqModal && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">New Client Inquiry</h3>
              <button onClick={() => setShowNewInqModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateInquiry} className="space-y-3 text-xs">
              <SmartEntitySelect
                label="Customer (Search Master or Create New)"
                placeholder="Search customer name, code, VAT, or phone..."
                items={customerSelectOptions}
                value={newInq.customerId}
                createNewLabel="Create New Customer"
                onCreateNew={() => setQuickCreateType('customer')}
                onChange={handleSelectCustomerForInq}
              />

              <input
                type="text"
                required
                placeholder="Client Company Name *"
                value={newInq.clientName}
                onChange={(e) => setNewInq({ ...newInq, clientName: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-base sm:text-xs"
              />
              <input
                type="text"
                maxLength={15}
                placeholder="Client 15-Digit VAT No (Optional - B2B)"
                value={newInq.clientVat}
                onChange={(e) => setNewInq({ ...newInq, clientVat: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-base sm:text-xs font-mono"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Contact Person *"
                  value={newInq.contactPerson}
                  onChange={(e) => setNewInq({ ...newInq, contactPerson: e.target.value })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5 text-base sm:text-xs"
                />
                <input
                  type="tel"
                  required
                  placeholder="Phone / WhatsApp *"
                  value={newInq.phone}
                  onChange={(e) => setNewInq({ ...newInq, phone: e.target.value })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5 text-base sm:text-xs"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Division *</label>
                  <select
                    value={newInq.division}
                    onChange={(e) => setNewInq({ ...newInq, division: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 bg-white text-base sm:text-xs"
                  >
                    <option value="MEP">MEP Trading</option>
                    <option value="IT & ELV">IT &amp; ELV</option>
                  </select>
                </div>

                <SmartEntitySelect
                  label="Assigned Salesman"
                  required
                  placeholder="Search or create salesman..."
                  items={salesmanSelectOptions}
                  value={newInq.salesmanId}
                  createNewLabel="Create New Salesman"
                  onCreateNew={() => setQuickCreateType('salesman')}
                  onChange={(val) => setNewInq({ ...newInq, salesmanId: val })}
                />
              </div>

              <SmartEntitySelect
                label="Primary Item / Service (Search Catalog or Create New)"
                placeholder="Search item code, English/Arabic name..."
                items={itemSelectOptions}
                value={newInq.itemId}
                createNewLabel="Create New Item / Service"
                onCreateNew={() => setQuickCreateType('item')}
                onChange={handleSelectItemForInq}
              />

              <input
                type="text"
                required
                placeholder="Primary Item / Scope Description *"
                value={newInq.firstItemDesc}
                onChange={(e) => setNewInq({ ...newInq, firstItemDesc: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-base sm:text-xs"
              />
              <button type="submit" className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">
                Save Inquiry
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NEW PURCHASE ORDER WITH SMART VENDOR, SO & ITEM DROPDOWNS + "+ CREATE NEW" */}
      {showNewPOModal && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">Create Purchase Order (PO)</h3>
              <button onClick={() => setShowNewPOModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreatePO} className="space-y-3 text-xs">
              <SmartEntitySelect
                label="Link to Sales Order (Optional)"
                placeholder="Search SO number or customer..."
                items={salesOrderSelectOptions}
                value={newPO.soId}
                onChange={(val) => setNewPO({ ...newPO, soId: val })}
              />

              <SmartEntitySelect
                label="Supplier / Vendor (Search or Create New)"
                placeholder="Search vendor name, code, currency..."
                items={vendorSelectOptions}
                value={newPO.vendorId}
                createNewLabel="Create New Vendor"
                onCreateNew={() => setQuickCreateType('vendor')}
                onChange={handleSelectVendorForPO}
              />

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Supplier Name *"
                  value={newPO.supplierName}
                  onChange={(e) => setNewPO({ ...newPO, supplierName: e.target.value })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5"
                />
                <input
                  type="text"
                  placeholder="Supplier VAT No (if KSA)"
                  value={newPO.supplierVat}
                  onChange={(e) => setNewPO({ ...newPO, supplierVat: e.target.value })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5"
                />
              </div>

              <SmartEntitySelect
                label="Item / Service (Search or Create New)"
                placeholder="Search item code or name..."
                items={itemSelectOptions}
                value={newPO.itemId}
                createNewLabel="Create New Item / Service"
                onCreateNew={() => setQuickCreateType('item')}
                onChange={handleSelectItemForPO}
              />

              <input
                type="text"
                required
                placeholder="Item Description *"
                value={newPO.itemDesc}
                onChange={(e) => setNewPO({ ...newPO, itemDesc: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5"
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  required
                  placeholder="Qty"
                  value={newPO.itemQty}
                  onChange={(e) => setNewPO({ ...newPO, itemQty: e.target.value })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5"
                />
                <select
                  value={newPO.currency}
                  onChange={(e) => setNewPO({ ...newPO, currency: e.target.value, fxRate: fxRates[e.target.value] || 1 })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5 bg-white font-semibold"
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="Unit Cost (FX)"
                  value={newPO.unitCostFx}
                  onChange={(e) => setNewPO({ ...newPO, unitCostFx: e.target.value })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-600 mb-1">Estimated Freight / Customs / Clearance (SAR)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newPO.landedCostSar}
                  onChange={(e) => setNewPO({ ...newPO, landedCostSar: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5"
                />
              </div>
              <button type="submit" className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">
                Issue Purchase Order
              </button>
            </form>
          </div>
        </div>
      )}

      {/* INLINE QUICK-CREATE MODALS TRIGGERED FROM ANY "+ CREATE NEW" DROPDOWN */}
      {quickCreateType === 'customer' && (
        <div className="fixed inset-0 bg-slate-950/80 z-[60] flex items-center justify-center p-4">
          <form onSubmit={handleQuickCreateCustomer} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="font-bold text-sm">Quick-Create Customer Master</span>
              <button type="button" onClick={() => setQuickCreateType(null)}><X className="w-4 h-4" /></button>
            </div>
            <input type="text" required placeholder="Company Name (EN) *" value={quickCust.name_en} onChange={(e) => setQuickCust({ ...quickCust, name_en: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <input type="text" dir="rtl" required placeholder="الاسم القانوني بالعربية *" value={quickCust.name_ar} onChange={(e) => setQuickCust({ ...quickCust, name_ar: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <div className="grid grid-cols-2 gap-2">
              <select value={quickCust.customer_type} onChange={(e) => setQuickCust({ ...quickCust, customer_type: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 bg-white">
                <option value="B2B">B2B (VAT Req)</option>
                <option value="B2C">B2C (Simplified)</option>
              </select>
              <input type="text" maxLength={15} required={quickCust.customer_type === 'B2B'} placeholder="15-Digit VAT *" value={quickCust.vat_number} onChange={(e) => setQuickCust({ ...quickCust, vat_number: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" required placeholder="CR Number *" value={quickCust.cr_number} onChange={(e) => setQuickCust({ ...quickCust, cr_number: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
              <input type="text" required placeholder="Contact Person *" value={quickCust.contact_person} onChange={(e) => setQuickCust({ ...quickCust, contact_person: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="tel" required placeholder="Phone *" value={quickCust.phone} onChange={(e) => setQuickCust({ ...quickCust, phone: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
              <input type="email" required placeholder="Email *" value={quickCust.email} onChange={(e) => setQuickCust({ ...quickCust, email: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <button type="submit" className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">Save &amp; Select Customer</button>
          </form>
        </div>
      )}

      {quickCreateType === 'vendor' && (
        <div className="fixed inset-0 bg-slate-950/80 z-[60] flex items-center justify-center p-4">
          <form onSubmit={handleQuickCreateVendor} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="font-bold text-sm">Quick-Create Vendor / Supplier</span>
              <button type="button" onClick={() => setQuickCreateType(null)}><X className="w-4 h-4" /></button>
            </div>
            <input type="text" required placeholder="Supplier Name (EN) *" value={quickVend.name_en} onChange={(e) => setQuickVend({ ...quickVend, name_en: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <div className="grid grid-cols-2 gap-2">
              <select value={quickVend.vendor_origin} onChange={(e) => setQuickVend({ ...quickVend, vendor_origin: e.target.value, default_currency: e.target.value === 'KSA' ? 'SAR' : 'USD' })} className="border border-slate-300 rounded-xl px-3 py-2 bg-white">
                <option value="KSA">KSA Local</option>
                <option value="International">International</option>
              </select>
              <select value={quickVend.default_currency} onChange={(e) => setQuickVend({ ...quickVend, default_currency: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 bg-white">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" placeholder="VAT No (if KSA)" value={quickVend.vat_number} onChange={(e) => setQuickVend({ ...quickVend, vat_number: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 font-mono" />
              <input type="text" required placeholder="CR / Reg No *" value={quickVend.cr_number} onChange={(e) => setQuickVend({ ...quickVend, cr_number: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" required placeholder="Contact Person *" value={quickVend.contact_person} onChange={(e) => setQuickVend({ ...quickVend, contact_person: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
              <input type="tel" required placeholder="Phone *" value={quickVend.phone} onChange={(e) => setQuickVend({ ...quickVend, phone: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <button type="submit" className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">Save &amp; Select Vendor</button>
          </form>
        </div>
      )}

      {quickCreateType === 'item' && (
        <div className="fixed inset-0 bg-slate-950/80 z-[60] flex items-center justify-center p-4">
          <form onSubmit={handleQuickCreateItem} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="font-bold text-sm">Quick-Create Item / Service (ZATCA)</span>
              <button type="button" onClick={() => setQuickCreateType(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={quickItem.item_type} onChange={(e) => setQuickItem({ ...quickItem, item_type: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 bg-white font-bold">
                <option value="Goods">Goods</option>
                <option value="Service">Service</option>
              </select>
              <select value={quickItem.uom} onChange={(e) => setQuickItem({ ...quickItem, uom: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 bg-white">
                {[...STANDARD_UOMS, ...customUoms].map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
              </select>
            </div>
            <input type="text" required placeholder="Description (English) *" value={quickItem.name_en} onChange={(e) => setQuickItem({ ...quickItem, name_en: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <input type="text" dir="rtl" required placeholder="الوصف بالعربية *" value={quickItem.name_ar} onChange={(e) => setQuickItem({ ...quickItem, name_ar: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" step="0.01" required placeholder="Sales Price (SAR) *" value={quickItem.sales_price_sar} onChange={(e) => setQuickItem({ ...quickItem, sales_price_sar: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
              <div className="flex gap-1">
                <select value={quickItem.purchase_currency} onChange={(e) => setQuickItem({ ...quickItem, purchase_currency: e.target.value })} className="border border-slate-300 rounded-xl px-2 py-2 bg-white">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input type="number" step="0.01" required placeholder="Cost *" value={quickItem.purchase_price} onChange={(e) => setQuickItem({ ...quickItem, purchase_price: e.target.value })} className="w-full border border-slate-300 rounded-xl px-2.5 py-2" />
              </div>
            </div>
            <select value={quickItem.zatca_vat_type} onChange={(e) => setQuickItem({ ...quickItem, zatca_vat_type: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white">
              {ZATCA_VAT_TYPES.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
            </select>
            <button type="submit" className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">Save &amp; Select Item</button>
          </form>
        </div>
      )}

      {quickCreateType === 'salesman' && (
        <div className="fixed inset-0 bg-slate-950/80 z-[60] flex items-center justify-center p-4">
          <form onSubmit={handleCreateTeamMember} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="font-bold text-sm">Quick-Create Salesman Account</span>
              <button type="button" onClick={() => setQuickCreateType(null)}><X className="w-4 h-4" /></button>
            </div>
            <input type="text" required placeholder="Salesman Full Name *" value={newMember.full_name} onChange={(e) => setNewMember({ ...newMember, full_name: e.target.value, is_salesman: true })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <input type="email" required placeholder="Work Email (Login ID) *" value={newMember.email} onChange={(e) => setNewMember({ ...newMember, email: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2" />
            <input type="text" required minLength={6} placeholder="Initial Password (Min 6 chars) *" value={newMember.password} onChange={(e) => setNewMember({ ...newMember, password: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono" />
            <div className="grid grid-cols-2 gap-2">
              <select value={newMember.division} onChange={(e) => setNewMember({ ...newMember, division: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 bg-white">
                <option value="MEP">MEP Division</option>
                <option value="IT & ELV">IT &amp; ELV Division</option>
              </select>
              <input type="number" step="0.5" min="0" max="100" required placeholder="Profit Share % *" value={newMember.commission_pct} onChange={(e) => setNewMember({ ...newMember, commission_pct: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2" />
            </div>
            <button type="submit" disabled={memberCreating} className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">
              {memberCreating ? 'Creating...' : 'Create & Select Salesman'}
            </button>
          </form>
        </div>
      )}

      {/* MODAL: FULL OR PARTIAL DELIVERY NOTE */}
      {deliveryModalSO && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">Record Delivery — {deliveryModalSO.so_number}</h3>
              <button onClick={() => setDeliveryModalSO(null)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleRecordDelivery} className="space-y-3 text-xs">
              {(deliveryModalSO.items || []).map((it) => {
                const remaining = Math.max(0, Number(it.orderedQty) - Number(it.deliveredQty || 0));
                return (
                  <div key={it.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold">{it.desc}</div>
                      <div className="text-slate-500">Ordered: {it.orderedQty} • Pending: {remaining}</div>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max={remaining}
                      value={deliveryQtys[it.id] ?? remaining}
                      onChange={(e) => setDeliveryQtys({ ...deliveryQtys, [it.id]: e.target.value })}
                      className="w-20 border border-slate-300 rounded-lg px-2.5 py-1.5 text-right font-bold bg-white"
                    />
                  </div>
                );
              })}
              <input
                type="text"
                placeholder="Driver / Waybill / Site Receiver Notes"
                value={deliveryNotesText}
                onChange={(e) => setDeliveryNotesText(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5"
              />
              <button type="submit" className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer">
                Confirm &amp; Issue Delivery Note
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ZATCA BILINGUAL INVOICE PREVIEW */}
      {previewInvoice && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <span className="font-bold text-base">ZATCA Tax Invoice • فاتورة ضريبية</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Print / PDF
                </button>
                <button onClick={() => setPreviewInvoice(null)}><X className="w-5 h-5" /></button>
              </div>
            </div>

            <div className="flex justify-between items-start gap-4 border-b pb-4">
              <div className="space-y-1 text-xs">
                <div className="text-lg font-bold text-slate-900">{company.nameEn}</div>
                <div className="text-sm font-bold text-blue-700">{company.nameAr}</div>
                <div className="text-slate-600">{company.addressEn} | {company.addressAr}</div>
                <div className="font-mono font-semibold">VAT Reg / الرقم الضريبي: {company.vatNumber}</div>
                <div className="font-mono">CR / السجل التجاري: {company.crNumber}</div>
              </div>

              <div className="text-center shrink-0">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(previewInvoice.qr_base64)}`}
                  alt="ZATCA TLV QR Code"
                  className="w-28 h-28 border border-slate-200 rounded-lg p-1 mx-auto"
                />
                <div className="text-[10px] text-slate-500 mt-1 font-mono">ZATCA TLV QR</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3.5 rounded-xl">
              <div>
                <div className="text-slate-400">Invoice No / رقم الفاتورة</div>
                <div className="font-bold">{previewInvoice.invoice_number}</div>
              </div>
              <div>
                <div className="text-slate-400">Issue Date / التاريخ</div>
                <div className="font-bold">{new Date(previewInvoice.issued_at).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-slate-400">Customer / العميل</div>
                <div className="font-bold">{previewInvoice.client_name}</div>
              </div>
              <div>
                <div className="text-slate-400">ZATCA UUID</div>
                <div className="font-mono text-[10px] truncate">{previewInvoice.zatca_uuid}</div>
              </div>
            </div>

            <table className="w-full text-xs border border-slate-200">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-2 text-left">Description / البيان</th>
                  <th className="p-2 text-right">Qty / الكمية</th>
                  <th className="p-2 text-right">Unit Price / السعر</th>
                  <th className="p-2 text-right">Total / الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(previewInvoice.items || []).map((it, idx) => (
                  <tr key={idx}>
                    <td className="p-2">{it.desc}</td>
                    <td className="p-2 text-right">{it.qty}</td>
                    <td className="p-2 text-right">{formatSAR(it.unitSellSar)}</td>
                    <td className="p-2 text-right font-semibold">{formatSAR(Number(it.qty) * Number(it.unitSellSar))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="ml-auto max-w-xs space-y-1 text-xs">
              <div className="flex justify-between">
                <span>Subtotal (Excl. VAT) / المجموع الفرعي:</span>
                <span className="font-semibold">SAR {formatSAR(previewInvoice.subtotal_sar)}</span>
              </div>
              <div className="flex justify-between">
                <span>VAT (15%) / ضريبة القيمة المضافة:</span>
                <span className="font-semibold">SAR {formatSAR(previewInvoice.vat_sar)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-blue-700 pt-1.5 border-t">
                <span>Total Incl. VAT / الإجمالي شامل الضريبة:</span>
                <span>SAR {formatSAR(previewInvoice.grand_total_sar)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CUSTOMER PAYMENT RECEIPT */}
      {paymentModalInv && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">Receive Customer Payment — {paymentModalInv.invoice_number}</h3>
              <button onClick={() => setPaymentModalInv(null)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleRecordCustomerPayment} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Amount Received (SAR) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-base font-bold"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="border border-slate-300 rounded-xl px-3 py-2.5 bg-white"
                >
                  <option value="Bank Transfer">Bank Transfer (SAR)</option>
                  <option value="Mada / POS">Mada / POS</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Cash">Cash</option>
                </select>
                <input
                  type="text"
                  placeholder="Bank Ref / Transfer ID"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  className="border border-slate-300 rounded-xl px-3 py-2.5"
                />
              </div>
              <button type="submit" className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold cursor-pointer">
                Post Receipt &amp; Unlock Sales Profit Share
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}