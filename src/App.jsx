import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Search, Plus, Phone, Mail, MessageSquare, CheckCircle2, Clock,
  AlertTriangle, Building2, DollarSign, ShieldCheck, Users, Filter,
  ChevronRight, X, Send, Calculator, FileText, Lock, Eye, EyeOff,
  LogOut, RefreshCw, Sparkles, ArrowRight, Layers, Globe
} from 'lucide-react';

// ============================================================================
// SUPABASE CLIENT CONFIGURATION
// ============================================================================
const SUPABASE_URL = 'https://hqzqhydegxvpqqczvjmv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxenFoeWRlZ3h2cHFxY3p2am12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5OTk5MDgsImV4cCI6MjExMDU3NTkwOH0.K_iCwMfCo2CzXFK9UCYABfixq0q9ZH-oY9oeR0tCT8k';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================================
// CONSTANTS & PIPELINE STAGES
// ============================================================================
const STAGES = [
  { id: 'new_inquiry', label: '1. New Inquiry', owner: 'Salesman', badge: 'bg-slate-100 text-slate-700 border-slate-300' },
  { id: 'rfq_suppliers', label: '2. Supplier RFQ', owner: 'Purchase', badge: 'bg-amber-50 text-amber-800 border-amber-300' },
  { id: 'manager_approval', label: '3. Manager Approval', owner: 'Manager', badge: 'bg-purple-50 text-purple-800 border-purple-300' },
  { id: 'quoted', label: '4. Quoted (SAR)', owner: 'Sales / Coord', badge: 'bg-blue-50 text-blue-800 border-blue-300' },
  { id: 'follow_up', label: '5. Active Follow-Up', owner: 'Coordinator', badge: 'bg-indigo-50 text-indigo-800 border-indigo-300' },
  { id: 'won', label: '6. Won / PO Received', owner: 'All Team', badge: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  { id: 'lost', label: '7. Closed / Lost', owner: 'All Team', badge: 'bg-rose-50 text-rose-800 border-rose-300' },
];

const ROLES = [
  { key: 'all', label: 'All Team Pipeline' },
  { key: 'sales_mep', label: 'Salesman 1 (MEP)' },
  { key: 'sales_it', label: 'Salesman 2 (IT & ELV)' },
  { key: 'purchase', label: 'Purchase Officer' },
  { key: 'coordinator', label: 'Sales Coordinator' },
  { key: 'manager', label: 'Sales Manager' },
];

const CURRENCIES = ['SAR', 'USD', 'EUR', 'GBP', 'AED'];

const DEFAULT_FX = { SAR: 1, USD: 3.75, EUR: 4.08, GBP: 4.78, AED: 1.021 };

const SEED_INQUIRIES = [
  {
    id: 'INQ-2026-101',
    refNo: 'HBS-MEP-26-101',
    clientName: 'Al-Riyadh Modern Contracting Co.',
    contactPerson: 'Eng. Abdullah Al-Mansour',
    phone: '+966 50 441 8820',
    email: 'a.mansour@rmc-ksa.com',
    division: 'MEP',
    assignedSalesKey: 'sales_mep',
    assignedSalesName: 'Tariq Al-Harbi',
    stage: 'manager_approval',
    marginPercent: 18,
    managerApproved: false,
    approvedBy: '',
    approvedAt: '',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    lastFollowUpAt: new Date(Date.now() - 86400000).toISOString(),
    boqItems: [
      { id: 'b1', desc: 'Chilled Water Centrifugal Pump 45kW (Grundfos/eq)', qty: 2, unit: 'Nos', buyCurrency: 'EUR', buyUnitCost: 4200, supplier: 'EuroFlow GmbH' },
      { id: 'b2', desc: 'Motorized Butterfly Valve DN150 PN16', qty: 6, unit: 'Nos', buyCurrency: 'USD', buyUnitCost: 340, supplier: 'Gulf Valve Trading' },
    ],
    vendorQuotes: [
      { id: 'v1', supplier: 'EuroFlow GmbH', currency: 'EUR', amount: 8400, leadTime: '3 Weeks Ex-Works', selected: true },
      { id: 'v2', supplier: 'Riyadh Pumps Est.', currency: 'SAR', amount: 36500, leadTime: '4 Weeks DDP', selected: false },
    ],
    followUps: [
      { id: 'f1', channel: 'Email', note: 'BOQ received and forwarded to Purchase for European pump sizing.', by: 'Tariq Al-Harbi', at: new Date(Date.now() - 86400000 * 2).toISOString() },
      { id: 'f2', channel: 'WhatsApp', note: 'Supplier pricing updated in EUR & USD. Submitted for Sales Manager verbal/system approval.', by: 'Khalid Al-Qahtani', at: new Date(Date.now() - 3600000 * 6).toISOString() },
    ],
  },
  {
    id: 'INQ-2026-102',
    refNo: 'HBS-IT-26-102',
    clientName: 'Red Sea Logistics & Warehousing',
    contactPerson: 'Mr. Majed Al-Shehri',
    phone: '+966 55 912 3304',
    email: 'm.shehri@redsealogistics.sa',
    division: 'IT & ELV',
    assignedSalesKey: 'sales_it',
    assignedSalesName: 'Faisal Al-Otaibi',
    stage: 'follow_up',
    marginPercent: 22,
    managerApproved: true,
    approvedBy: 'Omar Al-Ghamdi',
    approvedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    lastFollowUpAt: new Date(Date.now() - 3600000 * 54).toISOString(), // >48h overdue alert
    boqItems: [
      { id: 'b3', desc: '48-Port PoE+ Layer 3 Core Switch + Dual PSU', qty: 4, unit: 'Nos', buyCurrency: 'USD', buyUnitCost: 1850, supplier: 'TechDisti Middle East' },
      { id: 'b4', desc: '4MP Outdoor Bullet IP Camera IP67 + Pole Mount', qty: 24, unit: 'Nos', buyCurrency: 'USD', buyUnitCost: 145, supplier: 'SecureVision Dubai' },
      { id: 'b5', desc: 'Installation, Fiber Splicing & Commissioning', qty: 1, unit: 'Lot', buyCurrency: 'SAR', buyUnitCost: 8500, supplier: 'In-House IT Team' },
    ],
    vendorQuotes: [
      { id: 'v3', supplier: 'TechDisti Middle East', currency: 'USD', amount: 7400, leadTime: '5 Days Jebel Ali', selected: true },
    ],
    followUps: [
      { id: 'f3', channel: 'Email', note: 'Official SAR Quotation (incl. 15% VAT) sent to client procurement.', by: 'Sara Al-Zahrani', at: new Date(Date.now() - 86400000 * 3).toISOString() },
      { id: 'f4', channel: 'Phone', note: 'Spoke with Mr. Majed; technical submittals under IT Manager review.', by: 'Sara Al-Zahrani', at: new Date(Date.now() - 3600000 * 54).toISOString() },
    ],
  },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
const formatSAR = (num) =>
  new Intl.NumberFormat('en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num || 0);

const computeFinancials = (inquiry, fxRates) => {
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

const isFollowUpOverdue = (inquiry) => {
  if (!['quoted', 'follow_up'].includes(inquiry.stage)) return false;
  const last = new Date(inquiry.lastFollowUpAt || inquiry.createdAt).getTime();
  return Date.now() - last > 48 * 3600 * 1000;
};

// ============================================================================
// LOGIN LANDING PAGE COMPONENT
// ============================================================================
function LoginLandingPage({ onLoginSuccess }) {
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

      if (error) {
        setErrorMsg(error.message || 'Invalid login credentials. Please contact your Sales Manager.');
      } else if (data?.user) {
        onLoginSuccess(data.user);
      }
    } catch (err) {
      setErrorMsg('Unable to connect to authentication server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col lg:flex-row">
      {/* Left Brand & Workflow Showcase */}
      <div className="lg:w-7/12 p-8 lg:p-16 flex flex-col justify-between bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 border-b lg:border-b-0 lg:border-r border-slate-800">
        <div>
          <div className="inline-flex items-center gap-3 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/20 text-blue-300 text-xs font-semibold tracking-wide uppercase mb-8">
            <Building2 className="w-4 h-4" />
            Kingdom of Saudi Arabia â€¢ Internal Operations Portal
          </div>

          <h1 className="text-3xl lg:text-5xl font-bold tracking-tight text-white leading-tight">
            Horizon Business Solutions Est.
          </h1>
          <p className="mt-4 text-lg text-slate-300 max-w-xl leading-relaxed">
            Unified Sales, Multi-Currency Procurement &amp; Client Follow-Up Workspace for{' '}
            <span className="text-white font-semibold">MEP</span> and{' '}
            <span className="text-white font-semibold">IT / ELV</span> Trading Divisions.
          </p>

          <div className="mt-10 grid sm:grid-cols-2 gap-4 max-w-2xl">
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
              <div className="flex items-center gap-2.5 text-blue-400 font-semibold text-sm mb-1.5">
                <Globe className="w-4 h-4" /> Multi-Currency RFQ â†’ SAR
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Source vendor pricing in USD, EUR, GBP, AED, or SAR and generate accurate SAR quotes with 15% KSA VAT.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
              <div className="flex items-center gap-2.5 text-purple-400 font-semibold text-sm mb-1.5">
                <ShieldCheck className="w-4 h-4" /> Sales Manager Sign-Off
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Built-in verbal and system approval checkpoint before releasing final commercial proposals.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
              <div className="flex items-center gap-2.5 text-emerald-400 font-semibold text-sm mb-1.5">
                <Phone className="w-4 h-4" /> Coordinator Follow-Up Hub
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Track phone, email, and WhatsApp Business follow-ups with automatic 48-hour SLA alerts.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
              <div className="flex items-center gap-2.5 text-amber-400 font-semibold text-sm mb-1.5">
                <Layers className="w-4 h-4" /> Full Team Transparency
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Real-time visibility across Salesmen, Purchase Officer, Sales Coordinator, and Management.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>Â© {new Date().getFullYear()} Horizon Business Solutions Est. All rights reserved.</span>
          <span>Secured by Supabase Row-Level Security</span>
        </div>
      </div>

      {/* Right Sign-In Form */}
      <div className="lg:w-5/12 p-8 lg:p-16 flex items-center justify-center bg-slate-950">
        <div className="w-full max-w-md">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
            <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-6">
              <Lock className="w-6 h-6" />
            </div>

            <h2 className="text-2xl font-bold text-white">Team Member Sign In</h2>
            <p className="text-sm text-slate-400 mt-1">
              Enter your assigned Horizon corporate credentials to access the live pipeline.
            </p>

            {errorMsg && (
              <div className="mt-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSignIn} className="mt-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Work Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@horizon-ksa.com"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                    className="w-full pl-10 pr-11 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 p-0.5"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-blue-600/20 cursor-pointer"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Authenticating...
                  </>
                ) : (
                  <>
                    Sign In to Workspace <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-slate-800 text-center">
              <p className="text-xs text-slate-500">
                Access restricted to authorized Horizon Business Solutions Est. staff. Need an account? Contact your Sales Manager.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN CRM APPLICATION
// ============================================================================
export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState(null);

  // CRM State
  const [inquiries, setInquiries] = useState([]);
  const [fxRates, setFxRates] = useState(DEFAULT_FX);
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [activeRoleFilter, setActiveRoleFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState('boq');
  const [showNewModal, setShowNewModal] = useState(false);

  // New Inquiry Form State
  const [newInq, setNewInq] = useState({
    clientName: '',
    contactPerson: '',
    phone: '',
    email: '',
    division: 'MEP',
    assignedSalesKey: 'sales_mep',
    firstItemDesc: '',
    firstItemQty: 1,
    firstItemUnit: 'Nos',
  });

  // Follow-up Form State
  const [fuChannel, setFuChannel] = useState('Phone');
  const [fuNote, setFuNote] = useState('');

  // Vendor Quote Form State
  const [vqSupplier, setVqSupplier] = useState('');
  const [vqCurrency, setVqCurrency] = useState('USD');
  const [vqAmount, setVqAmount] = useState('');
  const [vqLeadTime, setVqLeadTime] = useState('');

  // --------------------------------------------------------------------------
  // 1. AUTH SESSION & PROFILE INITIALIZATION
  // --------------------------------------------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      if (currentSession?.user) {
        loadUserProfile(currentSession.user);
      } else {
        setAuthLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        loadUserProfile(newSession.user);
      } else {
        setProfile(null);
        setAuthLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (user) => {
    try {
      const { data } = await supabase
        .from('team_profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (data) {
        setProfile(data);
        // Default view: Manager sees 'all', staff sees 'all' with their own actions highlighted
        setActiveRoleFilter('all');
      } else {
        setProfile({
          id: user.id,
          email: user.email,
          full_name: user.email.split('@')[0],
          role_key: 'manager',
          role_label: 'Sales Manager',
        });
      }
    } catch {
      setProfile({
        id: user.id,
        email: user.email,
        full_name: user.email.split('@')[0],
        role_key: 'manager',
        role_label: 'Sales Manager',
      });
    } finally {
      setAuthLoading(false);
    }
  };

  // --------------------------------------------------------------------------
  // 2. LOAD & SUBSCRIBE TO SUPABASE REALTIME DATA
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!session) return;

    let isMounted = true;

    const fetchInitialData = async () => {
      setSyncStatus('syncing');
      try {
        // Fetch FX Settings
        const { data: settingsData } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'fx_rates')
          .single();

        if (isMounted && settingsData?.value) {
          setFxRates(settingsData.value);
        }

        // Fetch Inquiries
        const { data: inqRows, error } = await supabase
          .from('inquiries')
          .select('*')
          .order('updated_at', { ascending: false });

        if (!error && inqRows) {
          if (inqRows.length === 0) {
            // Seed initial demo records into Supabase so the team starts with clear examples
            const seedPayload = SEED_INQUIRIES.map((item) => ({
              id: item.id,
              data: item,
              updated_by: 'System Seed',
            }));
            await supabase.from('inquiries').upsert(seedPayload);
            if (isMounted) setInquiries(SEED_INQUIRIES);
          } else if (isMounted) {
            setInquiries(inqRows.map((r) => r.data));
          }
        }
        if (isMounted) setSyncStatus('live');
      } catch {
        if (isMounted) setSyncStatus('offline');
      }
    };

    fetchInitialData();

    // Realtime subscription for inquiries & FX rates
    const channel = supabase
      .channel('horizon-crm-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inquiries' },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const updated = payload.new.data;
            setInquiries((prev) => {
              const exists = prev.some((i) => i.id === updated.id);
              if (exists) return prev.map((i) => (i.id === updated.id ? updated : i));
              return [updated, ...prev];
            });
          } else if (payload.eventType === 'DELETE') {
            setInquiries((prev) => prev.filter((i) => i.id !== payload.old.id));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_settings' },
        (payload) => {
          if (payload.new?.key === 'fx_rates' && payload.new?.value) {
            setFxRates(payload.new.value);
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [session]);

  // --------------------------------------------------------------------------
  // 3. PERSISTENCE HELPERS (SAVE TO SUPABASE)
  // --------------------------------------------------------------------------
  const saveInquiryToCloud = async (updatedInquiry) => {
    setInquiries((prev) => prev.map((i) => (i.id === updatedInquiry.id ? updatedInquiry : i)));
    setSyncStatus('syncing');
    const { error } = await supabase.from('inquiries').upsert({
      id: updatedInquiry.id,
      data: updatedInquiry,
      updated_at: new Date().toISOString(),
      updated_by: profile?.full_name || session?.user?.email || 'Team User',
    });
    setSyncStatus(error ? 'offline' : 'live');
  };

  const handleFxChange = async (curr, val) => {
    const numeric = parseFloat(val) || 0;
    const nextFx = { ...fxRates, [curr]: numeric };
    setFxRates(nextFx);
    await supabase.from('app_settings').upsert({
      key: 'fx_rates',
      value: nextFx,
      updated_at: new Date().toISOString(),
    });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSelectedId(null);
  };

  // --------------------------------------------------------------------------
  // 4. FILTERED PIPELINE & KPI METRICS
  // --------------------------------------------------------------------------
  const filteredInquiries = useMemo(() => {
    return inquiries.filter((inq) => {
      if (stageFilter !== 'all' && inq.stage !== stageFilter) return false;

      if (activeRoleFilter === 'sales_mep' && inq.assignedSalesKey !== 'sales_mep') return false;
      if (activeRoleFilter === 'sales_it' && inq.assignedSalesKey !== 'sales_it') return false;
      if (activeRoleFilter === 'purchase' && inq.stage !== 'rfq_suppliers') return false;
      if (activeRoleFilter === 'coordinator' && !['quoted', 'follow_up'].includes(inq.stage)) return false;
      if (activeRoleFilter === 'manager' && inq.stage !== 'manager_approval') return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          inq.clientName.toLowerCase().includes(q) ||
          inq.refNo.toLowerCase().includes(q) ||
          inq.contactPerson.toLowerCase().includes(q) ||
          inq.division.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [inquiries, stageFilter, activeRoleFilter, searchTerm]);

  const kpis = useMemo(() => {
    let activePipelineSAR = 0;
    let wonSAR = 0;
    let pendingApprovalCount = 0;
    let overdueFollowUpsCount = 0;

    inquiries.forEach((inq) => {
      const { grandTotalSAR } = computeFinancials(inq, fxRates);
      if (inq.stage === 'won') wonSAR += grandTotalSAR;
      else if (inq.stage !== 'lost') activePipelineSAR += grandTotalSAR;

      if (inq.stage === 'manager_approval') pendingApprovalCount += 1;
      if (isFollowUpOverdue(inq)) overdueFollowUpsCount += 1;
    });

    return { activePipelineSAR, wonSAR, pendingApprovalCount, overdueFollowUpsCount };
  }, [inquiries, fxRates]);

  const selectedInquiry = useMemo(
    () => inquiries.find((i) => i.id === selectedId) || null,
    [inquiries, selectedId]
  );

  // --------------------------------------------------------------------------
  // 5. ACTION HANDLERS (CREATE, BOQ, APPROVAL, FOLLOW-UP)
  // --------------------------------------------------------------------------
  const handleCreateInquiry = async (e) => {
    e.preventDefault();
    const num = Math.floor(103 + Math.random() * 890);
    const salesName = newInq.assignedSalesKey === 'sales_mep' ? 'Tariq Al-Harbi' : 'Faisal Al-Otaibi';
    const divCode = newInq.division === 'MEP' ? 'MEP' : 'IT';
    const createdObj = {
      id: `INQ-2026-${num}`,
      refNo: `HBS-${divCode}-26-${num}`,
      clientName: newInq.clientName,
      contactPerson: newInq.contactPerson,
      phone: newInq.phone,
      email: newInq.email,
      division: newInq.division,
      assignedSalesKey: newInq.assignedSalesKey,
      assignedSalesName: salesName,
      stage: 'new_inquiry',
      marginPercent: 20,
      managerApproved: false,
      approvedBy: '',
      approvedAt: '',
      createdAt: new Date().toISOString(),
      lastFollowUpAt: new Date().toISOString(),
      boqItems: [
        {
          id: `b-${Date.now()}`,
          desc: newInq.firstItemDesc || 'Supply & Delivery as per Client RFQ',
          qty: Number(newInq.firstItemQty) || 1,
          unit: newInq.firstItemUnit || 'Lot',
          buyCurrency: 'USD',
          buyUnitCost: 0,
          supplier: 'TBD',
        },
      ],
      vendorQuotes: [],
      followUps: [
        {
          id: `f-${Date.now()}`,
          channel: 'Email',
          note: `Inquiry logged by ${profile?.full_name || 'Sales Team'}.`,
          by: profile?.full_name || 'Team',
          at: new Date().toISOString(),
        },
      ],
    };

    setInquiries((prev) => [createdObj, ...prev]);
    setShowNewModal(false);
    setSelectedId(createdObj.id);
    setNewInq({
      clientName: '',
      contactPerson: '',
      phone: '',
      email: '',
      division: 'MEP',
      assignedSalesKey: 'sales_mep',
      firstItemDesc: '',
      firstItemQty: 1,
      firstItemUnit: 'Nos',
    });

    await supabase.from('inquiries').upsert({
      id: createdObj.id,
      data: createdObj,
      updated_at: new Date().toISOString(),
      updated_by: profile?.full_name || 'Team',
    });
  };

  const updateSelectedField = (patch) => {
    if (!selectedInquiry) return;
    const updated = { ...selectedInquiry, ...patch };
    saveInquiryToCloud(updated);
  };

  const handleBoqItemChange = (itemId, field, value) => {
    if (!selectedInquiry) return;
    const updatedBoq = selectedInquiry.boqItems.map((item) =>
      item.id === itemId ? { ...item, [field]: value } : item
    );
    updateSelectedField({ boqItems: updatedBoq });
  };

  const handleAddBoqRow = () => {
    if (!selectedInquiry) return;
    const newRow = {
      id: `b-${Date.now()}`,
      desc: 'New BOQ Line Item',
      qty: 1,
      unit: 'Nos',
      buyCurrency: 'USD',
      buyUnitCost: 0,
      supplier: '',
    };
    updateSelectedField({ boqItems: [...selectedInquiry.boqItems, newRow] });
  };

  const handleAddVendorQuote = (e) => {
    e.preventDefault();
    if (!selectedInquiry || !vqSupplier || !vqAmount) return;
    const newQuote = {
      id: `vq-${Date.now()}`,
      supplier: vqSupplier,
      currency: vqCurrency,
      amount: parseFloat(vqAmount) || 0,
      leadTime: vqLeadTime || '2 Weeks',
      selected: selectedInquiry.vendorQuotes.length === 0,
    };
    updateSelectedField({ vendorQuotes: [...selectedInquiry.vendorQuotes, newQuote] });
    setVqSupplier('');
    setVqAmount('');
    setVqLeadTime('');
  };

  const handleManagerApprove = () => {
    if (!selectedInquiry) return;
    const approver = profile?.full_name || 'Omar Al-Ghamdi (Sales Manager)';
    const logEntry = {
      id: `f-${Date.now()}`,
      channel: 'Approval',
      note: `Sales Manager approval recorded by ${approver}. Ready to issue SAR quotation.`,
      by: approver,
      at: new Date().toISOString(),
    };
    updateSelectedField({
      managerApproved: true,
      approvedBy: approver,
      approvedAt: new Date().toISOString(),
      stage: 'quoted',
      followUps: [logEntry, ...(selectedInquiry.followUps || [])],
    });
  };

  const handleAddFollowUp = (e) => {
    e.preventDefault();
    if (!selectedInquiry || !fuNote.trim()) return;
    const nowIso = new Date().toISOString();
    const entry = {
      id: `f-${Date.now()}`,
      channel: fuChannel,
      note: fuNote.trim(),
      by: profile?.full_name || 'Sales Coordinator',
      at: nowIso,
    };
    updateSelectedField({
      lastFollowUpAt: nowIso,
      stage: selectedInquiry.stage === 'quoted' ? 'follow_up' : selectedInquiry.stage,
      followUps: [entry, ...(selectedInquiry.followUps || [])],
    });
    setFuNote('');
  };

  // --------------------------------------------------------------------------
  // RENDER AUTH GATE OR MAIN CRM
  // --------------------------------------------------------------------------
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-300">
          <RefreshCw className="w-5 h-5 animate-spin text-blue-400" />
          <span className="text-sm font-medium">Loading Horizon Business Solutions Portal...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginLandingPage onLoginSuccess={(user) => setSession({ user })} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Top Corporate Navigation Bar */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-lg shadow-inner">
              H
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base sm:text-lg tracking-tight">
                  Horizon Business Solutions Est.
                </h1>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                    syncStatus === 'live'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  {syncStatus === 'live' ? 'Live Sync' : 'Syncing...'}
                </span>
              </div>
              <p className="text-xs text-slate-400">MEP &amp; IT Trading â€¢ Sales, Multi-Currency RFQ &amp; Follow-Up CRM</p>
            </div>
          </div>

          {/* Logged-in User Badge & Sign Out */}
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-semibold text-white">{profile?.full_name}</div>
              <div className="text-[11px] text-blue-300">{profile?.role_label}</div>
            </div>
            <button
              onClick={() => setShowNewModal(true)}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" /> New Inquiry
            </button>
            <button
              onClick={handleSignOut}
              title="Sign Out"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* FX Exchange Rates Strip (Buying Multi-Currency -> SAR) */}
        <div className="bg-slate-950/90 border-t border-slate-800/80 px-4 sm:px-6 py-2">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-400 font-medium">
              <Globe className="w-3.5 h-3.5 text-blue-400" />
              <span>FX Conversion to SAR (Shared Live):</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {['USD', 'EUR', 'GBP', 'AED'].map((curr) => (
                <label key={curr} className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg">
                  <span className="text-slate-400 font-semibold">1 {curr} =</span>
                  <input
                    type="number"
                    step="0.001"
                    value={fxRates[curr] ?? ''}
                    onChange={(e) => handleFxChange(curr, e.target.value)}
                    className="w-16 bg-transparent text-amber-300 font-bold focus:outline-none text-right"
                  />
                  <span className="text-slate-500">SAR</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* KPI Summary Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-xs font-medium text-slate-500">Active Pipeline (Incl. 15% VAT)</div>
            <div className="mt-1 text-xl font-bold text-slate-900">SAR {formatSAR(kpis.activePipelineSAR)}</div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-xs font-medium text-slate-500">Won / PO Received</div>
            <div className="mt-1 text-xl font-bold text-emerald-600">SAR {formatSAR(kpis.wonSAR)}</div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-xs font-medium text-slate-500">Awaiting Manager Approval</div>
            <div className="mt-1 text-xl font-bold text-purple-600">{kpis.pendingApprovalCount} Quotes</div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-xs font-medium text-slate-500">Overdue Follow-Ups (&gt;48h)</div>
            <div className="mt-1 text-xl font-bold text-rose-600">{kpis.overdueFollowUpsCount} Alerts</div>
          </div>
        </div>

        {/* Role View Tabs & Search */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {ROLES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setActiveRoleFilter(r.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                    activeRoleFilter === r.key
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search client, ref, division..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Stage Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
            <button
              onClick={() => setStageFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                stageFilter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              All Stages ({inquiries.length})
            </button>
            {STAGES.map((st) => {
              const count = inquiries.filter((i) => i.stage === st.id).length;
              return (
                <button
                  key={st.id}
                  onClick={() => setStageFilter(st.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                    stageFilter === st.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {st.label} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Inquiries Pipeline List */}
        <div className="grid gap-3">
          {filteredInquiries.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 text-sm">
              No inquiries match the current role or stage filter.
            </div>
          ) : (
            filteredInquiries.map((inq) => {
              const stageMeta = STAGES.find((s) => s.id === inq.stage) || STAGES[0];
              const fin = computeFinancials(inq, fxRates);
              const overdue = isFollowUpOverdue(inq);

              return (
                <div
                  key={inq.id}
                  onClick={() => {
                    setSelectedId(inq.id);
                    setActiveTab('boq');
                  }}
                  className="bg-white hover:border-blue-400 border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm transition cursor-pointer flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-200">
                        {inq.refNo}
                      </span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                        {inq.division}
                      </span>
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${stageMeta.badge}`}>
                        {stageMeta.label}
                      </span>
                      {inq.managerApproved && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" /> Manager Approved
                        </span>
                      )}
                      {overdue && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3" /> Follow-Up Overdue (&gt;48h)
                        </span>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-slate-900">{inq.clientName}</h3>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                      <span>Contact: <strong className="text-slate-700">{inq.contactPerson}</strong></span>
                      <span>Sales: <strong className="text-slate-700">{inq.assignedSalesName}</strong></span>
                      <span>Action Owner: <strong className="text-blue-700">{stageMeta.owner}</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between lg:justify-end gap-6 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                    <div className="text-left lg:text-right">
                      <div className="text-[11px] text-slate-400">Quote Total (Incl. 15% VAT)</div>
                      <div className="text-base font-bold text-slate-900">SAR {formatSAR(fin.grandTotalSAR)}</div>
                      <div className="text-[11px] text-emerald-600 font-medium">
                        Margin: {inq.marginPercent}% (SAR {formatSAR(fin.profitSAR)})
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* ==================================================================== */}
      {/* INQUIRY WORKSPACE DRAWER / MODAL                                     */}
      {/* ==================================================================== */}
      {selectedInquiry && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 flex justify-end">
          <div className="bg-white w-full max-w-4xl h-full overflow-y-auto shadow-2xl flex flex-col">
            {/* Drawer Header */}
            <div className="p-5 bg-slate-900 text-white flex items-start justify-between gap-4 sticky top-0 z-10">
              <div>
                <div className="flex items-center gap-2 text-xs text-blue-300 font-semibold">
                  <span>{selectedInquiry.refNo}</span>
                  <span>â€¢</span>
                  <span>{selectedInquiry.division}</span>
                  <span>â€¢</span>
                  <span>Sales: {selectedInquiry.assignedSalesName}</span>
                </div>
                <h2 className="text-xl font-bold mt-1">{selectedInquiry.clientName}</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedInquiry.contactPerson} â€¢ {selectedInquiry.phone} â€¢ {selectedInquiry.email}
                </p>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stage Progression & Sales Manager Verbal/System Approval Bar */}
            <div className="p-4 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">Pipeline Stage:</span>
                <select
                  value={selectedInquiry.stage}
                  onChange={(e) => updateSelectedField({ stage: e.target.value })}
                  className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500"
                >
                  {STAGES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} ({s.owner})
                    </option>
                  ))}
                </select>
              </div>

              {selectedInquiry.managerApproved ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 text-xs font-semibold">
                  <ShieldCheck className="w-4 h-4" />
                  Approved by {selectedInquiry.approvedBy}
                </div>
              ) : (
                <button
                  onClick={handleManagerApprove}
                  className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" /> Record Sales Manager Approval
                </button>
              )}
            </div>

            {/* Drawer Tabs */}
            <div className="px-5 border-b border-slate-200 flex gap-6 bg-white">
              {[
                { id: 'boq', label: '1. BOQ, Multi-Currency Costing & SAR Quote' },
                { id: 'vendors', label: `2. Supplier RFQs (${selectedInquiry.vendorQuotes?.length || 0})` },
                { id: 'followup', label: `3. Coordinator Follow-Ups (${selectedInquiry.followUps?.length || 0})` },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`py-3 text-xs font-semibold border-b-2 transition cursor-pointer ${
                    activeTab === t.id
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Drawer Body */}
            <div className="p-6 flex-1 space-y-6">
              {activeTab === 'boq' && (() => {
                const fin = computeFinancials(selectedInquiry, fxRates);
                return (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-800">BOQ Line Items (Multi-Currency Purchase â†’ SAR)</h3>
                      <button
                        onClick={handleAddBoqRow}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Item
                      </button>
                    </div>

                    <div className="overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="p-2.5">Description</th>
                            <th className="p-2.5 w-16">Qty</th>
                            <th className="p-2.5 w-24">Buy Curr</th>
                            <th className="p-2.5 w-28">Unit Cost</th>
                            <th className="p-2.5 w-28 text-right">Total Cost (SAR)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedInquiry.boqItems.map((item) => {
                            const rowSAR = (Number(item.qty) || 0) * (Number(item.buyUnitCost) || 0) * (fxRates[item.buyCurrency] || 1);
                            return (
                              <tr key={item.id}>
                                <td className="p-2">
                                  <input
                                    type="text"
                                    value={item.desc}
                                    onChange={(e) => handleBoqItemChange(item.id, 'desc', e.target.value)}
                                    className="w-full border border-slate-200 rounded px-2 py-1"
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    type="number"
                                    value={item.qty}
                                    onChange={(e) => handleBoqItemChange(item.id, 'qty', parseFloat(e.target.value) || 0)}
                                    className="w-full border border-slate-200 rounded px-2 py-1"
                                  />
                                </td>
                                <td className="p-2">
                                  <select
                                    value={item.buyCurrency}
                                    onChange={(e) => handleBoqItemChange(item.id, 'buyCurrency', e.target.value)}
                                    className="w-full border border-slate-200 rounded px-1.5 py-1 bg-white font-semibold"
                                  >
                                    {CURRENCIES.map((c) => (
                                      <option key={c} value={c}>{c}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="p-2">
                                  <input
                                    type="number"
                                    value={item.buyUnitCost}
                                    onChange={(e) => handleBoqItemChange(item.id, 'buyUnitCost', parseFloat(e.target.value) || 0)}
                                    className="w-full border border-slate-200 rounded px-2 py-1"
                                  />
                                </td>
                                <td className="p-2 text-right font-semibold text-slate-800">
                                  {formatSAR(rowSAR)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Margin & KSA VAT Calculation Box */}
                    <div className="bg-slate-900 text-white rounded-2xl p-5 grid sm:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <label className="block text-xs text-slate-400 font-semibold uppercase">
                          Target Gross Margin (%)
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            value={selectedInquiry.marginPercent}
                            onChange={(e) => updateSelectedField({ marginPercent: parseFloat(e.target.value) || 0 })}
                            className="w-24 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-base font-bold text-amber-300"
                          />
                          <span className="text-xs text-slate-400">
                            Gross Profit: <strong className="text-emerald-400">SAR {formatSAR(fin.profitSAR)}</strong>
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-xs border-t sm:border-t-0 sm:border-l border-slate-800 pt-3 sm:pt-0 sm:pl-6">
                        <div className="flex justify-between text-slate-400">
                          <span>Total Landed Cost (SAR):</span>
                          <span>SAR {formatSAR(fin.totalCostSAR)}</span>
                        </div>
                        <div className="flex justify-between text-slate-200 font-semibold">
                          <span>Net Selling Price (Excl. VAT):</span>
                          <span>SAR {formatSAR(fin.sellNetSAR)}</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>KSA VAT (15%):</span>
                          <span>SAR {formatSAR(fin.vatSAR)}</span>
                        </div>
                        <div className="flex justify-between text-base font-bold text-blue-400 pt-2 border-t border-slate-800">
                          <span>Customer Quote Total:</span>
                          <span>SAR {formatSAR(fin.grandTotalSAR)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {activeTab === 'vendors' && (
                <div className="space-y-5">
                  <form onSubmit={handleAddVendorQuote} className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid sm:grid-cols-4 gap-3">
                    <input
                      type="text"
                      required
                      placeholder="Supplier Name"
                      value={vqSupplier}
                      onChange={(e) => setVqSupplier(e.target.value)}
                      className="border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white"
                    />
                    <div className="flex gap-1.5">
                      <select
                        value={vqCurrency}
                        onChange={(e) => setVqCurrency(e.target.value)}
                        className="border border-slate-300 rounded-lg px-2 py-2 text-xs bg-white font-semibold"
                      >
                        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input
                        type="number"
                        required
                        placeholder="Total Quote"
                        value={vqAmount}
                        onChange={(e) => setVqAmount(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs bg-white"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Lead Time (e.g. 2 Weeks)"
                      value={vqLeadTime}
                      onChange={(e) => setVqLeadTime(e.target.value)}
                      className="border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white"
                    />
                    <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold py-2 cursor-pointer">
                      + Add Vendor Quote
                    </button>
                  </form>

                  <div className="space-y-2.5">
                    {(selectedInquiry.vendorQuotes || []).map((vq) => (
                      <div key={vq.id} className="p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
                        <div>
                          <div className="font-bold text-sm text-slate-900">{vq.supplier}</div>
                          <div className="text-xs text-slate-500">Delivery: {vq.leadTime}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-sm text-slate-900">{vq.currency} {formatSAR(vq.amount)}</div>
                          <div className="text-xs text-slate-500">
                            â‰ˆ SAR {formatSAR(vq.amount * (fxRates[vq.currency] || 1))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'followup' && (() => {
                const fin = computeFinancials(selectedInquiry, fxRates);
                const waTemplate = `Dear ${selectedInquiry.contactPerson}, greetings from Horizon Business Solutions Est. Following up on our quotation ${selectedInquiry.refNo} for ${selectedInquiry.clientName} (Total: SAR ${formatSAR(fin.grandTotalSAR)} incl. 15% VAT). Kindly let us know if you need any technical clarification or delivery schedule update.`;
                return (
                  <div className="space-y-5">
                    {/* Quick WhatsApp / Email Copy Template */}
                    <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                          <MessageSquare className="w-4 h-4" /> Ready-to-Send WhatsApp / Email Follow-Up Template
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(waTemplate);
                            setFuNote(waTemplate);
                          }}
                          className="text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
                        >
                          Copy to Logger
                        </button>
                      </div>
                      <p className="text-xs text-emerald-800 leading-relaxed">{waTemplate}</p>
                    </div>

                    {/* Log Follow-Up Form */}
                    <form onSubmit={handleAddFollowUp} className="flex flex-col sm:flex-row gap-2.5">
                      <select
                        value={fuChannel}
                        onChange={(e) => setFuChannel(e.target.value)}
                        className="border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold bg-white"
                      >
                        <option value="Phone">Phone Call</option>
                        <option value="WhatsApp">WhatsApp</option>
                        <option value="Email">Email</option>
                        <option value="Meeting">Client Meeting</option>
                      </select>
                      <input
                        type="text"
                        required
                        value={fuNote}
                        onChange={(e) => setFuNote(e.target.value)}
                        placeholder="Log customer feedback, PO status, or next follow-up date..."
                        className="flex-1 border border-slate-300 rounded-xl px-3.5 py-2 text-xs"
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" /> Log Update
                      </button>
                    </form>

                    {/* Timeline */}
                    <div className="space-y-3">
                      {(selectedInquiry.followUps || []).map((f) => (
                        <div key={f.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-blue-700">{f.channel} â€¢ {f.by}</span>
                            <span className="text-slate-400">{new Date(f.at).toLocaleString()}</span>
                          </div>
                          <p className="text-xs text-slate-700">{f.note}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* NEW INQUIRY MODAL                                                    */}
      {/* ==================================================================== */}
      {showNewModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Log New Client Inquiry</h3>
              <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateInquiry} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Client / Company Name *</label>
                <input
                  type="text"
                  required
                  value={newInq.clientName}
                  onChange={(e) => setNewInq({ ...newInq, clientName: e.target.value })}
                  placeholder="e.g. Saudi Arabian Contracting Co."
                  className="w-full border border-slate-300 rounded-xl px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Contact Person *</label>
                  <input
                    type="text"
                    required
                    value={newInq.contactPerson}
                    onChange={(e) => setNewInq({ ...newInq, contactPerson: e.target.value })}
                    placeholder="Eng. Name"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone / WhatsApp *</label>
                  <input
                    type="text"
                    required
                    value={newInq.phone}
                    onChange={(e) => setNewInq({ ...newInq, phone: e.target.value })}
                    placeholder="+966 5X XXX XXXX"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Division</label>
                  <select
                    value={newInq.division}
                    onChange={(e) =>
                      setNewInq({
                        ...newInq,
                        division: e.target.value,
                        assignedSalesKey: e.target.value === 'MEP' ? 'sales_mep' : 'sales_it',
                      })
                    }
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                  >
                    <option value="MEP">MEP Trading</option>
                    <option value="IT & ELV">IT &amp; ELV Services</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Assigned Salesman</label>
                  <select
                    value={newInq.assignedSalesKey}
                    onChange={(e) => setNewInq({ ...newInq, assignedSalesKey: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                  >
                    <option value="sales_mep">Salesman 1 (MEP - Tariq)</option>
                    <option value="sales_it">Salesman 2 (IT - Faisal)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Primary Requested Item / Scope *</label>
                <input
                  type="text"
                  required
                  value={newInq.firstItemDesc}
                  onChange={(e) => setNewInq({ ...newInq, firstItemDesc: e.target.value })}
                  placeholder="e.g. HVAC Chilled Water Pumps / Cisco Core Switches"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer"
                >
                  Save &amp; Sync Inquiry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}