import React, { useState, useMemo } from 'react';
import {
  Kanban,
  Table as TableIcon,
  Plus,
  Users,
  Phone,
  Mail,
  MessageSquare,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Search,
  Filter,
  DollarSign,
  TrendingUp,
  Package,
  FileText,
  Calendar,
  ShieldCheck,
  Bell,
  Briefcase,
  Cpu,
  Wrench,
  Layers,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Award,
  BadgeCheck,
  Send,
  X,
  Building2
} from 'lucide-react';

// ============================================================================
// CONSTANTS, CURRENCIES, TEAM ROLES & PIPELINE STAGES
// ============================================================================

const DEFAULT_FX_RATES = {
  SAR: 1.0,
  USD: 3.75,
  EUR: 4.08,
  GBP: 4.78,
  AED: 1.02
};

const KSA_VAT_RATE = 0.15; // 15% Saudi Arabia VAT

const TEAM_MEMBERS = [
  { id: 'ALL', name: 'All Team Pipeline', role: 'Full Visibility', division: 'All Divisions' },
  { id: 'SALES_1', name: 'Tariq Al-Harbi', role: 'Salesman 1', division: 'MEP Division' },
  { id: 'SALES_2', name: 'Faisal Al-Qahtani', role: 'Salesman 2', division: 'IT & ELV Division' },
  { id: 'PURCHASE', name: 'Khalid Mansoor', role: 'Purchase Officer', division: 'Procurement & RFQ' },
  { id: 'COORDINATOR', name: 'Sara Al-Zahrani', role: 'Sales Coordinator', division: 'Customer Follow-Up' },
  { id: 'MANAGER', name: 'Omar Al-Ghamdi', role: 'Sales Manager', division: 'Pricing & Approvals' }
];

const STAGES = [
  {
    id: 'NEW_INQUIRY',
    title: '1. New Inquiry',
    ownerRole: 'Sales / Coordinator',
    headerBg: 'bg-slate-200 text-slate-900',
    colBg: 'border-slate-300 bg-slate-50/70',
    dotColor: 'bg-slate-600'
  },
  {
    id: 'SENT_TO_SUPPLIER',
    title: '2. Sent to Suppliers (RFQ)',
    ownerRole: 'Purchase Officer',
    headerBg: 'bg-amber-100 text-amber-900',
    colBg: 'border-amber-300 bg-amber-50/40',
    dotColor: 'bg-amber-500'
  },
  {
    id: 'PENDING_APPROVAL',
    title: '3. Pending Manager Approval',
    ownerRole: 'Salesman & Manager',
    headerBg: 'bg-purple-100 text-purple-900',
    colBg: 'border-purple-300 bg-purple-50/40',
    dotColor: 'bg-purple-600'
  },
  {
    id: 'QUOTED_TO_CUSTOMER',
    title: '4. Quoted to Customer',
    ownerRole: 'Salesman / Coordinator',
    headerBg: 'bg-blue-100 text-blue-900',
    colBg: 'border-blue-300 bg-blue-50/40',
    dotColor: 'bg-blue-600'
  },
  {
    id: 'FOLLOW_UP_ACTIVE',
    title: '5. Follow-Up (Active)',
    ownerRole: 'Sales Coordinator',
    headerBg: 'bg-cyan-100 text-cyan-900',
    colBg: 'border-cyan-300 bg-cyan-50/40',
    dotColor: 'bg-cyan-600'
  },
  {
    id: 'WON',
    title: '6. Won / PO Received',
    ownerRole: 'Closed Won',
    headerBg: 'bg-emerald-100 text-emerald-900',
    colBg: 'border-emerald-300 bg-emerald-50/40',
    dotColor: 'bg-emerald-600'
  },
  {
    id: 'LOST',
    title: '7. Lost / Closed',
    ownerRole: 'Closed Lost',
    headerBg: 'bg-rose-100 text-rose-900',
    colBg: 'border-rose-300 bg-rose-50/40',
    dotColor: 'bg-rose-500'
  }
];

const FOLLOW_UP_TEMPLATES = [
  {
    id: 'TPL_INITIAL',
    label: 'Initial Quote Check-In (WhatsApp / Email)',
    channel: 'WhatsApp',
    buildText: (inq, totals) =>
      `Assalamu Alaikum ${inq.contactPerson},\n\nHope you are doing well. Following up on our quotation *${inq.quoteRef || inq.id}* for *${inq.projectTitle}* (Total: *${formatSAR(totals.grandTotal)}* incl. 15% VAT).\n\nPlease let us know if your technical/commercial team requires any clarification or datasheet support.\n\nBest regards,\nSara Al-Zahrani\nSales Coordinator`
  },
  {
    id: 'TPL_TECHNICAL',
    label: 'Technical / Submittal Compliance Follow-Up',
    channel: 'Email',
    buildText: (inq, totals) =>
      `Dear ${inq.contactPerson},\n\nWe are following up regarding our commercial offer (${inq.quoteRef || inq.id}) valued at ${formatSAR(totals.grandTotal)} (inclusive of 15% KSA VAT) for ${inq.customerName}.\n\nAll proposed MEP/IT items comply with project specifications and vendor warranty terms. Kindly update us on the evaluation status and expected PO issuance timeline.\n\nWarm regards,\nSara Al-Zahrani\nSales Coordinator`
  },
  {
    id: 'TPL_URGENT_VALIDITY',
    label: 'Quote Validity & Stock Allocation Reminder',
    channel: 'WhatsApp',
    buildText: (inq, totals) =>
      `Dear ${inq.contactPerson},\n\nQuick reminder regarding Quotation *${inq.quoteRef || inq.id}* (${formatSAR(totals.grandTotal)} incl. VAT). Supplier validity and ex-stock allocation expire on *${inq.quoteValidUntil || 'soon'}*.\n\nKindly share your confirmation or PO copy so we can lock the current SAR pricing for you.\n\nBest regards,\nSara Al-Zahrani`
  }
];

// ============================================================================
// UTILITY FUNCTIONS & FINANCIAL CALCULATORS
// ============================================================================

const hoursAgo = (hrs) => new Date(Date.now() - hrs * 3600 * 1000).toISOString();
const daysFromNow = (days) => {
  const d = new Date(Date.now() + days * 24 * 3600 * 1000);
  return d.toISOString().split('T')[0];
};

const formatSAR = (amount) => {
  const num = Number(amount) || 0;
  return (
    'SAR ' +
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num)
  );
};

const formatCompactSAR = (amount) => {
  const num = Number(amount) || 0;
  return (
    'SAR ' +
    new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0
    }).format(num)
  );
};

const getHoursSince = (isoString) => {
  if (!isoString) return 0;
  return Math.floor((Date.now() - new Date(isoString).getTime()) / (1000 * 3600));
};

const formatRelativeTime = (isoString) => {
  const hrs = getHoursSince(isoString);
  if (hrs < 1) return 'Just now';
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h ago`;
};

const getMember = (id) => TEAM_MEMBERS.find((m) => m.id === id) || TEAM_MEMBERS[0];

// Calculate full BOQ financials in SAR + 15% KSA VAT
const calculateBoqTotals = (boqItems = []) => {
  let totalCostSAR = 0;
  let subtotalSellSAR = 0;

  const computedItems = boqItems.map((item) => {
    const qty = Number(item.qty) || 0;
    const unitCostForeign = Number(item.unitCostForeign) || 0;
    const fxRate = Number(item.fxRate) || 1;
    const marginPercent = Number(item.marginPercent) || 0;

    const unitCostSAR = unitCostForeign * fxRate;
    const lineCostSAR = unitCostSAR * qty;
    const unitSellSAR = unitCostSAR * (1 + marginPercent / 100);
    const lineSellSAR = unitSellSAR * qty;

    totalCostSAR += lineCostSAR;
    subtotalSellSAR += lineSellSAR;

    return {
      ...item,
      unitCostSAR,
      lineCostSAR,
      unitSellSAR,
      lineSellSAR
    };
  });

  const grossProfitSAR = subtotalSellSAR - totalCostSAR;
  const overallMarginPercent =
    totalCostSAR > 0 ? ((grossProfitSAR / totalCostSAR) * 100).toFixed(1) : '0.0';
  const vatAmountSAR = subtotalSellSAR * KSA_VAT_RATE;
  const grandTotalSAR = subtotalSellSAR + vatAmountSAR;

  return {
    items: computedItems,
    totalCostSAR,
    subtotalSellSAR,
    grossProfitSAR,
    overallMarginPercent,
    vatAmountSAR,
    grandTotal: grandTotalSAR
  };
};

// ============================================================================
// INITIAL REALISTIC KSA MEP & IT SERVICES SAMPLE INQUIRIES
// ============================================================================

const INITIAL_INQUIRIES = [
  {
    id: 'INQ-KSA-201',
    quoteRef: 'QT-2026-881',
    customerName: 'Jeddah Logistics & Cold Chain Co.',
    city: 'Jeddah',
    projectTitle: 'Warehouse Phase-2 Main LV Distribution & Cabling',
    category: 'MEP',
    contactPerson: 'Eng. Abdullah Al-Shareef',
    contactEmail: 'a.shareef@jeddahlogistics.sa',
    contactPhone: '+966 50 441 8821',
    assignedSalesman: 'SALES_1',
    priority: 'High',
    stage: 'FOLLOW_UP_ACTIVE',
    createdAt: hoursAgo(120),
    lastUpdatedAt: hoursAgo(53), // Triggers >48h follow-up SLA alert
    nextFollowUpDate: daysFromNow(-1),
    quoteValidUntil: daysFromNow(2), // Triggers expiring quote alert
    poNumber: '',
    lostReason: '',
    managerApproval: {
      status: 'APPROVED',
      approvedBy: 'Omar Al-Ghamdi (Sales Manager)',
      approvedAt: hoursAgo(75),
      note: 'Verbal & system approval granted at 18% margin for Schneider package.'
    },
    supplierQuotes: [
      {
        id: 'SQ-1',
        vendorName: 'Schneider Electric Authorized Distributor (UAE)',
        currency: 'USD',
        fxRate: 3.75,
        quotedTotalForeign: 24500,
        leadTime: '10 Days Ex-Stock Jebel Ali',
        notes: 'Includes SASO CoC certificates and factory test reports.',
        isSelected: true
      },
      {
        id: 'SQ-2',
        vendorName: 'Riyadh Industrial Cables & Switchgear',
        currency: 'SAR',
        fxRate: 1.0,
        quotedTotalForeign: 96800,
        leadTime: '14 Days DDP Jeddah',
        notes: 'Local stock available, slightly higher price.',
        isSelected: false
      }
    ],
    boqItems: [
      {
        id: 'BI-1',
        description: 'Schneider PrismaSeT Main Distribution Board 1600A IP54',
        qty: 2,
        unit: 'Set',
        supplierCurrency: 'USD',
        unitCostForeign: 7800,
        fxRate: 3.75,
        marginPercent: 18
      },
      {
        id: 'BI-2',
        description: 'Riyadh Cables 4C x 240mm2 XLPE/SWA/PVC Armoured Copper Cable',
        qty: 350,
        unit: 'Meter',
        supplierCurrency: 'SAR',
        unitCostForeign: 95,
        fxRate: 1.0,
        marginPercent: 16
      }
    ],
    followUps: [
      {
        id: 'FU-1',
        channel: 'Email',
        outcome: 'Formal Quotation QT-2026-881 sent in SAR with 15% VAT & Schneider datasheets.',
        loggedBy: 'SALES_1',
        timestamp: hoursAgo(72),
        nextActionDate: daysFromNow(-1)
      },
      {
        id: 'FU-2',
        channel: 'Phone',
        outcome: 'Called Eng. Abdullah; technical submittal approved, awaiting Finance Director PO sign-off.',
        loggedBy: 'COORDINATOR',
        timestamp: hoursAgo(53),
        nextActionDate: daysFromNow(-1)
      }
    ],
    timeline: [
      { stage: 'NEW_INQUIRY', note: 'MEP BOQ received for Jeddah Industrial City Warehouse', by: 'SALES_1', at: hoursAgo(120) },
      { stage: 'SENT_TO_SUPPLIER', note: 'RFQs issued to Schneider UAE & local switchgear vendors', by: 'PURCHASE', at: hoursAgo(112) },
      { stage: 'PENDING_APPROVAL', note: 'Best USD/SAR landed costs locked; submitted for Manager approval', by: 'SALES_1', at: hoursAgo(80) },
      { stage: 'QUOTED_TO_CUSTOMER', note: 'Approved by Omar Al-Ghamdi; quote sent to customer', by: 'SALES_1', at: hoursAgo(72) },
      { stage: 'FOLLOW_UP_ACTIVE', note: 'Sara initiated phone & WhatsApp follow-up cycle', by: 'COORDINATOR', at: hoursAgo(53) }
    ]
  },
  {
    id: 'INQ-KSA-202',
    quoteRef: 'QT-2026-885',
    customerName: 'Al-Hayat Specialist Medical Center',
    city: 'Riyadh',
    projectTitle: 'Enterprise Wi-Fi 6E, Cisco Meraki Core Switches & Server Rack',
    category: 'IT Services',
    contactPerson: 'Mr. Majed Al-Otaibi (IT Director)',
    contactEmail: 'm.alotaibi@alhayatmed.sa',
    contactPhone: '+966 55 902 1134',
    assignedSalesman: 'SALES_2',
    priority: 'High',
    stage: 'PENDING_APPROVAL',
    createdAt: hoursAgo(42),
    lastUpdatedAt: hoursAgo(5),
    nextFollowUpDate: daysFromNow(1),
    quoteValidUntil: daysFromNow(10),
    poNumber: '',
    lostReason: '',
    managerApproval: {
      status: 'PENDING',
      approvedBy: '',
      approvedAt: '',
      note: 'Faisal set 20% margin on Cisco hardware & installation. Awaiting Omar verbal/system sign-off.'
    },
    supplierQuotes: [
      {
        id: 'SQ-202-1',
        vendorName: 'Ingram Micro META (Dubai Freezone)',
        currency: 'USD',
        fxRate: 3.75,
        quotedTotalForeign: 31200,
        leadTime: '7 Days Air Freight to Riyadh',
        notes: 'Includes 5-Year Meraki Enterprise Cloud Licenses.',
        isSelected: true
      }
    ],
    boqItems: [
      {
        id: 'BI-202-1',
        description: 'Cisco Meraki MS390-48UX2 L3 PoE+ Stackable Switch + 5Y Lic',
        qty: 4,
        unit: 'Unit',
        supplierCurrency: 'USD',
        unitCostForeign: 4600,
        fxRate: 3.75,
        marginPercent: 20
      },
      {
        id: 'BI-202-2',
        description: 'Cisco Meraki MR57 Wi-Fi 6E Indoor Access Points + Mounting',
        qty: 16,
        unit: 'Unit',
        supplierCurrency: 'USD',
        unitCostForeign: 800,
        fxRate: 3.75,
        marginPercent: 22
      },
      {
        id: 'BI-202-3',
        description: 'On-Site Network Configuration, VLAN Setup & UAT Commissioning',
        qty: 1,
        unit: 'Lot',
        supplierCurrency: 'SAR',
        unitCostForeign: 14500,
        fxRate: 1.0,
        marginPercent: 25
      }
    ],
    followUps: [],
    timeline: [
      { stage: 'NEW_INQUIRY', note: 'IT infrastructure upgrade inquiry logged by Faisal', by: 'SALES_2', at: hoursAgo(42) },
      { stage: 'SENT_TO_SUPPLIER', note: 'USD distributor pricing requested by Khalid', by: 'PURCHASE', at: hoursAgo(30) },
      { stage: 'PENDING_APPROVAL', note: 'Costing complete in SAR; awaiting Sales Manager approval before quoting', by: 'SALES_2', at: hoursAgo(5) }
    ]
  },
  {
    id: 'INQ-KSA-203',
    quoteRef: '',
    customerName: 'Red Sea Resort & Hospitality Group',
    city: 'Yanbu / Umluj',
    projectTitle: 'HVAC Chiller Motorized Valves, BMS DDC Controllers & Fiber Backbone',
    category: 'Hybrid (MEP + IT)',
    contactPerson: 'Eng. Rami Haddad',
    contactEmail: 'r.haddad@redseahospitality.sa',
    contactPhone: '+966 54 321 7790',
    assignedSalesman: 'SALES_1',
    priority: 'High',
    stage: 'SENT_TO_SUPPLIER',
    createdAt: hoursAgo(58),
    lastUpdatedAt: hoursAgo(50), // Triggers >48h RFQ delay alert
    nextFollowUpDate: daysFromNow(0),
    quoteValidUntil: daysFromNow(14),
    poNumber: '',
    lostReason: '',
    managerApproval: {
      status: 'PENDING',
      approvedBy: '',
      approvedAt: '',
      note: ''
    },
    supplierQuotes: [
      {
        id: 'SQ-203-1',
        vendorName: 'Siemens Building Technologies Europe',
        currency: 'EUR',
        fxRate: 4.08,
        quotedTotalForeign: 18500,
        leadTime: '3 Weeks Ex-Works Germany',
        notes: 'Awaiting secondary quote for Belimo actuators before finalizing.',
        isSelected: true
      }
    ],
    boqItems: [
      {
        id: 'BI-203-1',
        description: 'Siemens Desigo PXC4.E16 BACnet BMS DDC Controller',
        qty: 10,
        unit: 'Unit',
        supplierCurrency: 'EUR',
        unitCostForeign: 1150,
        fxRate: 4.08,
        marginPercent: 18
      },
      {
        id: 'BI-203-2',
        description: 'Belimo DN80 Pressure Independent Chiller Control Valve (PICV)',
        qty: 8,
        unit: 'Unit',
        supplierCurrency: 'EUR',
        unitCostForeign: 875,
        fxRate: 4.08,
        marginPercent: 18
      }
    ],
    followUps: [],
    timeline: [
      { stage: 'NEW_INQUIRY', note: 'Hybrid BMS + Fiber inquiry received', by: 'SALES_1', at: hoursAgo(58) },
      { stage: 'SENT_TO_SUPPLIER', note: 'RFQs sent in EUR to European OEM partners', by: 'PURCHASE', at: hoursAgo(50) }
    ]
  },
  {
    id: 'INQ-KSA-204',
    quoteRef: 'QT-2026-890',
    customerName: 'Dammam Petro-Industrial Services',
    city: 'Dammam',
    projectTitle: '48-Camera IP CCTV Surveillance & Biometric Access Control',
    category: 'IT Services',
    contactPerson: 'Mr. Nasser Al-Dosari',
    contactEmail: 'n.dosari@dammampetro.sa',
    contactPhone: '+966 50 778 3320',
    assignedSalesman: 'SALES_2',
    priority: 'Medium',
    stage: 'QUOTED_TO_CUSTOMER',
    createdAt: hoursAgo(32),
    lastUpdatedAt: hoursAgo(8),
    nextFollowUpDate: daysFromNow(1),
    quoteValidUntil: daysFromNow(12),
    poNumber: '',
    lostReason: '',
    managerApproval: {
      status: 'APPROVED',
      approvedBy: 'Omar Al-Ghamdi (Sales Manager)',
      approvedAt: hoursAgo(10),
      note: 'Approved for HCIS-compliant camera package.'
    },
    supplierQuotes: [
      {
        id: 'SQ-204-1',
        vendorName: 'Axis Communications Middle East (AED)',
        currency: 'AED',
        fxRate: 1.02,
        quotedTotalForeign: 84000,
        leadTime: '5 Days Dubai Stock',
        notes: 'Includes 64-Ch NVR and outdoor explosion-proof housings.',
        isSelected: true
      }
    ],
    boqItems: [
      {
        id: 'BI-204-1',
        description: 'Axis P3265-LVE 2MP Outdoor Dome IP Camera (HCIS Spec)',
        qty: 48,
        unit: 'Unit',
        supplierCurrency: 'AED',
        unitCostForeign: 1450,
        fxRate: 1.02,
        marginPercent: 19
      },
      {
        id: 'BI-204-2',
        description: 'Enterprise 64-Channel NVR Server + 64TB Surveillance Storage',
        qty: 1,
        unit: 'Set',
        supplierCurrency: 'AED',
        unitCostForeign: 14400,
        fxRate: 1.02,
        marginPercent: 19
      }
    ],
    followUps: [
      {
        id: 'FU-204-1',
        channel: 'Email',
        outcome: 'Quotation QT-2026-890 sent to Mr. Nasser; scheduled coordinator call for tomorrow.',
        loggedBy: 'SALES_2',
        timestamp: hoursAgo(8),
        nextActionDate: daysFromNow(1)
      }
    ],
    timeline: [
      { stage: 'NEW_INQUIRY', note: 'Security & ELV upgrade inquiry', by: 'SALES_2', at: hoursAgo(32) },
      { stage: 'SENT_TO_SUPPLIER', note: 'AED pricing obtained from Dubai distributor', by: 'PURCHASE', at: hoursAgo(22) },
      { stage: 'PENDING_APPROVAL', note: 'Submitted for Manager sign-off', by: 'SALES_2', at: hoursAgo(14) },
      { stage: 'QUOTED_TO_CUSTOMER', note: 'Approved by Omar & quoted to customer', by: 'SALES_2', at: hoursAgo(8) }
    ]
  },
  {
    id: 'INQ-KSA-205',
    quoteRef: '',
    customerName: 'Makkah Construction & Contracting Co.',
    city: 'Makkah',
    projectTitle: 'Grundfos Booster Pump Sets & UL/FM Fire Fighting Valves',
    category: 'MEP',
    contactPerson: 'Eng. Hassan Al-Malki',
    contactEmail: 'h.malki@makkahcontracting.sa',
    contactPhone: '+966 56 112 9087',
    assignedSalesman: 'SALES_1',
    priority: 'Medium',
    stage: 'NEW_INQUIRY',
    createdAt: hoursAgo(3),
    lastUpdatedAt: hoursAgo(3),
    nextFollowUpDate: daysFromNow(1),
    quoteValidUntil: daysFromNow(15),
    poNumber: '',
    lostReason: '',
    managerApproval: {
      status: 'PENDING',
      approvedBy: '',
      approvedAt: '',
      note: ''
    },
    supplierQuotes: [],
    boqItems: [
      {
        id: 'BI-205-1',
        description: 'Grundfos Hydro MPC-E 3 CRE15-4 Triplex Booster Pump Set',
        qty: 2,
        unit: 'Set',
        supplierCurrency: 'EUR',
        unitCostForeign: 0,
        fxRate: 4.08,
        marginPercent: 18
      },
      {
        id: 'BI-205-2',
        description: 'UL/FM OS&Y Gate Valves & Grooved Check Valves DN150',
        qty: 12,
        unit: 'Piece',
        supplierCurrency: 'USD',
        unitCostForeign: 0,
        fxRate: 3.75,
        marginPercent: 18
      }
    ],
    followUps: [],
    timeline: [
      { stage: 'NEW_INQUIRY', note: 'New MEP pump & fire valve BOQ logged by Sara for Tariq', by: 'COORDINATOR', at: hoursAgo(3) }
    ]
  },
  {
    id: 'INQ-KSA-206',
    quoteRef: 'QT-2026-870',
    customerName: 'Saudi Modern Food Processing Plant',
    city: 'Jeddah',
    projectTitle: 'Plant-Wide Structured Cabling (Cat6A) & Industrial UPS Backup',
    category: 'Hybrid (MEP + IT)',
    contactPerson: 'Eng. Waleed Baeshen',
    contactEmail: 'w.baeshen@saudimodernfood.sa',
    contactPhone: '+966 50 889 0012',
    assignedSalesman: 'SALES_2',
    priority: 'High',
    stage: 'WON',
    createdAt: hoursAgo(180),
    lastUpdatedAt: hoursAgo(14),
    nextFollowUpDate: '',
    quoteValidUntil: daysFromNow(15),
    poNumber: 'PO-SMFP-2026-994',
    lostReason: '',
    managerApproval: {
      status: 'APPROVED',
      approvedBy: 'Omar Al-Ghamdi (Sales Manager)',
      approvedAt: hoursAgo(110),
      note: 'Approved with 19% blended margin.'
    },
    supplierQuotes: [
      {
        id: 'SQ-206-1',
        vendorName: 'APC Schneider & Panduit KSA Stockist',
        currency: 'USD',
        fxRate: 3.75,
        quotedTotalForeign: 29400,
        leadTime: '7 Days',
        notes: 'Delivered to Jeddah Industrial City Phase 3.',
        isSelected: true
      }
    ],
    boqItems: [
      {
        id: 'BI-206-1',
        description: 'APC Smart-UPS SRT 10kVA Online Double-Conversion + Ext Battery',
        qty: 3,
        unit: 'Set',
        supplierCurrency: 'USD',
        unitCostForeign: 5800,
        fxRate: 3.75,
        marginPercent: 19
      },
      {
        id: 'BI-206-2',
        description: 'Panduit Cat6A Shielded U/FTP Cabling & Patch Panels (48 Drops)',
        qty: 1,
        unit: 'Lot',
        supplierCurrency: 'USD',
        unitCostForeign: 12000,
        fxRate: 3.75,
        marginPercent: 20
      }
    ],
    followUps: [
      {
        id: 'FU-206-1',
        channel: 'WhatsApp',
        outcome: 'Signed PO #PO-SMFP-2026-994 & 40% advance payment advice received!',
        loggedBy: 'COORDINATOR',
        timestamp: hoursAgo(14),
        nextActionDate: ''
      }
    ],
    timeline: [
      { stage: 'NEW_INQUIRY', note: 'Inquiry logged', by: 'SALES_2', at: hoursAgo(180) },
      { stage: 'SENT_TO_SUPPLIER', note: 'RFQ sent to APC & Panduit distributors', by: 'PURCHASE', at: hoursAgo(165) },
      { stage: 'PENDING_APPROVAL', note: 'Margin reviewed with Sales Manager', by: 'SALES_2', at: hoursAgo(120) },
      { stage: 'QUOTED_TO_CUSTOMER', note: 'Approved by Omar & quote issued', by: 'SALES_2', at: hoursAgo(108) },
      { stage: 'FOLLOW_UP_ACTIVE', note: 'Follow-ups managed by Sara', by: 'COORDINATOR', at: hoursAgo(60) },
      { stage: 'WON', note: 'PO #PO-SMFP-2026-994 received!', by: 'COORDINATOR', at: hoursAgo(14) }
    ]
  }
];

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================

export default function App() {
  const [inquiries, setInquiries] = useState(INITIAL_INQUIRIES);
  const [fxRates, setFxRates] = useState(DEFAULT_FX_RATES);
  const [activeRole, setActiveRole] = useState('ALL');
  const [viewMode, setViewMode] = useState('KANBAN'); // 'KANBAN' | 'TABLE'
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL'); // 'ALL' | 'MEP' | 'IT Services' | 'Hybrid (MEP + IT)'
  const [showAlertsDrawer, setShowAlertsDrawer] = useState(true);
  const [showFxWidget, setShowFxWidget] = useState(false);

  // Modals & Drawers
  const [selectedInquiryId, setSelectedInquiryId] = useState(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [quickFollowUpInquiry, setQuickFollowUpInquiry] = useState(null);
  const [wonModalInquiry, setWonModalInquiry] = useState(null);
  const [poNumberInput, setPoNumberInput] = useState('');
  const [lostModalInquiry, setLostModalInquiry] = useState(null);
  const [lostReasonInput, setLostReasonInput] = useState('Price higher than competitor');

  const [draggedId, setDraggedId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const selectedInquiry = useMemo(
    () => inquiries.find((inq) => inq.id === selectedInquiryId) || null,
    [inquiries, selectedInquiryId]
  );

  // ============================================================================
  // SMART ALERTS & SLA ENGINE
  // ============================================================================
  const smartAlerts = useMemo(() => {
    const alerts = [];
    const todayStr = new Date().toISOString().split('T')[0];

    inquiries.forEach((inq) => {
      if (inq.stage === 'WON' || inq.stage === 'LOST') return;
      const hrsSinceUpdate = getHoursSince(inq.lastUpdatedAt);
      const totals = calculateBoqTotals(inq.boqItems);

      // 1. Overdue Customer Follow-Up (>48h or past nextFollowUpDate)
      if (
        (inq.stage === 'QUOTED_TO_CUSTOMER' || inq.stage === 'FOLLOW_UP_ACTIVE') &&
        (hrsSinceUpdate >= 48 || (inq.nextFollowUpDate && inq.nextFollowUpDate < todayStr))
      ) {
        alerts.push({
          id: `alert-fu-${inq.id}`,
          inquiryId: inq.id,
          severity: 'high',
          owner: 'COORDINATOR',
          title: `Overdue Follow-Up: ${inq.customerName}`,
          description: `No contact logged in ${hrsSinceUpdate}h (${formatCompactSAR(totals.grandTotal)} incl. VAT). Sara to call/WhatsApp today.`
        });
      }

      // 2. Pending Sales Manager Approval
      if (inq.stage === 'PENDING_APPROVAL' && inq.managerApproval?.status !== 'APPROVED') {
        alerts.push({
          id: `alert-mgr-${inq.id}`,
          inquiryId: inq.id,
          severity: 'medium',
          owner: 'MANAGER',
          title: `Approval Needed: ${inq.customerName}`,
          description: `${getMember(inq.assignedSalesman).name} submitted ${formatCompactSAR(totals.subtotalSellSAR)} (+VAT) at ${totals.overallMarginPercent}% margin.`
        });
      }

      // 3. Supplier RFQ Delayed (>48h)
      if (inq.stage === 'SENT_TO_SUPPLIER' && hrsSinceUpdate >= 48) {
        alerts.push({
          id: `alert-rfq-${inq.id}`,
          inquiryId: inq.id,
          severity: 'medium',
          owner: 'PURCHASE',
          title: `Supplier RFQ Delayed: ${inq.id}`,
          description: `Awaiting multi-currency vendor quotes for ${hrsSinceUpdate}h (${inq.customerName}). Khalid to expedite.`
        });
      }

      // 4. Quote Validity Expiring Soon
      if (
        (inq.stage === 'QUOTED_TO_CUSTOMER' || inq.stage === 'FOLLOW_UP_ACTIVE') &&
        inq.quoteValidUntil
      ) {
        const daysLeft = Math.ceil(
          (new Date(inq.quoteValidUntil) - new Date()) / (1000 * 3600 * 24)
        );
        if (daysLeft <= 3) {
          alerts.push({
            id: `alert-exp-${inq.id}`,
            inquiryId: inq.id,
            severity: 'high',
            owner: inq.assignedSalesman,
            title: `Quote Expiring in ${Math.max(0, daysLeft)}d: ${inq.customerName}`,
            description: `Vendor FX/price validity ends ${inq.quoteValidUntil}. Push for PO before repricing.`
          });
        }
      }
    });

    return alerts;
  }, [inquiries]);

  // ============================================================================
  // KPI METRICS IN SAR (INCL. 15% VAT)
  // ============================================================================
  const kpis = useMemo(() => {
    const active = inquiries.filter((i) => i.stage !== 'WON' && i.stage !== 'LOST');
    const pendingRfq = inquiries.filter(
      (i) => i.stage === 'NEW_INQUIRY' || i.stage === 'SENT_TO_SUPPLIER'
    );
    const pendingApproval = inquiries.filter(
      (i) => i.stage === 'PENDING_APPROVAL' && i.managerApproval?.status !== 'APPROVED'
    );
    const activeFollowUp = inquiries.filter(
      (i) => i.stage === 'QUOTED_TO_CUSTOMER' || i.stage === 'FOLLOW_UP_ACTIVE'
    );
    const won = inquiries.filter((i) => i.stage === 'WON');

    const openPipelineSAR = active.reduce(
      (sum, item) => sum + calculateBoqTotals(item.boqItems).grandTotal,
      0
    );
    const wonRevenueSAR = won.reduce(
      (sum, item) => sum + calculateBoqTotals(item.boqItems).grandTotal,
      0
    );

    return {
      activeCount: active.length,
      pendingRfqCount: pendingRfq.length,
      pendingApprovalCount: pendingApproval.length,
      activeFollowUpCount: activeFollowUp.length,
      openPipelineSAR,
      wonRevenueSAR
    };
  }, [inquiries]);

  // ============================================================================
  // FILTERING & ROLE FOCUS LOGIC
  // ============================================================================
  const filteredInquiries = useMemo(() => {
    return inquiries.filter((inq) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        inq.customerName.toLowerCase().includes(q) ||
        inq.projectTitle.toLowerCase().includes(q) ||
        inq.id.toLowerCase().includes(q) ||
        (inq.quoteRef && inq.quoteRef.toLowerCase().includes(q)) ||
        inq.boqItems.some((b) => b.description.toLowerCase().includes(q));

      const matchesCategory = categoryFilter === 'ALL' || inq.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [inquiries, searchQuery, categoryFilter]);

  const isActionableForActiveRole = (inq) => {
    if (activeRole === 'ALL') return true;
    if (activeRole === 'SALES_1' || activeRole === 'SALES_2') {
      return inq.assignedSalesman === activeRole;
    }
    if (activeRole === 'PURCHASE') {
      return inq.stage === 'NEW_INQUIRY' || inq.stage === 'SENT_TO_SUPPLIER';
    }
    if (activeRole === 'MANAGER') {
      return inq.stage === 'PENDING_APPROVAL' && inq.managerApproval?.status !== 'APPROVED';
    }
    if (activeRole === 'COORDINATOR') {
      return (
        inq.stage === 'NEW_INQUIRY' ||
        inq.stage === 'QUOTED_TO_CUSTOMER' ||
        inq.stage === 'FOLLOW_UP_ACTIVE'
      );
    }
    return true;
  };

  // ============================================================================
  // STAGE TRANSITIONS & APPROVAL HANDLERS
  // ============================================================================

  const handleStageChange = (inquiryId, newStage, customNote = '') => {
    const target = inquiries.find((i) => i.id === inquiryId);
    if (!target) return;

    if (newStage === 'WON') {
      setWonModalInquiry(target);
      setPoNumberInput(target.poNumber || '');
      return;
    }

    if (newStage === 'LOST') {
      setLostModalInquiry(target);
      return;
    }

    const stageObj = STAGES.find((s) => s.id === newStage);
    const actor = activeRole === 'ALL' ? 'COORDINATOR' : activeRole;

    setInquiries((prev) =>
      prev.map((inq) => {
        if (inq.id !== inquiryId || inq.stage === newStage) return inq;
        return {
          ...inq,
          stage: newStage,
          quoteRef:
            newStage === 'QUOTED_TO_CUSTOMER' && !inq.quoteRef
              ? `QT-2026-${890 + prev.length}`
              : inq.quoteRef,
          lastUpdatedAt: new Date().toISOString(),
          timeline: [
            ...inq.timeline,
            {
              stage: newStage,
              note: customNote || `Moved stage to ${stageObj?.title}`,
              by: actor,
              at: new Date().toISOString()
            }
          ]
        };
      })
    );
    triggerToast(`Moved ${inquiryId} to ${stageObj?.title}`);
  };

  const confirmMarkAsWon = () => {
    if (!wonModalInquiry) return;
    const actor = activeRole === 'ALL' ? 'COORDINATOR' : activeRole;
    const poText = poNumberInput.trim() || 'PO-CONFIRMED';

    setInquiries((prev) =>
      prev.map((inq) => {
        if (inq.id !== wonModalInquiry.id) return inq;
        return {
          ...inq,
          stage: 'WON',
          poNumber: poText,
          lastUpdatedAt: new Date().toISOString(),
          timeline: [
            ...inq.timeline,
            {
              stage: 'WON',
              note: `Deal Won! Customer PO #${poText} recorded.`,
              by: actor,
              at: new Date().toISOString()
            }
          ]
        };
      })
    );
    triggerToast(`${wonModalInquiry.id} marked WON (${poText})`);
    setWonModalInquiry(null);
  };

  const confirmMarkAsLost = () => {
    if (!lostModalInquiry) return;
    const actor = activeRole === 'ALL' ? 'SALES_1' : activeRole;

    setInquiries((prev) =>
      prev.map((inq) => {
        if (inq.id !== lostModalInquiry.id) return inq;
        return {
          ...inq,
          stage: 'LOST',
          lostReason: lostReasonInput,
          lastUpdatedAt: new Date().toISOString(),
          timeline: [
            ...inq.timeline,
            {
              stage: 'LOST',
              note: `Closed Lost — Reason: ${lostReasonInput}`,
              by: actor,
              at: new Date().toISOString()
            }
          ]
        };
      })
    );
    triggerToast(`${lostModalInquiry.id} closed as Lost`);
    setLostModalInquiry(null);
  };

  const handleManagerApprovalToggle = (inquiryId, status, approvalNote = '') => {
    const actor = activeRole === 'ALL' ? 'MANAGER' : activeRole;
    setInquiries((prev) =>
      prev.map((inq) => {
        if (inq.id !== inquiryId) return inq;
        const isApproving = status === 'APPROVED';
        return {
          ...inq,
          stage: isApproving && inq.stage === 'PENDING_APPROVAL' ? 'PENDING_APPROVAL' : inq.stage,
          lastUpdatedAt: new Date().toISOString(),
          managerApproval: {
            status,
            approvedBy: isApproving ? 'Omar Al-Ghamdi (Sales Manager)' : '',
            approvedAt: isApproving ? new Date().toISOString() : '',
            note:
              approvalNote ||
              (isApproving
                ? 'Verbal & system margin approved. Salesman cleared to issue SAR quotation.'
                : 'Reset to pending approval.')
          },
          timeline: [
            ...inq.timeline,
            {
              stage: inq.stage,
              note: isApproving
                ? `Sales Manager Omar Al-Ghamdi APPROVED pricing (${approvalNote || 'Cleared to quote'})`
                : 'Manager approval reset to Pending',
              by: actor,
              at: new Date().toISOString()
            }
          ]
        };
      })
    );
    triggerToast(
      status === 'APPROVED'
        ? `Sales Manager Approval recorded for ${inquiryId}`
        : `Approval reset to Pending for ${inquiryId}`
    );
  };

  const handleUpdateBoqAndQuotes = (inquiryId, updatedBoq, updatedSupplierQuotes, nextStageIfAny) => {
    const actor = activeRole === 'ALL' ? 'PURCHASE' : activeRole;
    const totals = calculateBoqTotals(updatedBoq);

    setInquiries((prev) =>
      prev.map((inq) => {
        if (inq.id !== inquiryId) return inq;
        const targetStage = nextStageIfAny || inq.stage;
        return {
          ...inq,
          stage: targetStage,
          boqItems: updatedBoq,
          supplierQuotes: updatedSupplierQuotes,
          lastUpdatedAt: new Date().toISOString(),
          timeline: [
            ...inq.timeline,
            {
              stage: targetStage,
              note: `BOQ & Multi-Currency Costing updated: Landed Cost ${formatCompactSAR(
                totals.totalCostSAR
              )} → Selling ${formatCompactSAR(totals.subtotalSellSAR)} (+15% VAT = ${formatCompactSAR(
                totals.grandTotal
              )})`,
              by: actor,
              at: new Date().toISOString()
            }
          ]
        };
      })
    );
    triggerToast(`BOQ & SAR pricing saved for ${inquiryId}`);
  };

  const handleLogFollowUp = (inquiryId, followUpPayload) => {
    const actor = activeRole === 'ALL' ? 'COORDINATOR' : activeRole;
    setInquiries((prev) =>
      prev.map((inq) => {
        if (inq.id !== inquiryId) return inq;
        const nextStage =
          inq.stage === 'QUOTED_TO_CUSTOMER' ? 'FOLLOW_UP_ACTIVE' : inq.stage;

        const newLog = {
          id: `FU-${Date.now()}`,
          channel: followUpPayload.channel,
          outcome: followUpPayload.outcome,
          loggedBy: actor,
          timestamp: new Date().toISOString(),
          nextActionDate: followUpPayload.nextActionDate
        };

        return {
          ...inq,
          stage: nextStage,
          lastUpdatedAt: new Date().toISOString(),
          nextFollowUpDate: followUpPayload.nextActionDate || inq.nextFollowUpDate,
          followUps: [newLog, ...inq.followUps],
          timeline: [
            ...inq.timeline,
            {
              stage: nextStage,
              note: `${followUpPayload.channel} Follow-Up: "${followUpPayload.outcome}"`,
              by: actor,
              at: new Date().toISOString()
            }
          ]
        };
      })
    );
    triggerToast(`Follow-up activity logged for ${inquiryId}`);
  };

  const handleCreateInquiry = (newInqPayload) => {
    const newId = `INQ-KSA-${200 + inquiries.length + 1}`;
    const actor = activeRole === 'ALL' ? newInqPayload.assignedSalesman : activeRole;

    const created = {
      id: newId,
      quoteRef: '',
      customerName: newInqPayload.customerName,
      city: newInqPayload.city || 'Jeddah',
      projectTitle: newInqPayload.projectTitle,
      category: newInqPayload.category,
      contactPerson: newInqPayload.contactPerson,
      contactEmail: newInqPayload.contactEmail,
      contactPhone: newInqPayload.contactPhone,
      assignedSalesman: newInqPayload.assignedSalesman,
      priority: newInqPayload.priority,
      stage: 'NEW_INQUIRY',
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      nextFollowUpDate: daysFromNow(1),
      quoteValidUntil: daysFromNow(14),
      poNumber: '',
      lostReason: '',
      managerApproval: {
        status: 'PENDING',
        approvedBy: '',
        approvedAt: '',
        note: ''
      },
      supplierQuotes: [],
      boqItems: newInqPayload.boqItems,
      followUps: [],
      timeline: [
        {
          stage: 'NEW_INQUIRY',
          note: `New ${newInqPayload.category} inquiry logged with ${newInqPayload.boqItems.length} BOQ line item(s)`,
          by: actor,
          at: new Date().toISOString()
        }
      ]
    };

    setInquiries((prev) => [created, ...prev]);
    setIsNewModalOpen(false);
    triggerToast(`Created ${newId} for ${created.customerName}`);
  };

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================

  const getNextStage = (currentStageId) => {
    const idx = STAGES.findIndex((s) => s.id === currentStageId);
    if (idx === -1 || idx >= STAGES.length - 2) return null;
    return STAGES[idx + 1];
  };

  const renderCategoryBadge = (category) => {
    if (category === 'MEP') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-200">
          <Wrench className="w-2.5 h-2.5" /> MEP
        </span>
      );
    }
    if (category === 'IT Services') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
          <Cpu className="w-2.5 h-2.5" /> IT &amp; ELV
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 border border-teal-200">
        <Layers className="w-2.5 h-2.5" /> Hybrid
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col font-sans">
      {/* ===================================================================== */}
      {/* TOP BAR & 5-SEAT ROLE SWITCHER                                        */}
      {/* ===================================================================== */}
      <header className="bg-slate-900 text-white shadow-lg sticky top-0 z-30">
        <div className="max-w-[1680px] mx-auto px-4 sm:px-6 py-3 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          {/* Brand & KSA MEP/IT Tag */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 via-teal-600 to-blue-600 flex items-center justify-center shadow-md">
                <Briefcase className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-bold tracking-tight">
                    SaudiTech MEP &amp; IT Pipeline
                  </h1>
                  <span className="text-[10px] uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 rounded-full font-semibold">
                    SAR + 15% VAT
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Inquiry → Multi-Currency RFQ → Manager Approval → SAR Quote → Coordinator Follow-Up
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsNewModalOpen(true)}
              className="xl:hidden inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow"
            >
              <Plus className="w-4 h-4" /> New Inquiry
            </button>
          </div>

          {/* 5-Seat Role Switcher */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 xl:pb-0">
            {TEAM_MEMBERS.map((member) => {
              const isSelected = activeRole === member.id;
              return (
                <button
                  key={member.id}
                  onClick={() => setActiveRole(member.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                    isSelected
                      ? 'bg-white text-slate-900 border-white shadow-sm font-bold'
                      : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      member.id === 'ALL'
                        ? 'bg-slate-400'
                        : member.id === 'SALES_1'
                        ? 'bg-orange-500'
                        : member.id === 'SALES_2'
                        ? 'bg-indigo-500'
                        : member.id === 'PURCHASE'
                        ? 'bg-amber-400'
                        : member.id === 'COORDINATOR'
                        ? 'bg-cyan-400'
                        : 'bg-purple-500'
                    }`}
                  />
                  <span>{member.role}</span>
                  {member.id !== 'ALL' && (
                    <span className="hidden sm:inline text-[11px] opacity-75">
                      ({member.name.split(' ')[0]})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Desktop Action Buttons */}
          <div className="hidden xl:flex items-center gap-2.5">
            <button
              onClick={() => setShowFxWidget(!showFxWidget)}
              className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-xs font-semibold px-3 py-2 rounded-xl transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              FX Rates (SAR)
            </button>
            <button
              onClick={() => setIsNewModalOpen(true)}
              className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New MEP / IT Inquiry
            </button>
          </div>
        </div>

        {/* Editable Multi-Currency FX Bar (USD, EUR, GBP, AED -> SAR) */}
        {showFxWidget && (
          <div className="bg-slate-800 border-t border-slate-700 px-4 sm:px-6 py-2.5">
            <div className="max-w-[1680px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-amber-300 font-semibold">
                <DollarSign className="w-4 h-4" />
                <span>Company Buying Exchange Rates to SAR (Editable):</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {['USD', 'EUR', 'GBP', 'AED'].map((curr) => (
                  <label
                    key={curr}
                    className="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-700"
                  >
                    <span className="font-bold text-slate-300">1 {curr} =</span>
                    <input
                      type="number"
                      step="0.01"
                      value={fxRates[curr]}
                      onChange={(e) =>
                        setFxRates({ ...fxRates, [curr]: parseFloat(e.target.value) || 1 })
                      }
                      className="w-16 bg-slate-800 text-white font-bold px-1.5 py-0.5 rounded border border-slate-600 text-right"
                    />
                    <span className="text-emerald-400 font-semibold">SAR</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Role Highlight Banner */}
        {activeRole !== 'ALL' && (
          <div className="bg-gradient-to-r from-slate-800 via-slate-800 to-indigo-950 border-t border-slate-700/80 px-4 sm:px-6 py-1.5 text-xs text-slate-300">
            <div className="max-w-[1680px] mx-auto flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>
                  Active Role: <strong className="text-white">{getMember(activeRole).name}</strong> —{' '}
                  <span className="text-emerald-300 font-semibold">
                    {getMember(activeRole).division}
                  </span>
                  . All 7 stages remain visible; your priority action cards are highlighted.
                </span>
              </div>
              <button
                onClick={() => setActiveRole('ALL')}
                className="text-amber-300 hover:underline font-semibold"
              >
                Show All Team Cards Equally
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ===================================================================== */}
      {/* MAIN WORKSPACE                                                        */}
      {/* ===================================================================== */}
      <main className="flex-1 max-w-[1680px] w-full mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* KPI SUMMARY CARDS (IN SAR INCL. 15% VAT) */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
              <span>Active Inquiries</span>
              <FileText className="w-4 h-4 text-blue-600" />
            </div>
            <div className="text-2xl font-bold text-slate-900">{kpis.activeCount}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">MEP, IT &amp; Hybrid BOQs</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
              <span>Supplier RFQs</span>
              <Package className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-2xl font-bold text-amber-700">{kpis.pendingRfqCount}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Khalid (Purchase) queue</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-purple-200 bg-purple-50/30 shadow-2xs">
            <div className="flex items-center justify-between text-purple-800 text-xs font-semibold mb-1">
              <span>Manager Approval</span>
              <BadgeCheck className="w-4 h-4 text-purple-600" />
            </div>
            <div className="text-2xl font-bold text-purple-800">{kpis.pendingApprovalCount}</div>
            <div className="text-[11px] text-purple-700 mt-0.5">Awaiting Omar sign-off</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-cyan-200 bg-cyan-50/30 shadow-2xs">
            <div className="flex items-center justify-between text-cyan-800 text-xs font-semibold mb-1">
              <span>Coordinator Follow-Up</span>
              <Phone className="w-4 h-4 text-cyan-600" />
            </div>
            <div className="text-2xl font-bold text-cyan-800">{kpis.activeFollowUpCount}</div>
            <div className="text-[11px] text-cyan-700 mt-0.5">Sara active calls/WhatsApp</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
              <span>Open Pipeline (SAR)</span>
              <DollarSign className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="text-lg font-extrabold text-slate-900">
              {formatCompactSAR(kpis.openPipelineSAR)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Inclusive of 15% KSA VAT</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40 shadow-2xs">
            <div className="flex items-center justify-between text-emerald-800 text-xs font-semibold mb-1">
              <span>Won POs (SAR)</span>
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-lg font-extrabold text-emerald-700">
              {formatCompactSAR(kpis.wonRevenueSAR)}
            </div>
            <div className="text-[11px] text-emerald-700 mt-0.5">Closed POs incl. 15% VAT</div>
          </div>
        </section>

        {/* SMART ACTION ALERTS & SLA NUDGES */}
        {smartAlerts.length > 0 && (
          <section className="bg-white rounded-xl border border-amber-200 shadow-2xs overflow-hidden">
            <div
              onClick={() => setShowAlertsDrawer(!showAlertsDrawer)}
              className="px-4 py-2 bg-gradient-to-r from-amber-50 via-orange-50 to-rose-50 border-b border-amber-200/70 flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-white">
                  <Bell className="w-3.5 h-3.5" />
                </span>
                <h2 className="text-xs sm:text-sm font-bold text-slate-800">
                  Team Action Alerts &amp; SLA Reminders ({smartAlerts.length})
                </h2>
              </div>
              <button className="text-xs font-semibold text-amber-900 hover:underline">
                {showAlertsDrawer ? 'Collapse' : 'Expand'}
              </button>
            </div>

            {showAlertsDrawer && (
              <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
                {smartAlerts.map((alert) => {
                  const ownerMember = getMember(alert.owner);
                  const style =
                    alert.severity === 'high'
                      ? 'border-rose-200 bg-rose-50/50'
                      : 'border-amber-200 bg-amber-50/50';
                  return (
                    <div
                      key={alert.id}
                      onClick={() => setSelectedInquiryId(alert.inquiryId)}
                      className={`p-2.5 rounded-lg border ${style} hover:shadow-sm transition cursor-pointer flex flex-col justify-between gap-1`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900">{alert.title}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700 whitespace-nowrap">
                          {ownerMember.role}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-snug">{alert.description}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* FILTER & VIEW CONTROLS BAR */}
        <section className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customer, project, quote ref, or BOQ item..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
              />
            </div>

            {/* Division Filter */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Filter className="w-4 h-4 text-slate-400 hidden sm:inline" />
              {['ALL', 'MEP', 'IT Services', 'Hybrid (MEP + IT)'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    categoryFilter === cat
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {cat === 'ALL' ? 'All Divisions' : cat}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-auto">
            <button
              onClick={() => setShowFxWidget(!showFxWidget)}
              className="xl:hidden inline-flex items-center gap-1 bg-amber-50 text-amber-900 border border-amber-200 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
            >
              <RefreshCw className="w-3.5 h-3.5" /> FX Rates
            </button>

            <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
              <button
                onClick={() => setViewMode('KANBAN')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  viewMode === 'KANBAN'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Kanban className="w-3.5 h-3.5" /> Kanban Board
              </button>
              <button
                onClick={() => setViewMode('TABLE')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  viewMode === 'TABLE'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" /> List View
              </button>
            </div>
          </div>
        </section>

        {/* =================================================================== */}
        {/* VIEW 1: 7-STAGE KANBAN BOARD (TRANSPARENT ACROSS ALL ROLES)         */}
        {/* =================================================================== */}
        {viewMode === 'KANBAN' && (
          <section className="overflow-x-auto pb-4">
            <div className="flex gap-3.5 min-w-[1680px]">
              {STAGES.map((stage) => {
                const stageInquiries = filteredInquiries.filter((i) => i.stage === stage.id);
                const stageGrandTotalSAR = stageInquiries.reduce(
                  (sum, i) => sum + calculateBoqTotals(i.boqItems).grandTotal,
                  0
                );

                return (
                  <div
                    key={stage.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (draggedId) {
                        handleStageChange(draggedId, stage.id);
                        setDraggedId(null);
                      }
                    }}
                    className={`w-[255px] flex-shrink-0 rounded-xl border ${stage.colBg} flex flex-col max-h-[calc(100vh-300px)] min-h-[500px]`}
                  >
                    {/* Column Header */}
                    <div className={`p-3 rounded-t-xl border-b border-slate-200/80 ${stage.headerBg}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${stage.dotColor}`} />
                          <h3 className="text-xs font-bold tracking-tight">{stage.title}</h3>
                        </div>
                        <span className="text-xs font-bold bg-white/85 text-slate-900 px-2 py-0.5 rounded-full">
                          {stageInquiries.length}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] opacity-90">
                        <span>{stage.ownerRole}</span>
                        <span className="font-bold">{formatCompactSAR(stageGrandTotalSAR)}</span>
                      </div>
                    </div>

                    {/* Cards List */}
                    <div className="p-2.5 space-y-2.5 overflow-y-auto flex-1">
                      {stageInquiries.length === 0 ? (
                        <div className="h-24 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-xs text-slate-400">
                          Drop inquiry here
                        </div>
                      ) : (
                        stageInquiries.map((inq) => {
                          const totals = calculateBoqTotals(inq.boqItems);
                          const salesman = getMember(inq.assignedSalesman);
                          const isHighlighted = isActionableForActiveRole(inq);
                          const hrsSinceUpdate = getHoursSince(inq.lastUpdatedAt);
                          const isOverdue =
                            (inq.stage === 'QUOTED_TO_CUSTOMER' ||
                              inq.stage === 'FOLLOW_UP_ACTIVE') &&
                            hrsSinceUpdate >= 48;
                          const nextStage = getNextStage(inq.stage);
                          const isApproved = inq.managerApproval?.status === 'APPROVED';

                          return (
                            <div
                              key={inq.id}
                              draggable
                              onDragStart={() => setDraggedId(inq.id)}
                              onClick={() => setSelectedInquiryId(inq.id)}
                              className={`bg-white rounded-xl p-3 border transition-all cursor-pointer shadow-2xs hover:shadow-md ${
                                !isHighlighted
                                  ? 'opacity-45 border-slate-200'
                                  : isOverdue
                                  ? 'border-rose-400 ring-1 ring-rose-300'
                                  : activeRole !== 'ALL'
                                  ? 'border-emerald-500 ring-1 ring-emerald-200'
                                  : 'border-slate-200'
                              }`}
                            >
                              {/* Card Top Bar */}
                              <div className="flex items-center justify-between gap-1 mb-1.5">
                                <span className="text-[11px] font-mono font-bold text-slate-500">
                                  {inq.quoteRef || inq.id}
                                </span>
                                {renderCategoryBadge(inq.category)}
                              </div>

                              {/* Customer & Project */}
                              <h4 className="text-sm font-bold text-slate-900 leading-snug">
                                {inq.customerName}
                              </h4>
                              <p className="text-xs text-slate-600 line-clamp-2 mt-0.5 mb-2">
                                {inq.projectTitle}
                              </p>

                              {/* Manager Approval Badge (Visible across pipeline) */}
                              {(inq.stage === 'PENDING_APPROVAL' ||
                                inq.stage === 'QUOTED_TO_CUSTOMER' ||
                                inq.stage === 'FOLLOW_UP_ACTIVE') && (
                                <div className="mb-2">
                                  {isApproved ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      <BadgeCheck className="w-3 h-3" /> Manager Approved
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                                      <Clock className="w-3 h-3" /> Pending Manager Approval
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* SAR Pricing Box (Excl. & Incl. 15% VAT) */}
                              <div className="bg-slate-50 rounded-lg p-2 mb-2 border border-slate-100">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-semibold text-slate-500 uppercase">
                                    Total (Incl. 15% VAT)
                                  </span>
                                  {totals.totalCostSAR > 0 && (
                                    <span className="text-[10px] font-bold text-emerald-600">
                                      +{totals.overallMarginPercent}% Margin
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs font-extrabold text-slate-900 mt-0.5">
                                  {formatCompactSAR(totals.grandTotal)}
                                </div>
                                <div className="text-[10px] text-slate-500 flex justify-between mt-0.5">
                                  <span>Net: {formatCompactSAR(totals.subtotalSellSAR)}</span>
                                  <span>{inq.boqItems.length} BOQ item(s)</span>
                                </div>
                              </div>

                              {/* Overdue Follow-up Warning */}
                              {isOverdue && (
                                <div className="mb-2 px-2 py-1 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-semibold flex items-center gap-1">
                                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span>Follow-up overdue ({hrsSinceUpdate}h)</span>
                                </div>
                              )}

                              {inq.stage === 'WON' && inq.poNumber && (
                                <div className="mb-2 px-2 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold">
                                  PO: {inq.poNumber}
                                </div>
                              )}

                              {/* Salesman & Timestamp */}
                              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1.5 border-t border-slate-100">
                                <span className="font-semibold text-slate-700 truncate max-w-[125px]">
                                  {salesman.name.split(' ')[0]} ({salesman.role.replace('Salesman ', 'S')})
                                </span>
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {formatRelativeTime(inq.lastUpdatedAt)}
                                </span>
                              </div>

                              {/* Contextual Quick Action Buttons */}
                              {inq.stage !== 'WON' && inq.stage !== 'LOST' && (
                                <div
                                  className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-1.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {inq.stage === 'PENDING_APPROVAL' && !isApproved && (
                                    <button
                                      onClick={() =>
                                        handleManagerApprovalToggle(inq.id, 'APPROVED')
                                      }
                                      className="flex-1 inline-flex items-center justify-center gap-1 bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold py-1.5 px-2 rounded-lg transition"
                                    >
                                      <BadgeCheck className="w-3.5 h-3.5" /> Approve
                                    </button>
                                  )}

                                  {(inq.stage === 'QUOTED_TO_CUSTOMER' ||
                                    inq.stage === 'FOLLOW_UP_ACTIVE') && (
                                    <button
                                      onClick={() => setQuickFollowUpInquiry(inq)}
                                      className="flex-1 inline-flex items-center justify-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-semibold py-1.5 px-2 rounded-lg transition"
                                    >
                                      <Phone className="w-3 h-3" /> Follow-Up
                                    </button>
                                  )}

                                  {nextStage && (
                                    <button
                                      onClick={() => handleStageChange(inq.id, nextStage.id)}
                                      title={`Move to ${nextStage.title}`}
                                      className="px-2.5 inline-flex items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-semibold py-1.5 rounded-lg transition"
                                    >
                                      <span>Next</span>
                                      <ArrowRight className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* =================================================================== */}
        {/* VIEW 2: LIST / TABLE VIEW                                           */}
        {/* =================================================================== */}
        {viewMode === 'TABLE' && (
          <section className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                    <th className="py-3 px-4">Ref / Division</th>
                    <th className="py-3 px-4">Customer &amp; Project</th>
                    <th className="py-3 px-4">Stage &amp; Approval</th>
                    <th className="py-3 px-4">Sales Owner</th>
                    <th className="py-3 px-4">Cost (SAR)</th>
                    <th className="py-3 px-4">Quote Total (+15% VAT)</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredInquiries.map((inq) => {
                    const totals = calculateBoqTotals(inq.boqItems);
                    const stageObj = STAGES.find((s) => s.id === inq.stage);
                    const salesman = getMember(inq.assignedSalesman);
                    const isHighlighted = isActionableForActiveRole(inq);

                    return (
                      <tr
                        key={inq.id}
                        onClick={() => setSelectedInquiryId(inq.id)}
                        className={`hover:bg-emerald-50/40 cursor-pointer transition ${
                          !isHighlighted ? 'opacity-50' : ''
                        }`}
                      >
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-mono text-xs font-bold text-slate-800">
                            {inq.quoteRef || inq.id}
                          </div>
                          <div className="mt-1">{renderCategoryBadge(inq.category)}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">
                            {inq.customerName}{' '}
                            <span className="text-xs font-normal text-slate-500">({inq.city})</span>
                          </div>
                          <div className="text-xs text-slate-600 line-clamp-1">{inq.projectTitle}</div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${stageObj?.headerBg}`}
                          >
                            {stageObj?.title}
                          </span>
                          {inq.managerApproval?.status === 'APPROVED' && (
                            <div className="text-[11px] text-emerald-700 font-semibold mt-1 flex items-center gap-1">
                              <BadgeCheck className="w-3 h-3" /> Mgr Approved
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-xs font-semibold text-slate-700">
                          {salesman.name}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-xs text-slate-600">
                          {formatCompactSAR(totals.totalCostSAR)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="text-xs font-extrabold text-slate-900">
                            {formatCompactSAR(totals.grandTotal)}
                          </div>
                          <div className="text-[11px] text-emerald-600 font-semibold">
                            Net: {formatCompactSAR(totals.subtotalSellSAR)} (+{totals.overallMarginPercent}%)
                          </div>
                        </td>
                        <td
                          className="py-3 px-4 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1.5">
                            {inq.stage !== 'WON' && inq.stage !== 'LOST' && (
                              <button
                                onClick={() => setQuickFollowUpInquiry(inq)}
                                className="px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-lg"
                              >
                                + Follow-Up
                              </button>
                            )}
                            <button
                              onClick={() => setSelectedInquiryId(inq.id)}
                              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg"
                            >
                              Open BOQ
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {/* ===================================================================== */}
      {/* MODAL 1: LOG NEW MULTI-ITEM MEP / IT INQUIRY                          */}
      {/* ===================================================================== */}
      {isNewModalOpen && (
        <NewInquiryModal
          fxRates={fxRates}
          onClose={() => setIsNewModalOpen(false)}
          onCreate={handleCreateInquiry}
          defaultSalesman={
            activeRole === 'SALES_1' || activeRole === 'SALES_2' ? activeRole : 'SALES_1'
          }
        />
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: QUICK FOLLOW-UP & WHATSAPP / EMAIL TEMPLATE GENERATOR        */}
      {/* ===================================================================== */}
      {quickFollowUpInquiry && (
        <QuickFollowUpModal
          inquiry={quickFollowUpInquiry}
          onClose={() => setQuickFollowUpInquiry(null)}
          onSubmit={(payload) => {
            handleLogFollowUp(quickFollowUpInquiry.id, payload);
            setQuickFollowUpInquiry(null);
          }}
        />
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: MARK AS WON (RECORD CUSTOMER PO NUMBER)                      */}
      {/* ===================================================================== */}
      {wonModalInquiry && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-emerald-800 flex items-center gap-2">
                <Award className="w-5 h-5" /> Mark Deal Won / PO Received
              </h3>
              <button
                onClick={() => setWonModalInquiry(null)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600 mb-3">
              Enter the official Customer Purchase Order (PO) reference for{' '}
              <strong>{wonModalInquiry.customerName}</strong> (
              {formatSAR(calculateBoqTotals(wonModalInquiry.boqItems).grandTotal)} incl. VAT).
            </p>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Customer PO Number *
            </label>
            <input
              type="text"
              placeholder="e.g., PO-2026-4410"
              value={poNumberInput}
              onChange={(e) => setPoNumberInput(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm mb-4 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setWonModalInquiry(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={confirmMarkAsWon}
                className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl"
              >
                Confirm Won PO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 4: MARK AS LOST REASON                                          */}
      {/* ===================================================================== */}
      {lostModalInquiry && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-slate-900">Close Inquiry as Lost</h3>
              <button
                onClick={() => setLostModalInquiry(null)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600 mb-3">
              Select why <strong>{lostModalInquiry.customerName}</strong> did not award the PO:
            </p>
            <select
              value={lostReasonInput}
              onChange={(e) => setLostReasonInput(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm mb-4"
            >
              <option value="Price higher than competitor">Price higher than competitor</option>
              <option value="Delivery lead time too long">Delivery lead time too long</option>
              <option value="Technical specification / brand change">
                Technical specification / brand change
              </option>
              <option value="Customer project postponed / cancelled">
                Customer project postponed / cancelled
              </option>
              <option value="Credit / payment terms mismatch">Credit / payment terms mismatch</option>
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setLostModalInquiry(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={confirmMarkAsLost}
                className="px-4 py-2 text-sm font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-xl"
              >
                Confirm Closed Lost
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* DRAWER: FULL BOQ, MULTI-CURRENCY SUPPLIER QUOTES, APPROVAL & FOLLOWUP */}
      {/* ===================================================================== */}
      {selectedInquiry && (
        <InquiryDetailDrawer
          inquiry={selectedInquiry}
          fxRates={fxRates}
          onClose={() => setSelectedInquiryId(null)}
          onStageChange={handleStageChange}
          onSaveBoqAndQuotes={handleUpdateBoqAndQuotes}
          onApprovalToggle={handleManagerApprovalToggle}
          onLogFollowUp={handleLogFollowUp}
        />
      )}

      {/* TOAST FEEDBACK */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl border border-slate-700 flex items-center gap-2.5 text-sm font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENT: NEW MULTI-ITEM INQUIRY MODAL
// ============================================================================

function NewInquiryModal({ fxRates, onClose, onCreate, defaultSalesman }) {
  const [customerName, setCustomerName] = useState('');
  const [city, setCity] = useState('Jeddah');
  const [projectTitle, setProjectTitle] = useState('');
  const [category, setCategory] = useState('MEP');
  const [contactPerson, setContactPerson] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [assignedSalesman, setAssignedSalesman] = useState(defaultSalesman);
  const [priority, setPriority] = useState('High');

  const [boqItems, setBoqItems] = useState([
    {
      id: `BI-${Date.now()}`,
      description: '',
      qty: 1,
      unit: 'Unit',
      supplierCurrency: 'USD',
      unitCostForeign: 0,
      fxRate: fxRates.USD,
      marginPercent: 18
    }
  ]);

  const handleCategoryChange = (newCat) => {
    setCategory(newCat);
    if (newCat === 'MEP') setAssignedSalesman('SALES_1');
    if (newCat === 'IT Services') setAssignedSalesman('SALES_2');
  };

  const addBoqRow = () => {
    setBoqItems([
      ...boqItems,
      {
        id: `BI-${Date.now()}-${boqItems.length}`,
        description: '',
        qty: 1,
        unit: 'Unit',
        supplierCurrency: 'USD',
        unitCostForeign: 0,
        fxRate: fxRates.USD,
        marginPercent: 18
      }
    ]);
  };

  const updateBoqRow = (idx, field, val) => {
    setBoqItems((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        if (field === 'supplierCurrency') {
          return { ...row, supplierCurrency: val, fxRate: fxRates[val] || 1 };
        }
        return { ...row, [field]: val };
      })
    );
  };

  const removeBoqRow = (idx) => {
    if (boqItems.length <= 1) return;
    setBoqItems(boqItems.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!customerName.trim() || !projectTitle.trim()) return;
    const validItems = boqItems.filter((i) => i.description.trim());
    onCreate({
      customerName,
      city,
      projectTitle,
      category,
      contactPerson,
      contactEmail,
      contactPhone,
      assignedSalesman,
      priority,
      boqItems:
        validItems.length > 0
          ? validItems
          : [
              {
                id: `BI-${Date.now()}`,
                description: projectTitle,
                qty: 1,
                unit: 'Lot',
                supplierCurrency: 'USD',
                unitCostForeign: 0,
                fxRate: fxRates.USD,
                marginPercent: 18
              }
            ]
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 my-8">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              Log New Customer Inquiry &amp; BOQ
            </h3>
            <p className="text-xs text-slate-500">
              Visible immediately to Purchase Officer (Khalid) for multi-currency vendor RFQs
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Customer Company Name *
              </label>
              <input
                required
                type="text"
                placeholder="e.g., Al-Jazirah Contracting & Trading Co."
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">City (KSA)</label>
              <input
                type="text"
                placeholder="Jeddah / Riyadh / Dammam"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Project / Inquiry Subject *
              </label>
              <input
                required
                type="text"
                placeholder="e.g., Chiller Plant VFD Panels & Fiber Switch Upgrade"
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Division</label>
              <select
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white font-semibold"
              >
                <option value="MEP">MEP</option>
                <option value="IT Services">IT Services</option>
                <option value="Hybrid (MEP + IT)">Hybrid (MEP + IT)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Contact Person *
              </label>
              <input
                required
                type="text"
                placeholder="Eng. Mohammed"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Phone / WhatsApp
              </label>
              <input
                type="text"
                placeholder="+966 5X XXX XXXX"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Assigned Salesman
              </label>
              <select
                value={assignedSalesman}
                onChange={(e) => setAssignedSalesman(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white"
              >
                <option value="SALES_1">Tariq Al-Harbi (Salesman 1 - MEP)</option>
                <option value="SALES_2">Faisal Al-Qahtani (Salesman 2 - IT)</option>
              </select>
            </div>
          </div>

          {/* Initial BOQ Line Items */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">
                Bill of Quantities (BOQ Line Items)
              </span>
              <button
                type="button"
                onClick={addBoqRow}
                className="text-xs font-bold text-emerald-700 hover:text-emerald-600 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add Line Item
              </button>
            </div>

            {boqItems.map((row, idx) => (
              <div key={row.id} className="grid grid-cols-12 gap-2 items-center">
                <input
                  required
                  type="text"
                  placeholder="Material / IT equipment / service description"
                  value={row.description}
                  onChange={(e) => updateBoqRow(idx, 'description', e.target.value)}
                  className="col-span-6 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                />
                <input
                  type="number"
                  min="1"
                  value={row.qty}
                  onChange={(e) => updateBoqRow(idx, 'qty', e.target.value)}
                  className="col-span-2 border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white text-center"
                />
                <input
                  type="text"
                  placeholder="Unit"
                  value={row.unit}
                  onChange={(e) => updateBoqRow(idx, 'unit', e.target.value)}
                  className="col-span-2 border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white text-center"
                />
                <select
                  value={row.supplierCurrency}
                  onChange={(e) => updateBoqRow(idx, 'supplierCurrency', e.target.value)}
                  className="col-span-1 border border-slate-300 rounded-lg px-1 py-1.5 text-xs bg-white"
                >
                  {Object.keys(fxRates).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeBoqRow(idx)}
                  className="col-span-1 text-slate-400 hover:text-rose-600 flex justify-center"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow"
            >
              Create Inquiry
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENT: QUICK FOLLOW-UP MODAL WITH WHATSAPP & EMAIL TEMPLATES
// ============================================================================

function QuickFollowUpModal({ inquiry, onClose, onSubmit }) {
  const totals = calculateBoqTotals(inquiry.boqItems);
  const [channel, setChannel] = useState('WhatsApp');
  const [selectedTplId, setSelectedTplId] = useState(FOLLOW_UP_TEMPLATES[0].id);
  const [messageDraft, setMessageDraft] = useState(() =>
    FOLLOW_UP_TEMPLATES[0].buildText(inquiry, totals)
  );
  const [outcome, setOutcome] = useState('');
  const [nextActionDate, setNextActionDate] = useState(daysFromNow(2));
  const [copied, setCopied] = useState(false);

  const handleSelectTemplate = (tplId) => {
    setSelectedTplId(tplId);
    const tpl = FOLLOW_UP_TEMPLATES.find((t) => t.id === tplId);
    if (tpl) {
      setChannel(tpl.channel);
      setMessageDraft(tpl.buildText(inquiry, totals));
    }
  };

  const handleCopyMessage = () => {
    navigator.clipboard?.writeText(messageDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!outcome.trim()) return;
    onSubmit({ channel, outcome, nextActionDate });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 my-8">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <span className="text-[11px] font-mono font-bold text-cyan-700">
              {inquiry.quoteRef || inquiry.id} • {formatSAR(totals.grandTotal)} (Incl. VAT)
            </span>
            <h3 className="text-lg font-bold text-slate-900">
              Sales Coordinator Follow-Up Hub
            </h3>
            <p className="text-xs text-slate-500">
              {inquiry.customerName} — {inquiry.contactPerson} ({inquiry.contactPhone})
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pre-Written Follow-Up Message Generator */}
        <div className="mt-4 bg-cyan-50/60 border border-cyan-200 rounded-xl p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-cyan-900">
              Ready-to-Send WhatsApp / Email Template:
            </span>
            <select
              value={selectedTplId}
              onChange={(e) => handleSelectTemplate(e.target.value)}
              className="text-xs bg-white border border-cyan-300 rounded-lg px-2.5 py-1 font-semibold text-slate-800"
            >
              {FOLLOW_UP_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <textarea
            rows={4}
            value={messageDraft}
            onChange={(e) => setMessageDraft(e.target.value)}
            className="w-full text-xs bg-white border border-cyan-200 rounded-lg p-2.5 text-slate-700 leading-relaxed"
          />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCopyMessage}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-semibold"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied to Clipboard!' : 'Copy Message for WhatsApp / Email'}
            </button>
          </div>
        </div>

        {/* Log Outcome Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Channel Used for This Follow-Up
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'Phone', icon: Phone },
                { id: 'WhatsApp', icon: MessageSquare },
                { id: 'Email', icon: Mail }
              ].map((item) => {
                const Icon = item.icon;
                const active = channel === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setChannel(item.id)}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {item.id}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Customer Response / Call Summary *
            </label>
            <textarea
              required
              rows={2}
              placeholder="e.g., Spoke with Eng. Abdullah via phone; PO is in final signature with Procurement Manager, expected Sunday."
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Next Scheduled Follow-Up Date
            </label>
            <input
              type="date"
              value={nextActionDate}
              onChange={(e) => setNextActionDate(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl shadow"
            >
              Save Follow-Up Log
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENT: FULL INQUIRY DETAIL DRAWER (BOQ, FX, APPROVAL & QUOTE COPY)
// ============================================================================

function InquiryDetailDrawer({
  inquiry,
  fxRates,
  onClose,
  onStageChange,
  onSaveBoqAndQuotes,
  onApprovalToggle,
  onLogFollowUp
}) {
  const [activeTab, setActiveTab] = useState('BOQ_COSTING'); // 'BOQ_COSTING' | 'FOLLOWUPS' | 'QUOTE_PREVIEW' | 'TIMELINE'

  // Editable BOQ state
  const [boqItems, setBoqItems] = useState(inquiry.boqItems || []);
  const [supplierQuotes, setSupplierQuotes] = useState(inquiry.supplierQuotes || []);

  // Add Supplier Quote form state
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorCurr, setNewVendorCurr] = useState('USD');
  const [newVendorAmount, setNewVendorAmount] = useState('');
  const [newVendorLead, setNewVendorLead] = useState('10 Days');
  const [newVendorNotes, setNewVendorNotes] = useState('');

  // Approval Note state
  const [approvalNote, setApprovalNote] = useState(inquiry.managerApproval?.note || '');

  // Inline Follow-Up state
  const [fuChannel, setFuChannel] = useState('Phone');
  const [fuOutcome, setFuOutcome] = useState('');
  const [fuNextDate, setFuNextDate] = useState(daysFromNow(2));

  // Quote Copy feedback
  const [quoteCopied, setQuoteCopied] = useState(false);

  const totals = useMemo(() => calculateBoqTotals(boqItems), [boqItems]);
  const salesman = getMember(inquiry.assignedSalesman);
  const isApproved = inquiry.managerApproval?.status === 'APPROVED';

  const handleUpdateBoqField = (idx, field, val) => {
    setBoqItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        if (field === 'supplierCurrency') {
          return { ...item, supplierCurrency: val, fxRate: fxRates[val] || 1 };
        }
        return { ...item, [field]: val };
      })
    );
  };

  const handleAddBoqItem = () => {
    setBoqItems([
      ...boqItems,
      {
        id: `BI-${Date.now()}`,
        description: 'New BOQ Item / Service',
        qty: 1,
        unit: 'Unit',
        supplierCurrency: 'USD',
        unitCostForeign: 0,
        fxRate: fxRates.USD,
        marginPercent: 18
      }
    ]);
  };

  const handleDeleteBoqItem = (idx) => {
    if (boqItems.length <= 1) return;
    setBoqItems(boqItems.filter((_, i) => i !== idx));
  };

  const handleAddSupplierQuote = (e) => {
    e.preventDefault();
    if (!newVendorName.trim() || !newVendorAmount) return;
    const sq = {
      id: `SQ-${Date.now()}`,
      vendorName: newVendorName,
      currency: newVendorCurr,
      fxRate: fxRates[newVendorCurr] || 1,
      quotedTotalForeign: Number(newVendorAmount),
      leadTime: newVendorLead,
      notes: newVendorNotes,
      isSelected: supplierQuotes.length === 0
    };
    setSupplierQuotes([...supplierQuotes, sq]);
    setNewVendorName('');
    setNewVendorAmount('');
    setNewVendorNotes('');
  };

  const selectVendorQuote = (sqId) => {
    setSupplierQuotes((prev) =>
      prev.map((q) => ({ ...q, isSelected: q.id === sqId }))
    );
  };

  // Build formatted SAR Quotation Text for WhatsApp / Email
  const formattedCustomerQuoteText = useMemo(() => {
    const lines = totals.items
      .map(
        (it, idx) =>
          `${idx + 1}. ${it.description} — Qty: ${it.qty} ${it.unit} @ ${formatSAR(
            it.unitSellSAR
          )} = ${formatSAR(it.lineSellSAR)}`
      )
      .join('\n');

    return `COMMERCIAL QUOTATION (${inquiry.quoteRef || inquiry.id})
Customer: ${inquiry.customerName} (${inquiry.city})
Attn: ${inquiry.contactPerson}
Project: ${inquiry.projectTitle}

BOQ SUMMARY (SAR):
${lines}

Subtotal (Excl. VAT): ${formatSAR(totals.subtotalSellSAR)}
KSA VAT (15%): ${formatSAR(totals.vatAmountSAR)}
GRAND TOTAL (Incl. 15% VAT): ${formatSAR(totals.grandTotal)}

Validity: Until ${inquiry.quoteValidUntil || '14 Days'}
Prepared by: ${salesman.name} (${salesman.division})`;
  }, [inquiry, totals, salesman]);

  const handleCopyQuoteText = () => {
    navigator.clipboard?.writeText(formattedCustomerQuoteText);
    setQuoteCopied(true);
    setTimeout(() => setQuoteCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex justify-end">
      <div className="bg-white w-full max-w-4xl h-full shadow-2xl flex flex-col overflow-hidden">
        {/* Drawer Header */}
        <div className="p-5 bg-slate-900 text-white flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-xs font-mono bg-slate-800 px-2 py-0.5 rounded text-emerald-300 font-bold">
                {inquiry.quoteRef || inquiry.id}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-200">
                {inquiry.category}
              </span>
              <span className="text-xs text-slate-300">
                Owner: <strong>{salesman.name}</strong>
              </span>
            </div>
            <h2 className="text-xl font-bold">
              {inquiry.customerName}{' '}
              <span className="text-sm font-normal text-slate-400">({inquiry.city})</span>
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">{inquiry.projectTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stage & Sales Manager Approval Bar */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-600">Pipeline Stage:</span>
            <select
              value={inquiry.stage}
              onChange={(e) => onStageChange(inquiry.id, e.target.value)}
              className="text-xs font-bold bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-900"
            >
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>

          {/* Manager Verbal/System Approval Control */}
          <div className="flex items-center gap-2">
            {isApproved ? (
              <div className="flex items-center gap-2 bg-emerald-100 border border-emerald-300 text-emerald-900 px-3 py-1 rounded-lg text-xs font-bold">
                <BadgeCheck className="w-4 h-4 text-emerald-700" />
                <span>Approved by Omar Al-Ghamdi</span>
                <button
                  onClick={() => onApprovalToggle(inquiry.id, 'PENDING')}
                  className="text-[10px] underline ml-1 text-emerald-800"
                >
                  Reset
                </button>
              </div>
            ) : (
              <button
                onClick={() => onApprovalToggle(inquiry.id, 'APPROVED', approvalNote)}
                className="inline-flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-2xs"
              >
                <BadgeCheck className="w-4 h-4" />
                Record Sales Manager Approval
              </button>
            )}

            {inquiry.stage !== 'WON' && inquiry.stage !== 'LOST' && (
              <>
                <button
                  onClick={() => onStageChange(inquiry.id, 'WON')}
                  className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg"
                >
                  Won (PO)
                </button>
                <button
                  onClick={() => onStageChange(inquiry.id, 'LOST')}
                  className="px-2.5 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs font-bold rounded-lg"
                >
                  Lost
                </button>
              </>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 px-5 bg-white overflow-x-auto">
          <button
            onClick={() => setActiveTab('BOQ_COSTING')}
            className={`py-3 px-4 text-xs font-bold border-b-2 whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'BOQ_COSTING'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            BOQ, Multi-Currency RFQ &amp; Margin ({boqItems.length})
          </button>

          <button
            onClick={() => setActiveTab('FOLLOWUPS')}
            className={`py-3 px-4 text-xs font-bold border-b-2 whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'FOLLOWUPS'
                ? 'border-cyan-600 text-cyan-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Phone className="w-3.5 h-3.5" />
            Coordinator Follow-Ups ({inquiry.followUps.length})
          </button>

          <button
            onClick={() => setActiveTab('QUOTE_PREVIEW')}
            className={`py-3 px-4 text-xs font-bold border-b-2 whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'QUOTE_PREVIEW'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            Customer Quote (SAR + 15% VAT)
          </button>

          <button
            onClick={() => setActiveTab('TIMELINE')}
            className={`py-3 px-4 text-xs font-bold border-b-2 whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'TIMELINE'
                ? 'border-slate-800 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Audit Log ({inquiry.timeline.length})
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* ================================================================= */}
          {/* TAB 1: MULTI-ITEM BOQ, MULTI-CURRENCY COSTING & MARGIN CALCULATOR */}
          {/* ================================================================= */}
          {activeTab === 'BOQ_COSTING' && (
            <>
              {/* Financial Summary Banner (Cost SAR -> Sell SAR -> +15% VAT) */}
              <div className="bg-slate-900 text-white rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">
                    Total Landed Cost (SAR)
                  </div>
                  <div className="text-sm sm:text-base font-bold mt-0.5">
                    {formatSAR(totals.totalCostSAR)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-emerald-400 uppercase font-semibold">
                    Gross Profit ({totals.overallMarginPercent}%)
                  </div>
                  <div className="text-sm sm:text-base font-bold text-emerald-400 mt-0.5">
                    +{formatSAR(totals.grossProfitSAR)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-blue-300 uppercase font-semibold">
                    Selling Subtotal (Excl. VAT)
                  </div>
                  <div className="text-sm sm:text-base font-bold text-white mt-0.5">
                    {formatSAR(totals.subtotalSellSAR)}
                  </div>
                </div>
                <div className="bg-emerald-950/80 border border-emerald-700/60 rounded-lg p-2">
                  <div className="text-[10px] text-emerald-300 uppercase font-bold">
                    Grand Total (+15% VAT)
                  </div>
                  <div className="text-sm sm:text-base font-extrabold text-emerald-300 mt-0.5">
                    {formatSAR(totals.grandTotal)}
                  </div>
                </div>
              </div>

              {/* Multi-Item BOQ Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    BOQ Costing &amp; SAR Selling Price Sheet
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddBoqItem}
                    className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-600"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add BOQ Line
                  </button>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                        <th className="py-2 px-2.5">Item / Service Description</th>
                        <th className="py-2 px-2 text-center">Qty</th>
                        <th className="py-2 px-2">Buy Curr</th>
                        <th className="py-2 px-2">Unit Cost</th>
                        <th className="py-2 px-2">FX→SAR</th>
                        <th className="py-2 px-2">Margin %</th>
                        <th className="py-2 px-2.5 text-right">Line Sell (SAR)</th>
                        <th className="py-2 px-1"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {totals.items.map((item, idx) => (
                        <tr key={item.id} className="bg-white">
                          <td className="py-2 px-2.5 min-w-[190px]">
                            <input
                              type="text"
                              value={item.description}
                              onChange={(e) =>
                                handleUpdateBoqField(idx, 'description', e.target.value)
                              }
                              className="w-full border border-slate-200 rounded px-2 py-1 text-xs font-medium"
                            />
                          </td>
                          <td className="py-2 px-1.5 w-16">
                            <input
                              type="number"
                              min="1"
                              value={item.qty}
                              onChange={(e) => handleUpdateBoqField(idx, 'qty', e.target.value)}
                              className="w-14 border border-slate-200 rounded px-1.5 py-1 text-xs text-center"
                            />
                          </td>
                          <td className="py-2 px-1.5 w-20">
                            <select
                              value={item.supplierCurrency}
                              onChange={(e) =>
                                handleUpdateBoqField(idx, 'supplierCurrency', e.target.value)
                              }
                              className="border border-slate-200 rounded px-1.5 py-1 text-xs font-bold bg-amber-50/60"
                            >
                              {Object.keys(fxRates).map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-1.5 w-24">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unitCostForeign}
                              onChange={(e) =>
                                handleUpdateBoqField(idx, 'unitCostForeign', e.target.value)
                              }
                              className="w-22 border border-slate-200 rounded px-2 py-1 text-xs text-right font-semibold"
                            />
                          </td>
                          <td className="py-2 px-1.5 w-20">
                            <input
                              type="number"
                              step="0.01"
                              value={item.fxRate}
                              onChange={(e) => handleUpdateBoqField(idx, 'fxRate', e.target.value)}
                              className="w-16 border border-slate-200 rounded px-1.5 py-1 text-xs text-right text-slate-600"
                            />
                          </td>
                          <td className="py-2 px-1.5 w-20">
                            <input
                              type="number"
                              step="0.5"
                              value={item.marginPercent}
                              onChange={(e) =>
                                handleUpdateBoqField(idx, 'marginPercent', e.target.value)
                              }
                              className="w-16 border border-slate-200 rounded px-1.5 py-1 text-xs text-right font-bold text-emerald-700"
                            />
                          </td>
                          <td className="py-2 px-2.5 text-right font-bold text-slate-900 whitespace-nowrap">
                            {formatCompactSAR(item.lineSellSAR)}
                          </td>
                          <td className="py-2 px-1 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteBoqItem(idx)}
                              className="text-slate-400 hover:text-rose-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Save & Stage Handover Actions */}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => onSaveBoqAndQuotes(inquiry.id, boqItems, supplierQuotes, null)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl"
                  >
                    Save BOQ &amp; SAR Prices
                  </button>

                  {(inquiry.stage === 'NEW_INQUIRY' || inquiry.stage === 'SENT_TO_SUPPLIER') && (
                    <button
                      type="button"
                      onClick={() =>
                        onSaveBoqAndQuotes(
                          inquiry.id,
                          boqItems,
                          supplierQuotes,
                          'PENDING_APPROVAL'
                        )
                      }
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl shadow"
                    >
                      Save &amp; Submit for Manager Approval
                    </button>
                  )}
                </div>
              </div>

              {/* Multi-Vendor RFQ Comparison Log (Purchase Officer) */}
              <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                  Supplier RFQ Quotes Received (Multi-Currency Comparison)
                </h4>

                {supplierQuotes.length > 0 && (
                  <div className="space-y-2">
                    {supplierQuotes.map((sq) => {
                      const convertedSAR = (Number(sq.quotedTotalForeign) || 0) * (Number(sq.fxRate) || 1);
                      return (
                        <div
                          key={sq.id}
                          onClick={() => selectVendorQuote(sq.id)}
                          className={`p-3 rounded-xl border bg-white cursor-pointer flex flex-wrap items-center justify-between gap-2 ${
                            sq.isSelected
                              ? 'border-emerald-500 ring-1 ring-emerald-300'
                              : 'border-slate-200'
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-900">
                                {sq.vendorName}
                              </span>
                              {sq.isSelected && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                                  Selected Vendor
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Lead Time: {sq.leadTime} {sq.notes ? `• ${sq.notes}` : ''}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-bold text-slate-800">
                              {sq.currency} {Number(sq.quotedTotalForeign).toLocaleString()}
                            </div>
                            <div className="text-[11px] font-semibold text-emerald-700">
                              ≈ {formatCompactSAR(convertedSAR)} (@ {sq.fxRate})
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add Vendor Quote Mini Form */}
                <form
                  onSubmit={handleAddSupplierQuote}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-2 border-t border-amber-200/70"
                >
                  <input
                    type="text"
                    placeholder="Supplier / Distributor Name"
                    value={newVendorName}
                    onChange={(e) => setNewVendorName(e.target.value)}
                    className="sm:col-span-4 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                  />
                  <select
                    value={newVendorCurr}
                    onChange={(e) => setNewVendorCurr(e.target.value)}
                    className="sm:col-span-2 border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white font-bold"
                  >
                    {Object.keys(fxRates).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder="Quote Total"
                    value={newVendorAmount}
                    onChange={(e) => setNewVendorAmount(e.target.value)}
                    className="sm:col-span-2 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                  />
                  <input
                    type="text"
                    placeholder="Lead time"
                    value={newVendorLead}
                    onChange={(e) => setNewVendorLead(e.target.value)}
                    className="sm:col-span-2 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                  />
                  <button
                    type="submit"
                    className="sm:col-span-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg py-1.5 px-2"
                  >
                    + Add RFQ
                  </button>
                </form>
              </div>
            </>
          )}

          {/* ================================================================= */}
          {/* TAB 2: COORDINATOR FOLLOW-UP HISTORY & LOGGER                     */}
          {/* ================================================================= */}
          {activeTab === 'FOLLOWUPS' && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!fuOutcome.trim()) return;
                  onLogFollowUp(inquiry.id, {
                    channel: fuChannel,
                    outcome: fuOutcome,
                    nextActionDate: fuNextDate
                  });
                  setFuOutcome('');
                }}
                className="bg-cyan-50/50 p-4 rounded-xl border border-cyan-200 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-900">
                    Log Phone / WhatsApp / Email Follow-Up
                  </h4>
                  <span className="text-[11px] text-cyan-700 font-semibold">
                    {inquiry.contactPerson} • {inquiry.contactPhone}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {['Phone', 'WhatsApp', 'Email'].map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setFuChannel(ch)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                        fuChannel === ch
                          ? 'bg-cyan-700 text-white border-cyan-700'
                          : 'bg-white text-slate-700 border-slate-200'
                      }`}
                    >
                      {ch}
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5 ml-auto">
                    <span className="text-xs text-slate-600 font-medium">Next Reminder:</span>
                    <input
                      type="date"
                      value={fuNextDate}
                      onChange={(e) => setFuNextDate(e.target.value)}
                      className="text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white"
                    />
                  </div>
                </div>

                <textarea
                  required
                  rows={2}
                  value={fuOutcome}
                  onChange={(e) => setFuOutcome(e.target.value)}
                  placeholder="Record customer feedback, PO approval status, or requested revisions..."
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-sm bg-white"
                />

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-xl shadow-2xs"
                  >
                    Save Follow-Up Note
                  </button>
                </div>
              </form>

              <div className="space-y-2.5">
                {inquiry.followUps.length === 0 ? (
                  <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
                    No follow-ups logged yet.
                  </div>
                ) : (
                  inquiry.followUps.map((fu) => {
                    const logger = getMember(fu.loggedBy);
                    return (
                      <div
                        key={fu.id}
                        className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-cyan-100 text-cyan-800">
                              {fu.channel}
                            </span>
                            <span className="text-xs font-bold text-slate-800">
                              {logger.name} ({logger.role})
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400">
                            {formatRelativeTime(fu.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700">{fu.outcome}</p>
                        {fu.nextActionDate && (
                          <div className="text-[11px] text-amber-700 font-semibold pt-1">
                            Next follow-up scheduled: {fu.nextActionDate}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* ================================================================= */}
          {/* TAB 3: 1-CLICK CUSTOMER QUOTATION PREVIEW (SAR + 15% KSA VAT)     */}
          {/* ================================================================= */}
          {activeTab === 'QUOTE_PREVIEW' && (
            <div className="space-y-4">
              {!isApproved && (
                <div className="p-3 rounded-xl bg-purple-50 border border-purple-200 text-xs text-purple-900 flex items-center justify-between gap-2">
                  <span>
                    <strong>Note:</strong> Sales Manager approval is still marked{' '}
                    <strong>Pending</strong>. Confirm verbal/system approval before sending to the customer.
                  </span>
                  <button
                    onClick={() => onApprovalToggle(inquiry.id, 'APPROVED')}
                    className="px-3 py-1 bg-purple-600 text-white font-bold rounded-lg whitespace-nowrap"
                  >
                    Approve Now
                  </button>
                </div>
              )}

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700">
                    Formatted Commercial Offer (Ready for Email or WhatsApp Business)
                  </span>
                  <button
                    onClick={handleCopyQuoteText}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                  >
                    {quoteCopied ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {quoteCopied ? 'Copied Quotation!' : 'Copy SAR Quotation'}
                  </button>
                </div>
                <pre className="bg-white border border-slate-200 rounded-xl p-4 text-xs font-mono text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {formattedCustomerQuoteText}
                </pre>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 4: FULL ROLE HANDOVER AUDIT TIMELINE                          */}
          {/* ================================================================= */}
          {activeTab === 'TIMELINE' && (
            <div className="relative pl-5 border-l-2 border-slate-200 space-y-3.5">
              {[...inquiry.timeline].reverse().map((ev, idx) => {
                const actor = getMember(ev.by);
                const stg = STAGES.find((s) => s.id === ev.stage);
                return (
                  <div key={idx} className="relative">
                    <span className="w-3 h-3 rounded-full bg-emerald-600 ring-4 ring-white absolute -left-[27px] top-1" />
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-bold text-slate-900">
                          {stg?.title || ev.stage}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {formatRelativeTime(ev.at)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 mb-1">{ev.note}</p>
                      <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                        {actor.name} ({actor.role})
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}