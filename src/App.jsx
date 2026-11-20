import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Plus, Phone, MessageSquare, CheckCircle2,
  AlertTriangle, Building2, ShieldCheck, X,
  Lock, Eye, EyeOff, LogOut, RefreshCw, ArrowRight, Layers, Globe,
  Trash2, Truck, Receipt, ShoppingBag, Percent, Settings, Printer, QrCode
} from 'lucide-react';
import { generateZatcaQrBase64, getZatcaComplianceAdvice, formatSAR } from './erp/erpEngine';

const SUPABASE_URL = 'https://jknuhynysewoizjxbidw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprbnVoeW55c2V3b2l6anhiaWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxODgwMDMsImV4cCI6MjExMDc2NDAwM30.cM0tm_pnvgIN40MYrIB92RR4g4bLvFQx415hvOWuLsU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight">
            {company.nameEn}
          </h1>
          <p className="text-base sm:text-xl text-blue-300 font-semibold mt-1">{company.nameAr}</p>
          <p className="mt-3 text-sm sm:text-base text-slate-300 max-w-xl leading-relaxed">
            Integrated Sales Orders, Partial/Full Deliveries, ZATCA E-Invoicing, Multi-Currency Purchase Cycle &amp; Collection-Based Profit Share.
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

  const [activeModule, setActiveModule] = useState('crm');

  const [inquiries, setInquiries] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [deliveryNotes, setDeliveryNotes] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [commissions, setCommissions] = useState([]);

  const [selectedInqId, setSelectedInqId] = useState(null);
  const [showNewInqModal, setShowNewInqModal] = useState(false);
  const [newInq, setNewInq] = useState({
    clientName: '',
    clientVat: '',
    contactPerson: '',
    phone: '',
    email: '',
    division: 'MEP',
    salesmanId: '',
    firstItemDesc: '',
    firstItemQty: 1,
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
    supplierName: '',
    supplierVat: '',
    currency: 'USD',
    fxRate: 3.75,
    landedCostSar: 0,
    itemDesc: '',
    itemQty: 1,
    unitCostFx: 0,
    isStockedItem: false,
  });

  const [settingsSavedMsg, setSettingsSavedMsg] = useState('');

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
      commRes,
      profRes,
    ] = await Promise.all([
      supabase.from('app_settings').select('*'),
      supabase.from('inquiries').select('*').order('updated_at', { ascending: false }),
      supabase.from('sales_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('delivery_notes').select('*').order('delivered_at', { ascending: false }),
      supabase.from('invoices').select('*').order('issued_at', { ascending: false }),
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('commission_ledger').select('*').order('updated_at', { ascending: false }),
      supabase.from('team_profiles').select('*').order('full_name'),
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
    if (commRes.data) setCommissions(commRes.data);
    if (profRes.data) setTeamProfiles(profRes.data);
    setSyncStatus('live');
  };

  useEffect(() => {
    if (!session) return;
    refreshAllErpData();

    const channel = supabase
      .channel('horizon-erp-phase1')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        refreshAllErpData();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session]);

  const salesmenList = useMemo(
    () => teamProfiles.filter((p) => p.is_salesman || ['sales_mep', 'sales_it'].includes(p.role_key)),
    [teamProfiles]
  );

  const annualTaxableRevenueSAR = useMemo(
    () => invoices.reduce((sum, inv) => sum + Number(inv.subtotal_sar || 0), 0),
    [invoices]
  );
  const zatcaAdvice = useMemo(
    () => getZatcaComplianceAdvice(annualTaxableRevenueSAR, company.zatcaPhase2Connected),
    [annualTaxableRevenueSAR, company.zatcaPhase2Connected]
  );

  const handleCreateInquiry = async (e) => {
    e.preventDefault();
    const num = Math.floor(101 + Math.random() * 898);
    const chosenSalesman = teamProfiles.find((p) => p.id === newInq.salesmanId) || salesmenList[0];
    const obj = {
      id: `INQ-${new Date().getFullYear()}-${num}`,
      refNo: `HBS-${newInq.division === 'MEP' ? 'MEP' : 'IT'}-${num}`,
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
          desc: newInq.firstItemDesc,
          qty: Number(newInq.firstItemQty) || 1,
          unit: 'Nos',
          buyCurrency: 'USD',
          buyUnitCost: 0,
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
    setNewInq({ clientName: '', clientVat: '', contactPerson: '', phone: '', email: '', division: 'MEP', salesmanId: '', firstItemDesc: '', firstItemQty: 1 });
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
    const soNum = `SO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 8999)}`;

    const soItems = (inq.boqItems || []).map((b) => {
      const unitCostSar = (Number(b.buyUnitCost) || 0) * (fxRates[b.buyCurrency] || 1);
      const unitSellSar = unitCostSar > 0 ? unitCostSar * marginFactor : 0;
      return {
        id: b.id,
        desc: b.desc,
        orderedQty: Number(b.qty) || 1,
        deliveredQty: 0,
        invoicedQty: 0,
        unit: b.unit || 'Nos',
        unitCostSar,
        unitSellSar,
      };
    });

    const newSO = {
      id: `so-${Date.now()}`,
      so_number: soNum,
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
    setActiveModule('sales_orders');
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

    const dnNum = `DN-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 8999)}`;
    const newDN = {
      id: `dn-${Date.now()}`,
      dn_number: dnNum,
      so_id: deliveryModalSO.id,
      so_number: deliveryModalSO.so_number,
      client_name: deliveryModalSO.client_name,
      delivery_type: allDelivered ? 'full' : 'partial',
      items: deliveredLines,
      delivered_by: profile?.full_name || 'Logistics',
      notes: deliveryNotesText,
    };

    await supabase.from('delivery_notes').insert(newDN);
    await supabase
      .from('sales_orders')
      .update({
        items: updatedItems,
        status: allDelivered ? 'delivered' : 'partially_delivered',
        updated_at: new Date().toISOString(),
      })
      .eq('id', deliveryModalSO.id);

    setDeliveryModalSO(null);
    refreshAllErpData();
  };

  const handleGenerateZatcaInvoiceFromDN = async (dn) => {
    const parentSO = salesOrders.find((s) => s.id === dn.so_id);
    const subtotal = (dn.items || []).reduce((s, it) => s + Number(it.qty) * Number(it.unitSellSar), 0);
    const landedCost = (dn.items || []).reduce((s, it) => s + Number(it.qty) * Number(it.unitCostSar || 0), 0);
    const vat = subtotal * 0.15;
    const grandTotal = subtotal + vat;
    const invNum = `INV-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 89999)}`;
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

    setActiveModule('invoices');
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
      receipt_number: `RCP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 8999)}`,
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

  const handleCreatePO = async (e) => {
    e.preventDefault();
    const linkedSO = salesOrders.find((s) => s.id === newPO.soId);
    const goodsFx = (Number(newPO.itemQty) || 1) * (Number(newPO.unitCostFx) || 0);
    const goodsSar = goodsFx * (Number(newPO.fxRate) || 1);
    const landedSar = Number(newPO.landedCostSar) || 0;
    const vatSar = newPO.supplierVat ? (goodsSar + landedSar) * 0.15 : 0;

    await supabase.from('purchase_orders').insert({
      id: `po-${Date.now()}`,
      po_number: `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 8999)}`,
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
    refreshAllErpData();
  };

  const advancePurchaseStage = async (po, nextStatus, extraPatch = {}) => {
    await supabase
      .from('purchase_orders')
      .update({ status: nextStatus, ...extraPatch, updated_at: new Date().toISOString() })
      .eq('id', po.id);
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-24 sm:pb-10">
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3.5 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-base shrink-0">
              H
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-sm sm:text-base truncate">{company.nameEn}</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  ERP Phase 1 • {syncStatus === 'live' ? 'Live' : 'Sync'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                {profile?.full_name} ({profile?.role_label}) • VAT: {company.vatNumber}
              </p>
            </div>
          </div>

          <button
            onClick={() => supabase.auth.signOut()}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-slate-950 border-t border-slate-800 px-3.5 sm:px-6">
          <div className="max-w-7xl mx-auto flex items-center gap-1.5 overflow-x-auto py-2">
            {[
              { id: 'crm', label: '1. Quotes & CRM', icon: Layers, count: inquiries.length },
              { id: 'sales_orders', label: '2. Sales Orders & Deliveries', icon: Truck, count: salesOrders.length },
              { id: 'invoices', label: '3. ZATCA Invoices & AR', icon: Receipt, count: invoices.length },
              { id: 'purchase', label: '4. Purchase Cycle', icon: ShoppingBag, count: purchaseOrders.length },
              { id: 'profit_share', label: '5. Sales Profit Share', icon: Percent, count: commissions.length },
              { id: 'settings', label: '6. Company & Salesman Rules', icon: Settings },
            ].map((mod) => {
              const Icon = mod.icon;
              return (
                <button
                  key={mod.id}
                  onClick={() => setActiveModule(mod.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition cursor-pointer ${
                    activeModule === mod.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{mod.label}</span>
                  {typeof mod.count === 'number' && (
                    <span className="px-1.5 py-0.2 rounded-full bg-black/25 text-[10px]">{mod.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3.5 sm:px-6 py-5 space-y-5">
        <div className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${zatcaAdvice.badgeClass}`}>
          <div className="flex items-start sm:items-center gap-2">
            <QrCode className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <span className="font-bold">{zatcaAdvice.wave}: </span>
              <span>{zatcaAdvice.statusText}</span>
            </div>
          </div>
          <div className="font-bold whitespace-nowrap">
            YTD Taxable Sales: SAR {formatSAR(annualTaxableRevenueSAR)}
          </div>
        </div>

        {activeModule === 'crm' && (
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
                            Sales: {inq.assignedSalesName} ({inq.commissionPct || 0}% Profit Share)
                          </span>
                        </div>
                        <h3 className="text-base font-bold mt-1">{inq.clientName}</h3>
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

        {activeModule === 'sales_orders' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">Sales Orders (SO) &amp; Delivery Execution</h2>
              <p className="text-xs text-slate-500">Issue Full or Partial Delivery Notes against open Sales Orders, then generate ZATCA Invoices.</p>
            </div>

            {salesOrders.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                No Sales Orders yet. Convert an approved quote from <strong>1. Quotes &amp; CRM</strong> to create a Sales Order.
              </div>
            ) : (
              <div className="grid gap-4">
                {salesOrders.map((so) => (
                  <div key={so.id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded">{so.so_number}</span>
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

            {deliveryNotes.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-slate-200">
                <h3 className="text-sm font-bold text-slate-800">Issued Delivery Notes (DN)</h3>
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
              </div>
            )}
          </div>
        )}

        {activeModule === 'invoices' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">ZATCA Tax Invoices &amp; Customer Collections</h2>
              <p className="text-xs text-slate-500">
                Posted invoices are immutable per ZATCA regulations. Recording customer payments automatically unlocks Salesman Profit Share.
              </p>
            </div>

            {invoices.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                No ZATCA invoices issued yet. Record a Delivery Note in Module 2 and click <strong>Issue ZATCA Tax Invoice</strong>.
              </div>
            ) : (
              <div className="grid gap-3">
                {invoices.map((inv) => {
                  const balanceDue = Math.max(0, Number(inv.grand_total_sar) - Number(inv.paid_amount_sar || 0));
                  return (
                    <div key={inv.id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded">{inv.invoice_number}</span>
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

        {activeModule === 'purchase' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Purchase Full Cycle &amp; Landed Costing</h2>
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
                          <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded">{po.po_number}</span>
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
                            onClick={() => advancePurchaseStage(po, 'grn_completed')}
                            className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
                          >
                            Record GRN (Goods Received)
                          </button>
                        )}
                        {po.status === 'grn_completed' && (
                          <button
                            onClick={() => advancePurchaseStage(po, 'billed', { bill_status: 'posted' })}
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

        {activeModule === 'profit_share' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">Sales Profit Share Ledger (Collection-Based)</h2>
              <p className="text-xs text-slate-500">
                Calculated strictly on <strong>Net Profit</strong> and unlocked proportionally as <strong>Customer Payments</strong> are collected.
              </p>
            </div>

            {commissions.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                No profit-share entries yet. Assign a salesman with a Commission % and issue an invoice to track profit share.
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

        {activeModule === 'settings' && (
          <div className="grid lg:grid-cols-2 gap-6">
            <form onSubmit={handleSaveCompanySettings} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
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
                  <input
                    type="text"
                    value={company.nameEn}
                    onChange={(e) => setCompany({ ...company, nameEn: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base sm:text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Company Legal Name (Arabic)</label>
                  <input
                    type="text"
                    dir="rtl"
                    value={company.nameAr}
                    onChange={(e) => setCompany({ ...company, nameAr: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base sm:text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">15-Digit ZATCA VAT Number</label>
                  <input
                    type="text"
                    maxLength={15}
                    value={company.vatNumber}
                    onChange={(e) => setCompany({ ...company, vatNumber: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono text-base sm:text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Commercial Registration (CR)</label>
                  <input
                    type="text"
                    value={company.crNumber}
                    onChange={(e) => setCompany({ ...company, crNumber: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono text-base sm:text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Address (English)</label>
                  <input
                    type="text"
                    value={company.addressEn}
                    onChange={(e) => setCompany({ ...company, addressEn: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base sm:text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Address (Arabic)</label>
                  <input
                    type="text"
                    dir="rtl"
                    value={company.addressAr}
                    onChange={(e) => setCompany({ ...company, addressAr: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base sm:text-xs"
                  />
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

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
              >
                Save Company Settings
              </button>
            </form>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">Team Roles &amp; Salesman Profit Share (%)</h2>
                <p className="text-xs text-slate-500">
                  Configure which team members are eligible as Salesmen and set their individual Net Profit Share percentage.
                </p>
              </div>

              <div className="space-y-3">
                {teamProfiles.map((member) => (
                  <div key={member.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-sm text-slate-900">{member.full_name}</div>
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
          </div>
        )}
      </main>

      {/* INQUIRY BOQ & MULTI-CURRENCY COSTING DRAWER */}
      {selectedInq && (
        <div className="fixed inset-0 bg-slate-950/70 z-40 flex justify-end">
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
                        { id: `b-${Date.now()}`, desc: 'New Item', qty: 1, unit: 'Nos', buyCurrency: 'USD', buyUnitCost: 0 },
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

      {/* MODAL: NEW INQUIRY */}
      {showNewInqModal && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">New Client Inquiry</h3>
              <button onClick={() => setShowNewInqModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateInquiry} className="space-y-3 text-xs">
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
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={newInq.division}
                  onChange={(e) => setNewInq({ ...newInq, division: e.target.value })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5 bg-white text-base sm:text-xs"
                >
                  <option value="MEP">MEP Trading</option>
                  <option value="IT & ELV">IT &amp; ELV</option>
                </select>
                <select
                  required
                  value={newInq.salesmanId}
                  onChange={(e) => setNewInq({ ...newInq, salesmanId: e.target.value })}
                  className="border border-slate-300 rounded-xl px-3 py-2.5 bg-white text-base sm:text-xs"
                >
                  <option value="">Assign Salesman Manually...</option>
                  {salesmenList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} ({s.commission_pct || 0}% Share)
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                required
                placeholder="Primary Item / Scope *"
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

      {/* MODAL: NEW PURCHASE ORDER */}
      {showNewPOModal && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base">Create Purchase Order (PO)</h3>
              <button onClick={() => setShowNewPOModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreatePO} className="space-y-3 text-xs">
              <select
                value={newPO.soId}
                onChange={(e) => setNewPO({ ...newPO, soId: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 bg-white"
              >
                <option value="">Link to Sales Order (Optional - Back-to-Back)</option>
                {salesOrders.map((s) => (
                  <option key={s.id} value={s.id}>{s.so_number} — {s.client_name}</option>
                ))}
              </select>
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
    </div>
  );
}