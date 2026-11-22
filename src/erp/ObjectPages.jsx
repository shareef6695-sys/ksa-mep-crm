import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Printer,
  CreditCard,
  Truck,
  FileText,
  Receipt,
  ShoppingBag,
  PackageCheck,
  Banknote,
  BookOpen,
  Percent,
  Building2,
  CheckCircle2,
  Circle,
  RotateCcw,
} from 'lucide-react';
import { formatSAR } from './erpEngine';

/* ================================================================== */
/* Labels (EN / AR)                                                    */
/* ================================================================== */
const LABELS = {
  en: {
    back: 'Back',
    home: 'Home',
    sales: 'Sales',
    purchasing: 'Purchasing',
    invoice: 'ZATCA Invoice',
    salesOrder: 'Sales Order',
    purchaseOrder: 'Purchase Order',
    // tabs
    items: 'Items',
    payments: 'Payments',
    accounting: 'Accounting',
    profitShare: 'Profit Share',
    docFlow: 'Document Flow',
    deliveries: 'Deliveries',
    invoices: 'Invoices',
    purchasingTab: 'Purchasing',
    profitability: 'Profitability',
    costing: 'Costing',
    supplier: 'Supplier',
    // facets
    grandTotal: 'Grand Total',
    paid: 'Paid',
    openBalance: 'Open Balance',
    grossMargin: 'Gross Margin',
    age: 'Age',
    days: 'days',
    orderValue: 'Order Value',
    deliveredPct: 'Delivered',
    invoiced: 'Invoiced',
    collected: 'Collected',
    estMargin: 'Est. Margin',
    total: 'Total',
    totalSar: 'Total (SAR)',
    paidSar: 'Paid (SAR)',
    openSar: 'Open (SAR)',
    status: 'Status',
    // actions
    recordPayment: 'Record Payment',
    printZatca: 'Print / ZATCA Preview',
    print: 'Print',
    deliver: 'Record Delivery',
    paySupplier: 'Pay Supplier',
    // columns
    description: 'Description',
    qty: 'Qty',
    unit: 'Unit',
    unitPrice: 'Unit Price (SAR)',
    lineTotal: 'Line Total (SAR)',
    cost: 'Cost (SAR)',
    margin: 'Margin',
    ordered: 'Ordered',
    delivered: 'Delivered',
    remaining: 'Remaining',
    progress: 'Progress',
    date: 'Date',
    document: 'Document',
    method: 'Method',
    reference: 'Reference',
    amount: 'Amount (SAR)',
    balance: 'Balance (SAR)',
    debit: 'Debit (SAR)',
    credit: 'Credit (SAR)',
    account: 'Account',
    memo: 'Memo',
    postedBy: 'Posted by',
    unitCostFx: 'Unit Cost',
    lineFx: 'Line Total',
    lineSar: 'Line (SAR)',
    stocked: 'Stocked',
    yes: 'Yes',
    no: 'No',
    fxRate: 'FX Rate',
    fxVariance: 'FX Variance (SAR)',
    amountFx: 'Amount',
    // misc
    invoiceIssued: 'Invoice issued',
    creditNote: 'Credit Note',
    customerReceipt: 'Customer Receipt',
    totals: 'Totals',
    noItems: 'No line items on this document.',
    noPayments: 'No payments or credit notes recorded yet.',
    noJournals: 'No General Ledger journals are linked to this document yet.',
    noCommission: 'No sales profit share is linked to this invoice.',
    noDeliveries: 'No deliveries recorded yet.',
    noInvoices: 'No invoices issued yet.',
    noPOs: 'No purchase orders are linked to this sales order.',
    noSupplier: 'Supplier is not in the vendor master. Showing details from the purchase order.',
    salesman: 'Salesman',
    rate: 'Rate',
    netProfit: 'Deal Net Profit',
    eligible: 'Total Eligible Share',
    unlocked: 'Unlocked (Collected)',
    paidOut: 'Paid Out',
    revenue: 'Revenue (net of VAT)',
    itemCost: 'Item Cost (quoted)',
    poLanded: 'PO Landed Cost (actual)',
    estMarginSar: 'Estimated Margin',
    actualMarginSar: 'Margin vs PO Cost',
    postedRevenue: 'Revenue posted to GL',
    subtotal: 'Subtotal',
    vat: 'VAT 15%',
    goodsSar: 'Goods (SAR)',
    landedCost: 'Freight / Customs (Landed)',
    supplierVat: 'Supplier VAT',
    totalPayable: 'Total Payable (SAR)',
    goodsFx: 'Goods',
    stageIssued: 'Issued',
    stageGrn: 'Goods Received',
    stageBilled: 'Billed',
    stagePaid: 'Paid',
    inquiry: 'Inquiry / Quote',
    deliveryNote: 'Delivery Note',
    grn: 'Goods Receipt',
    bill: 'Supplier Bill',
    supplierPayment: 'Supplier Payment',
    current: 'Current',
    pending: 'Pending',
    division: 'Division',
    vatNo: 'VAT',
    soRef: 'SO',
    client: 'Customer',
    contact: 'Contact',
    phone: 'Phone',
    email: 'Email',
    vendorCode: 'Vendor Code',
    nameEn: 'Name (EN)',
    nameAr: 'Name (AR)',
    origin: 'Origin',
    cr: 'CR Number',
    country: 'Country',
    city: 'City',
    address: 'Address',
    currency: 'Default Currency',
    terms: 'Payment Terms',
    iban: 'IBAN',
    statusLabels: {
      paid: 'Paid',
      partial: 'Partially Paid',
      unpaid: 'Unpaid',
      overdue: 'Overdue',
      cleared: 'ZATCA Cleared',
      phase1_qr_ready: 'ZATCA QR Ready',
      open: 'Open',
      partially_delivered: 'Partially Delivered',
      delivered: 'Delivered',
      po_issued: 'PO Issued',
      grn_completed: 'Goods Received',
      billed: 'Billed',
      unbilled: 'Not Billed',
      posted: 'Bill Posted',
      awaiting_collection: 'Awaiting Collection',
      partially_unlocked: 'Partially Unlocked',
      ready_for_payout: 'Ready for Payout',
      standard: 'Standard (B2B)',
      simplified: 'Simplified (B2C)',
    },
  },
  ar: {
    back: 'رجوع',
    home: 'الرئيسية',
    sales: 'المبيعات',
    purchasing: 'المشتريات',
    invoice: 'فاتورة ضريبية',
    salesOrder: 'أمر بيع',
    purchaseOrder: 'أمر شراء',
    items: 'البنود',
    payments: 'المدفوعات',
    accounting: 'المحاسبة',
    profitShare: 'حصة الأرباح',
    docFlow: 'تسلسل المستندات',
    deliveries: 'التسليمات',
    invoices: 'الفواتير',
    purchasingTab: 'المشتريات',
    profitability: 'الربحية',
    costing: 'التكاليف',
    supplier: 'المورد',
    grandTotal: 'الإجمالي',
    paid: 'المدفوع',
    openBalance: 'الرصيد المستحق',
    grossMargin: 'هامش الربح',
    age: 'العمر',
    days: 'يوم',
    orderValue: 'قيمة الأمر',
    deliveredPct: 'المُسلّم',
    invoiced: 'المفوتر',
    collected: 'المحصّل',
    estMargin: 'الهامش التقديري',
    total: 'الإجمالي',
    totalSar: 'الإجمالي (ريال)',
    paidSar: 'المدفوع (ريال)',
    openSar: 'المستحق (ريال)',
    status: 'الحالة',
    recordPayment: 'تسجيل دفعة',
    printZatca: 'طباعة / معاينة الفاتورة',
    print: 'طباعة',
    deliver: 'تسجيل تسليم',
    paySupplier: 'سداد المورد',
    description: 'الوصف',
    qty: 'الكمية',
    unit: 'الوحدة',
    unitPrice: 'سعر الوحدة (ريال)',
    lineTotal: 'إجمالي البند (ريال)',
    cost: 'التكلفة (ريال)',
    margin: 'الهامش',
    ordered: 'المطلوب',
    delivered: 'المُسلّم',
    remaining: 'المتبقي',
    progress: 'التقدم',
    date: 'التاريخ',
    document: 'المستند',
    method: 'طريقة الدفع',
    reference: 'المرجع',
    amount: 'المبلغ (ريال)',
    balance: 'الرصيد (ريال)',
    debit: 'مدين (ريال)',
    credit: 'دائن (ريال)',
    account: 'الحساب',
    memo: 'البيان',
    postedBy: 'بواسطة',
    unitCostFx: 'تكلفة الوحدة',
    lineFx: 'إجمالي البند',
    lineSar: 'البند (ريال)',
    stocked: 'مخزني',
    yes: 'نعم',
    no: 'لا',
    fxRate: 'سعر الصرف',
    fxVariance: 'فرق الصرف (ريال)',
    amountFx: 'المبلغ',
    invoiceIssued: 'إصدار الفاتورة',
    creditNote: 'إشعار دائن',
    customerReceipt: 'سند قبض',
    totals: 'الإجماليات',
    noItems: 'لا توجد بنود في هذا المستند.',
    noPayments: 'لم تُسجّل مدفوعات أو إشعارات دائنة بعد.',
    noJournals: 'لا توجد قيود يومية مرتبطة بهذا المستند بعد.',
    noCommission: 'لا توجد حصة أرباح مرتبطة بهذه الفاتورة.',
    noDeliveries: 'لم تُسجّل تسليمات بعد.',
    noInvoices: 'لم تصدر فواتير بعد.',
    noPOs: 'لا توجد أوامر شراء مرتبطة بأمر البيع هذا.',
    noSupplier: 'المورد غير مسجل في بيانات الموردين. تُعرض البيانات من أمر الشراء.',
    salesman: 'مندوب المبيعات',
    rate: 'النسبة',
    netProfit: 'صافي ربح الصفقة',
    eligible: 'إجمالي الحصة المستحقة',
    unlocked: 'المُفعّل (المحصّل)',
    paidOut: 'المصروف',
    revenue: 'الإيراد (بدون الضريبة)',
    itemCost: 'تكلفة البنود (المسعّرة)',
    poLanded: 'تكلفة أوامر الشراء (الفعلية)',
    estMarginSar: 'الهامش التقديري',
    actualMarginSar: 'الهامش مقابل تكلفة الشراء',
    postedRevenue: 'الإيراد المرحّل للأستاذ العام',
    subtotal: 'المجموع الفرعي',
    vat: 'ضريبة القيمة المضافة 15%',
    goodsSar: 'البضاعة (ريال)',
    landedCost: 'الشحن / الجمارك',
    supplierVat: 'ضريبة المورد',
    totalPayable: 'إجمالي المستحق (ريال)',
    goodsFx: 'البضاعة',
    stageIssued: 'صادر',
    stageGrn: 'تم الاستلام',
    stageBilled: 'مفوتر',
    stagePaid: 'مدفوع',
    inquiry: 'طلب / عرض سعر',
    deliveryNote: 'مذكرة تسليم',
    grn: 'استلام البضاعة',
    bill: 'فاتورة المورد',
    supplierPayment: 'سند صرف للمورد',
    current: 'الحالي',
    pending: 'قيد الانتظار',
    division: 'القسم',
    vatNo: 'الرقم الضريبي',
    soRef: 'أمر البيع',
    client: 'العميل',
    contact: 'جهة الاتصال',
    phone: 'الهاتف',
    email: 'البريد الإلكتروني',
    vendorCode: 'رمز المورد',
    nameEn: 'الاسم (إنجليزي)',
    nameAr: 'الاسم (عربي)',
    origin: 'المنشأ',
    cr: 'السجل التجاري',
    country: 'الدولة',
    city: 'المدينة',
    address: 'العنوان',
    currency: 'العملة الافتراضية',
    terms: 'شروط الدفع',
    iban: 'الآيبان',
    statusLabels: {
      paid: 'مدفوعة',
      partial: 'مدفوعة جزئياً',
      unpaid: 'غير مدفوعة',
      overdue: 'متأخرة',
      cleared: 'معتمدة من الزكاة',
      phase1_qr_ready: 'رمز QR جاهز',
      open: 'مفتوح',
      partially_delivered: 'مُسلّم جزئياً',
      delivered: 'مُسلّم',
      po_issued: 'أمر شراء صادر',
      grn_completed: 'تم الاستلام',
      billed: 'مفوتر',
      unbilled: 'غير مفوتر',
      posted: 'فاتورة مرحّلة',
      awaiting_collection: 'بانتظار التحصيل',
      partially_unlocked: 'مفعّلة جزئياً',
      ready_for_payout: 'جاهزة للصرف',
      standard: 'قياسية (B2B)',
      simplified: 'مبسطة (B2C)',
    },
  },
};
const tr = (lang) => LABELS[lang] || LABELS.en;

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const sar = (v) => formatSAR(num(v));
const pct = (v) => `${num(v).toFixed(1)}%`;
const itemDesc = (it) => it?.desc || it?.description || it?.name || '—';
const itemQty = (it) => num(it?.qty ?? it?.orderedQty);
const itemUnit = (it) => it?.unit || it?.uom || '';

const fmtDate = (v, lang) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
};
const daysSince = (v) => {
  if (!v) return 0;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
};
const dateKey = (v) => {
  const d = new Date(v || 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

const statusText = (t, s) => (s ? t.statusLabels[s] || String(s).replace(/_/g, ' ') : '—');

// Journals whose source document (or reference) is one of the given numbers
const relatedJournals = (glEntries, docNumbers) => {
  const set = new Set(arr(docNumbers).filter(Boolean).map(String));
  if (set.size === 0) return [];
  return arr(glEntries)
    .filter((e) => e && e.status !== 'void' && (set.has(String(e.source_doc_number || '')) || set.has(String(e.reference || ''))))
    .sort((a, b) => dateKey(a.entry_date || a.created_at) - dateKey(b.entry_date || b.created_at));
};

/* ================================================================== */
/* Building blocks                                                     */
/* ================================================================== */
const STATE_CLS = {
  positive: { text: 'text-emerald-700', dot: 'bg-emerald-600' },
  critical: { text: 'text-amber-700', dot: 'bg-amber-500' },
  negative: { text: 'text-rose-700', dot: 'bg-rose-600' },
  information: { text: 'text-blue-700', dot: 'bg-blue-600' },
  neutral: { text: 'text-slate-600', dot: 'bg-slate-400' },
};

export function ObjectStatus({ state = 'neutral', children }) {
  const cls = STATE_CLS[state] || STATE_CLS.neutral;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${cls.text}`}>
      <span className={`w-2 h-2 rounded-full ${cls.dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}

function Facet({ label, value, sub, state }) {
  const cls = state ? STATE_CLS[state]?.text : 'text-slate-900';
  return (
    <div className="min-w-[120px] flex-1 sm:flex-none">
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className={`text-base sm:text-lg font-bold font-mono ${cls}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function ActionButton({ onClick, icon: Icon, children, primary = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`no-print px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
        primary ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'border border-slate-300 bg-white hover:bg-slate-50 text-slate-800'
      }`}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
}

function ObjectPageLayout({ lang, breadcrumb, title, subtitle, statuses, facets, actions, tabs, onBack }) {
  const t = tr(lang);
  const visibleTabs = tabs.filter(Boolean);
  const [active, setActive] = useState(visibleTabs[0]?.id);
  const current = visibleTabs.find((tb) => tb.id === active) || visibleTabs[0];

  return (
    <div className="space-y-4">
      {/* Header (sticky below the app shell: parent may set --shell-height) */}
      <div className="sticky z-10 bg-white border border-slate-200 rounded-2xl shadow-sm" style={{ top: 'var(--shell-height, 0px)' }}>
        <div className="p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="no-print inline-flex items-center gap-0.5 px-2 py-1 rounded-lg hover:bg-slate-100 text-blue-700 font-semibold cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180" /> {t.back}
              </button>
            )}
            <span className="truncate">{breadcrumb.join(' / ')}</span>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 font-mono break-all">{title || '—'}</h1>
              {subtitle && <div className="text-sm text-slate-600 font-semibold">{subtitle}</div>}
              {statuses?.length > 0 && <div className="flex flex-wrap items-center gap-3 mt-1.5">{statuses}</div>}
            </div>
            {actions?.length > 0 && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>

          {facets?.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-3 pt-3 border-t border-slate-100">{facets}</div>
          )}
        </div>

        {/* Tab / anchor bar */}
        <div className="no-print flex overflow-x-auto border-t border-slate-100 px-2" role="tablist">
          {visibleTabs.map((tb) => {
            const isActive = tb.id === current?.id;
            return (
              <button
                key={tb.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(tb.id)}
                className={`shrink-0 px-3.5 py-2.5 text-xs font-semibold border-b-2 cursor-pointer whitespace-nowrap ${
                  isActive ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {tb.label}
                {typeof tb.count === 'number' && (
                  <span className={`ms-1.5 px-1.5 rounded-full text-[10px] ${isActive ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                    {tb.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section role="tabpanel" className="space-y-4">
        {current?.content}
      </section>
    </div>
  );
}

function Section({ title, icon: Icon, children, right }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {(title || right) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4 text-blue-600" />}
            {title}
          </h2>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

const Empty = ({ children }) => <div className="p-8 text-center text-xs text-slate-500">{children}</div>;

const thCls = 'p-3 text-start font-semibold whitespace-nowrap';
const thNum = 'p-3 text-end font-semibold whitespace-nowrap';
const tdCls = 'p-3 text-slate-800';
const tdNum = 'p-3 text-end font-mono whitespace-nowrap';

function Table({ head, children, foot }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">{head}</thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
        {foot && <tfoot className="bg-slate-50 font-bold border-t border-slate-200">{foot}</tfoot>}
      </table>
    </div>
  );
}

function KeyValueGrid({ rows }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 p-4">
      {rows
        .filter((r) => r && r[1] !== undefined)
        .map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] font-semibold text-slate-500">{k}</dt>
            <dd className="text-xs font-semibold text-slate-900 break-words">{v === null || v === '' || v === undefined ? '—' : v}</dd>
          </div>
        ))}
    </dl>
  );
}

function ProgressBar({ value }) {
  const v = Math.max(0, Math.min(100, num(value)));
  const color = v >= 99.9 ? 'bg-emerald-600' : v > 0 ? 'bg-amber-500' : 'bg-slate-300';
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-[11px] font-mono text-slate-600 w-10 text-end">{v.toFixed(0)}%</span>
    </div>
  );
}

function JournalList({ lang, journals }) {
  const t = tr(lang);
  if (journals.length === 0) return <Section title={t.accounting} icon={BookOpen}><Empty>{t.noJournals}</Empty></Section>;
  return (
    <div className="space-y-3">
      {journals.map((jv) => {
        const lines = arr(jv.lines);
        const dr = lines.reduce((s, l) => s + num(l.debit), 0);
        const cr = lines.reduce((s, l) => s + num(l.credit), 0);
        return (
          <Section
            key={jv.id || jv.voucher_number}
            icon={BookOpen}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-blue-700">{jv.voucher_number || '—'}</span>
                <span className="text-slate-500 font-semibold">{fmtDate(jv.entry_date, lang)}</span>
                {jv.source_module && <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] text-slate-600">{jv.source_module}</span>}
              </span>
            }
            right={<span className="text-[11px] text-slate-500">{`${t.postedBy}: ${jv.posted_by || '—'}`}</span>}
          >
            {jv.description && <div className="px-4 pt-3 text-xs text-slate-600">{jv.description}</div>}
            <Table
              head={
                <tr>
                  <th className={thCls}>{t.account}</th>
                  <th className={thCls}>{t.memo}</th>
                  <th className={thNum}>{t.debit}</th>
                  <th className={thNum}>{t.credit}</th>
                </tr>
              }
              foot={
                <tr>
                  <td className="p-3" colSpan={2}>{t.totals}</td>
                  <td className={tdNum}>{sar(dr)}</td>
                  <td className={tdNum}>{sar(cr)}</td>
                </tr>
              }
            >
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className={`${tdCls} font-semibold`}>{l.account_name || l.account_code}</td>
                  <td className="p-3 text-slate-500">{l.memo || '—'}</td>
                  <td className={tdNum}>{num(l.debit) > 0 ? sar(l.debit) : '—'}</td>
                  <td className={tdNum}>{num(l.credit) > 0 ? sar(l.credit) : '—'}</td>
                </tr>
              ))}
            </Table>
          </Section>
        );
      })}
    </div>
  );
}

// Horizontal document flow: [{ key, label, number, sub, state, icon, onClick, current }]
function DocumentFlow({ lang, nodes }) {
  const t = tr(lang);
  return (
    <Section title={t.docFlow} icon={FileText}>
      <div className="flex flex-wrap items-stretch gap-2 p-4">
        {nodes.map((n, idx) => {
          const Icon = n.icon || FileText;
          const clickable = typeof n.onClick === 'function';
          const card = (
            <div
              className={`h-full w-44 rounded-xl border p-3 text-start ${
                n.current ? 'border-blue-500 bg-blue-50' : n.pending ? 'border-dashed border-slate-300 bg-slate-50' : 'border-slate-200 bg-white'
              } ${clickable ? 'hover:border-blue-400 cursor-pointer' : ''}`}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <Icon className="w-3.5 h-3.5" /> {n.label}
              </div>
              <div className={`mt-1 text-xs font-bold font-mono break-all ${n.pending ? 'text-slate-400' : 'text-slate-900'}`}>
                {n.number || (n.pending ? t.pending : '—')}
              </div>
              {n.sub && <div className="text-[11px] text-slate-500 mt-0.5">{n.sub}</div>}
              {n.status && <div className="mt-1"><ObjectStatus state={n.state || 'neutral'}>{n.status}</ObjectStatus></div>}
            </div>
          );
          return (
            <React.Fragment key={n.key || idx}>
              {idx > 0 && (
                <div className="flex items-center text-slate-300" aria-hidden="true">
                  <ChevronRight className="w-4 h-4 rtl:rotate-180" />
                </div>
              )}
              {clickable ? (
                <button type="button" onClick={n.onClick} className="p-0 bg-transparent border-0">
                  {card}
                </button>
              ) : (
                card
              )}
            </React.Fragment>
          );
        })}
      </div>
    </Section>
  );
}

/* ================================================================== */
/* 1. INVOICE OBJECT PAGE                                              */
/* ================================================================== */
export function InvoiceObjectPage({
  lang = 'en',
  invoice,
  company,
  receipts,
  creditNotes,
  glEntries,
  commissions,
  salesOrders,
  deliveryNotes,
  onBack,
  onRecordPayment,
  onPrint,
  onOpenSalesOrder,
}) {
  const t = tr(lang);
  const inv = invoice || {};

  const model = useMemo(() => {
    const items = arr(inv.items);
    const invReceipts = arr(receipts).filter((r) => r && r.invoice_id === inv.id);
    const invCNs = arr(creditNotes).filter((c) => c && c.original_invoice_id === inv.id);
    const grand = num(inv.grand_total_sar);
    const paid = num(inv.paid_amount_sar);
    const open = Math.max(0, grand - paid);
    const subtotal = num(inv.subtotal_sar);
    const cost = num(inv.landed_cost_sar) || items.reduce((s, it) => s + itemQty(it) * num(it.unitCostSar), 0);
    const marginPct = subtotal > 0 ? ((subtotal - cost) / subtotal) * 100 : 0;
    const age = daysSince(inv.issued_at || inv.created_at);

    // credit notes reduce grand_total_sar on the invoice, so the original gross = current + credit notes
    const cnTotal = invCNs.reduce((s, c) => s + num(c.grand_total_sar), 0);
    const events = [
      ...invCNs.map((c) => ({ type: 'cn', date: c.issued_at, number: c.credit_note_number, detail: c.reason, amount: num(c.grand_total_sar) })),
      ...invReceipts.map((r) => ({
        type: 'rcp',
        date: r.received_at || r.created_at,
        number: r.receipt_number,
        detail: [r.payment_method, r.reference_no].filter(Boolean).join(' • '),
        amount: num(r.amount_sar),
      })),
    ].sort((a, b) => dateKey(a.date) - dateKey(b.date));
    let running = grand + cnTotal;
    const ledger = [{ type: 'inv', date: inv.issued_at, number: inv.invoice_number, detail: '', amount: grand + cnTotal, balance: running }];
    events.forEach((e) => {
      running -= e.amount;
      ledger.push({ ...e, balance: running });
    });

    const journals = relatedJournals(glEntries, [
      inv.invoice_number,
      ...invReceipts.map((r) => r.receipt_number),
      ...invCNs.map((c) => c.credit_note_number),
    ]);
    const commission = arr(commissions).find((c) => c && c.invoice_id === inv.id) || null;
    const so = arr(salesOrders).find((s) => s && (s.id === inv.so_id || (inv.so_number && s.so_number === inv.so_number))) || null;
    const dn = arr(deliveryNotes).find((d) => d && d.id === inv.dn_id) || null;
    return { items, invReceipts, invCNs, grand, paid, open, subtotal, cost, marginPct, age, ledger, journals, commission, so, dn };
  }, [inv, receipts, creditNotes, glEntries, commissions, salesOrders, deliveryNotes]);

  const payState =
    inv.payment_status === 'paid' ? 'positive' : inv.payment_status === 'partial' ? 'critical' : model.age > 30 ? 'negative' : 'information';
  const payLabel = inv.payment_status !== 'paid' && model.age > 30 ? `${statusText(t, inv.payment_status)} • ${t.statusLabels.overdue}` : statusText(t, inv.payment_status);

  const itemsTab = (
    <Section
      title={t.items}
      icon={FileText}
      right={company?.nameEn ? <span className="text-[11px] text-slate-500">{`${company.nameEn}${company.vatNumber ? ` • ${t.vatNo}: ${company.vatNumber}` : ''}`}</span> : null}
    >
      {model.items.length === 0 ? (
        <Empty>{t.noItems}</Empty>
      ) : (
        <Table
          head={
            <tr>
              <th className={thCls}>{t.description}</th>
              <th className={thNum}>{t.qty}</th>
              <th className={thNum}>{t.unitPrice}</th>
              <th className={thNum}>{t.lineTotal}</th>
              <th className={thNum}>{t.cost}</th>
              <th className={thNum}>{t.margin}</th>
            </tr>
          }
          foot={
            <>
              <tr>
                <td className="p-3" colSpan={3}>{t.subtotal}</td>
                <td className={tdNum}>{sar(model.subtotal)}</td>
                <td className={tdNum}>{sar(model.cost)}</td>
                <td className={tdNum}>{pct(model.marginPct)}</td>
              </tr>
              <tr>
                <td className="p-3" colSpan={3}>{t.vat}</td>
                <td className={tdNum}>{sar(inv.vat_sar)}</td>
                <td colSpan={2} />
              </tr>
              <tr>
                <td className="p-3" colSpan={3}>{t.grandTotal}</td>
                <td className={tdNum}>{sar(model.grand)}</td>
                <td colSpan={2} />
              </tr>
            </>
          }
        >
          {model.items.map((it, i) => {
            const q = itemQty(it);
            const line = q * num(it.unitSellSar);
            const cost = q * num(it.unitCostSar);
            const m = line > 0 ? ((line - cost) / line) * 100 : 0;
            return (
              <tr key={it.id || i}>
                <td className={tdCls}>
                  <div className="font-semibold">{itemDesc(it)}</div>
                  {itemUnit(it) && <div className="text-[11px] text-slate-500">{itemUnit(it)}</div>}
                </td>
                <td className={tdNum}>{q}</td>
                <td className={tdNum}>{sar(it.unitSellSar)}</td>
                <td className={`${tdNum} font-bold`}>{sar(line)}</td>
                <td className={tdNum}>{sar(cost)}</td>
                <td className={`${tdNum} ${m < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{pct(m)}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </Section>
  );

  const paymentsTab = (
    <Section title={t.payments} icon={CreditCard}>
      {model.ledger.length <= 1 ? (
        <Empty>{t.noPayments}</Empty>
      ) : (
        <Table
          head={
            <tr>
              <th className={thCls}>{t.date}</th>
              <th className={thCls}>{t.document}</th>
              <th className={thCls}>{t.reference}</th>
              <th className={thNum}>{t.amount}</th>
              <th className={thNum}>{t.balance}</th>
            </tr>
          }
        >
          {model.ledger.map((e, i) => (
            <tr key={`${e.type}-${e.number || i}`}>
              <td className="p-3 text-slate-600 whitespace-nowrap">{fmtDate(e.date, lang)}</td>
              <td className={tdCls}>
                <div className="font-semibold font-mono">{e.number || '—'}</div>
                <div className="text-[11px] text-slate-500">
                  {e.type === 'inv' ? t.invoiceIssued : e.type === 'cn' ? t.creditNote : t.customerReceipt}
                </div>
              </td>
              <td className="p-3 text-slate-500">{e.detail || '—'}</td>
              <td className={`${tdNum} ${e.type === 'inv' ? '' : 'text-emerald-700'}`}>{e.type === 'inv' ? sar(e.amount) : `− ${sar(e.amount)}`}</td>
              <td className={`${tdNum} font-bold`}>{sar(e.balance)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );

  const c = model.commission;
  const profitTab = (
    <Section title={t.profitShare} icon={Percent}>
      {!c ? (
        <Empty>{t.noCommission}</Empty>
      ) : (
        <>
          <div className="px-4 pt-3">
            <ObjectStatus state={c.status === 'ready_for_payout' ? 'positive' : c.status === 'partially_unlocked' ? 'critical' : 'information'}>
              {statusText(t, c.status)}
            </ObjectStatus>
          </div>
          <KeyValueGrid
            rows={[
              [t.salesman, c.salesman_name],
              [t.rate, pct(c.commission_pct)],
              [t.netProfit, `SAR ${sar(c.net_profit_sar)}`],
              [t.eligible, `SAR ${sar(c.total_eligible_commission_sar)}`],
              [t.unlocked, `SAR ${sar(c.unlocked_commission_sar)}`],
              [t.paidOut, `SAR ${sar(c.paid_out_sar)}`],
            ]}
          />
          <div className="px-4 pb-4">
            <ProgressBar value={num(c.total_eligible_commission_sar) > 0 ? (num(c.unlocked_commission_sar) / num(c.total_eligible_commission_sar)) * 100 : 0} />
          </div>
        </>
      )}
    </Section>
  );

  const so = model.so;
  const flowNodes = [
    {
      key: 'inq',
      label: t.inquiry,
      icon: FileText,
      number: so?.inquiry_id || '',
      pending: !so?.inquiry_id,
    },
    {
      key: 'so',
      label: t.salesOrder,
      icon: ShoppingBag,
      number: so?.so_number || inv.so_number || '',
      pending: !so && !inv.so_number,
      sub: so ? `SAR ${sar(so.grand_total_sar)}` : '',
      status: so ? statusText(t, so.status) : '',
      state: so?.status === 'delivered' ? 'positive' : so ? 'critical' : 'neutral',
      onClick: so && onOpenSalesOrder ? () => onOpenSalesOrder(so) : undefined,
    },
    {
      key: 'dn',
      label: t.deliveryNote,
      icon: Truck,
      number: model.dn?.dn_number || '',
      pending: !model.dn,
      sub: model.dn ? fmtDate(model.dn.delivered_at, lang) : '',
    },
    {
      key: 'inv',
      label: t.invoice,
      icon: Receipt,
      number: inv.invoice_number,
      current: true,
      sub: `SAR ${sar(model.grand)}`,
      status: payLabel,
      state: payState,
    },
    ...model.invCNs.map((cn) => ({
      key: `cn-${cn.credit_note_number}`,
      label: t.creditNote,
      icon: RotateCcw,
      number: cn.credit_note_number,
      sub: `SAR ${sar(cn.grand_total_sar)}`,
    })),
    ...(model.invReceipts.length > 0
      ? model.invReceipts.map((r) => ({
          key: `rcp-${r.receipt_number}`,
          label: t.customerReceipt,
          icon: Banknote,
          number: r.receipt_number,
          sub: `SAR ${sar(r.amount_sar)} • ${fmtDate(r.received_at, lang)}`,
          state: 'positive',
        }))
      : [{ key: 'rcp-pending', label: t.customerReceipt, icon: Banknote, pending: true }]),
  ];

  const actions = [
    onRecordPayment && model.open > 0.009 && (
      <ActionButton key="pay" primary icon={CreditCard} onClick={() => onRecordPayment(inv)}>{t.recordPayment}</ActionButton>
    ),
    onPrint && <ActionButton key="print" icon={Printer} onClick={() => onPrint(inv)}>{t.printZatca}</ActionButton>,
  ].filter(Boolean);

  return (
    <ObjectPageLayout
      lang={lang}
      onBack={onBack}
      breadcrumb={[t.home, t.sales, t.invoice]}
      title={inv.invoice_number}
      subtitle={[inv.client_name, inv.client_vat ? `${t.vatNo}: ${inv.client_vat}` : ''].filter(Boolean).join(' • ')}
      statuses={[
        <ObjectStatus key="pay" state={payState}>{payLabel}</ObjectStatus>,
        <ObjectStatus key="zatca" state={inv.zatca_status === 'cleared' ? 'positive' : 'information'}>{statusText(t, inv.zatca_status)}</ObjectStatus>,
        inv.invoice_type && <ObjectStatus key="type" state="neutral">{statusText(t, inv.invoice_type)}</ObjectStatus>,
        inv.division && <ObjectStatus key="div" state="information">{`${t.division}: ${inv.division}`}</ObjectStatus>,
      ].filter(Boolean)}
      facets={[
        <Facet key="g" label={t.grandTotal} value={`SAR ${sar(model.grand)}`} sub={fmtDate(inv.issued_at, lang)} />,
        <Facet key="p" label={t.paid} value={`SAR ${sar(model.paid)}`} state="positive" />,
        <Facet key="o" label={t.openBalance} value={`SAR ${sar(model.open)}`} state={model.open > 0.009 ? (model.age > 30 ? 'negative' : 'critical') : 'positive'} />,
        <Facet key="m" label={t.grossMargin} value={pct(model.marginPct)} state={model.marginPct < 0 ? 'negative' : undefined} />,
        <Facet key="a" label={t.age} value={`${model.age} ${t.days}`} state={model.open > 0.009 && model.age > 30 ? 'negative' : undefined} />,
      ]}
      actions={actions}
      tabs={[
        { id: 'items', label: t.items, count: model.items.length, content: itemsTab },
        { id: 'payments', label: t.payments, count: model.invReceipts.length + model.invCNs.length, content: paymentsTab },
        { id: 'accounting', label: t.accounting, count: model.journals.length, content: <JournalList lang={lang} journals={model.journals} /> },
        { id: 'profit', label: t.profitShare, content: profitTab },
        { id: 'flow', label: t.docFlow, content: <DocumentFlow lang={lang} nodes={flowNodes} /> },
      ]}
    />
  );
}

/* ================================================================== */
/* 2. SALES ORDER OBJECT PAGE                                          */
/* ================================================================== */
export function SalesOrderObjectPage({
  lang = 'en',
  so,
  deliveryNotes,
  invoices,
  purchaseOrders,
  receipts,
  glEntries,
  onBack,
  onPrint,
  onDeliver,
  onOpenInvoice,
  onOpenPurchaseOrder,
}) {
  const t = tr(lang);
  const order = so || {};

  const model = useMemo(() => {
    const items = arr(order.items);
    const ordered = items.reduce((s, it) => s + num(it.orderedQty ?? it.qty), 0);
    const delivered = items.reduce((s, it) => s + num(it.deliveredQty), 0);
    const deliveredPct = ordered > 0 ? (delivered / ordered) * 100 : 0;
    const dns = arr(deliveryNotes)
      .filter((d) => d && (d.so_id === order.id || (order.so_number && d.so_number === order.so_number)))
      .sort((a, b) => dateKey(a.delivered_at) - dateKey(b.delivered_at));
    const invs = arr(invoices)
      .filter((i) => i && (i.so_id === order.id || (order.so_number && i.so_number === order.so_number)))
      .sort((a, b) => dateKey(a.issued_at) - dateKey(b.issued_at));
    const invIds = new Set(invs.map((i) => i.id));
    const pos = arr(purchaseOrders).filter((p) => p && (p.so_id === order.id || (order.so_number && p.so_number === order.so_number)));
    const invoiced = invs.reduce((s, i) => s + num(i.grand_total_sar), 0);
    const rcpts = arr(receipts).filter((r) => r && invIds.has(r.invoice_id));
    const collected = rcpts.length > 0 ? rcpts.reduce((s, r) => s + num(r.amount_sar), 0) : invs.reduce((s, i) => s + num(i.paid_amount_sar), 0);
    const revenue = num(order.subtotal_sar) || items.reduce((s, it) => s + num(it.orderedQty ?? it.qty) * num(it.unitSellSar), 0);
    const itemCost = num(order.total_cost_sar) || items.reduce((s, it) => s + num(it.orderedQty ?? it.qty) * num(it.unitCostSar), 0);
    const poCost = pos.reduce((s, p) => s + (num(p.total_landed_sar) || num(p.goods_total_sar) + num(p.landed_cost_sar)), 0);
    const estMargin = revenue - itemCost;
    const estMarginPct = revenue > 0 ? (estMargin / revenue) * 100 : 0;
    const actualMargin = revenue - poCost;
    const journals = relatedJournals(glEntries, invs.map((i) => i.invoice_number));
    const postedRevenue = journals.reduce(
      (s, j) => s + arr(j.lines).filter((l) => String(l.account_code || '').startsWith('40') && String(l.account_code) !== '4090').reduce((x, l) => x + num(l.credit) - num(l.debit), 0),
      0
    );
    const fullyDelivered = ordered > 0 && delivered >= ordered - 0.0001;
    return { items, ordered, delivered, deliveredPct, dns, invs, pos, invoiced, collected, revenue, itemCost, poCost, estMargin, estMarginPct, actualMargin, postedRevenue, fullyDelivered };
  }, [order, deliveryNotes, invoices, purchaseOrders, receipts, glEntries]);

  const soState = order.status === 'delivered' ? 'positive' : order.status === 'partially_delivered' ? 'critical' : 'information';

  const itemsTab = (
    <Section title={t.items} icon={FileText}>
      {model.items.length === 0 ? (
        <Empty>{t.noItems}</Empty>
      ) : (
        <Table
          head={
            <tr>
              <th className={thCls}>{t.description}</th>
              <th className={thNum}>{t.ordered}</th>
              <th className={thNum}>{t.delivered}</th>
              <th className={thNum}>{t.remaining}</th>
              <th className={thCls}>{t.progress}</th>
              <th className={thNum}>{t.unitPrice}</th>
              <th className={thNum}>{t.lineTotal}</th>
            </tr>
          }
          foot={
            <tr>
              <td className="p-3">{t.totals}</td>
              <td className={tdNum}>{model.ordered}</td>
              <td className={tdNum}>{model.delivered}</td>
              <td className={tdNum}>{Math.max(0, model.ordered - model.delivered)}</td>
              <td className="p-3"><ProgressBar value={model.deliveredPct} /></td>
              <td />
              <td className={tdNum}>{sar(model.revenue)}</td>
            </tr>
          }
        >
          {model.items.map((it, i) => {
            const o = num(it.orderedQty ?? it.qty);
            const d = num(it.deliveredQty);
            return (
              <tr key={it.id || i}>
                <td className={tdCls}>
                  <div className="font-semibold">{itemDesc(it)}</div>
                  {itemUnit(it) && <div className="text-[11px] text-slate-500">{itemUnit(it)}</div>}
                </td>
                <td className={tdNum}>{o}</td>
                <td className={tdNum}>{d}</td>
                <td className={tdNum}>{Math.max(0, o - d)}</td>
                <td className="p-3"><ProgressBar value={o > 0 ? (d / o) * 100 : 0} /></td>
                <td className={tdNum}>{sar(it.unitSellSar)}</td>
                <td className={`${tdNum} font-bold`}>{sar(o * num(it.unitSellSar))}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </Section>
  );

  const deliveriesTab = (
    <Section title={t.deliveries} icon={Truck}>
      {model.dns.length === 0 ? (
        <Empty>{t.noDeliveries}</Empty>
      ) : (
        <Table
          head={
            <tr>
              <th className={thCls}>{t.deliveryNote}</th>
              <th className={thCls}>{t.date}</th>
              <th className={thCls}>{t.status}</th>
              <th className={thCls}>{t.items}</th>
            </tr>
          }
        >
          {model.dns.map((dn) => (
            <tr key={dn.id || dn.dn_number}>
              <td className={`${tdCls} font-mono font-semibold`}>{dn.dn_number || '—'}</td>
              <td className="p-3 text-slate-600 whitespace-nowrap">{fmtDate(dn.delivered_at, lang)}</td>
              <td className="p-3">
                <ObjectStatus state={dn.delivery_type === 'full' ? 'positive' : 'critical'}>
                  {dn.delivery_type === 'full' ? t.statusLabels.delivered : t.statusLabels.partially_delivered}
                </ObjectStatus>
              </td>
              <td className="p-3 text-slate-600">
                {arr(dn.items).map((it) => `${itemDesc(it)} × ${itemQty(it)}`).join(', ') || '—'}
                {dn.notes && <div className="text-[11px] text-slate-500">{dn.notes}</div>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );

  const invoicesTab = (
    <Section title={t.invoices} icon={Receipt}>
      {model.invs.length === 0 ? (
        <Empty>{t.noInvoices}</Empty>
      ) : (
        <Table
          head={
            <tr>
              <th className={thCls}>{t.invoice}</th>
              <th className={thCls}>{t.date}</th>
              <th className={thCls}>{t.status}</th>
              <th className={thNum}>{t.grandTotal}</th>
              <th className={thNum}>{t.paid}</th>
            </tr>
          }
        >
          {model.invs.map((inv) => (
            <tr
              key={inv.id}
              onClick={onOpenInvoice ? () => onOpenInvoice(inv) : undefined}
              className={onOpenInvoice ? 'cursor-pointer hover:bg-slate-50' : ''}
            >
              <td className={`${tdCls} font-mono font-semibold text-blue-700`}>{inv.invoice_number}</td>
              <td className="p-3 text-slate-600 whitespace-nowrap">{fmtDate(inv.issued_at, lang)}</td>
              <td className="p-3">
                <ObjectStatus state={inv.payment_status === 'paid' ? 'positive' : inv.payment_status === 'partial' ? 'critical' : 'information'}>
                  {statusText(t, inv.payment_status)}
                </ObjectStatus>
              </td>
              <td className={tdNum}>{sar(inv.grand_total_sar)}</td>
              <td className={tdNum}>{sar(inv.paid_amount_sar)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );

  const purchasingTab = (
    <Section title={t.purchasingTab} icon={ShoppingBag}>
      {model.pos.length === 0 ? (
        <Empty>{t.noPOs}</Empty>
      ) : (
        <Table
          head={
            <tr>
              <th className={thCls}>{t.purchaseOrder}</th>
              <th className={thCls}>{t.supplier}</th>
              <th className={thCls}>{t.status}</th>
              <th className={thNum}>{t.poLanded}</th>
            </tr>
          }
        >
          {model.pos.map((po) => (
            <tr
              key={po.id}
              onClick={onOpenPurchaseOrder ? () => onOpenPurchaseOrder(po) : undefined}
              className={onOpenPurchaseOrder ? 'cursor-pointer hover:bg-slate-50' : ''}
            >
              <td className={`${tdCls} font-mono font-semibold text-blue-700`}>{po.po_number}</td>
              <td className={tdCls}>{po.supplier_name || '—'}</td>
              <td className="p-3">
                <ObjectStatus state={po.payment_status === 'paid' || po.status === 'paid' ? 'positive' : po.status === 'billed' ? 'critical' : 'information'}>
                  {statusText(t, po.payment_status === 'paid' ? 'paid' : po.status)}
                </ObjectStatus>
              </td>
              <td className={tdNum}>{sar(num(po.total_landed_sar) || num(po.goods_total_sar) + num(po.landed_cost_sar))}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );

  const profitTab = (
    <Section title={t.profitability} icon={Percent}>
      <KeyValueGrid
        rows={[
          [t.revenue, `SAR ${sar(model.revenue)}`],
          [t.itemCost, `SAR ${sar(model.itemCost)}`],
          [t.estMarginSar, `SAR ${sar(model.estMargin)} (${pct(model.estMarginPct)})`],
          [t.poLanded, model.pos.length > 0 ? `SAR ${sar(model.poCost)}` : '—'],
          [t.actualMarginSar, model.pos.length > 0 ? `SAR ${sar(model.actualMargin)} (${pct(model.revenue > 0 ? (model.actualMargin / model.revenue) * 100 : 0)})` : '—'],
          [t.postedRevenue, `SAR ${sar(model.postedRevenue)}`],
        ]}
      />
    </Section>
  );

  const flowNodes = [
    { key: 'inq', label: t.inquiry, icon: FileText, number: order.inquiry_id || '', pending: !order.inquiry_id },
    {
      key: 'so',
      label: t.salesOrder,
      icon: ShoppingBag,
      number: order.so_number,
      current: true,
      sub: `SAR ${sar(order.grand_total_sar)}`,
      status: statusText(t, order.status),
      state: soState,
    },
    ...model.pos.map((po) => ({
      key: `po-${po.id}`,
      label: t.purchaseOrder,
      icon: PackageCheck,
      number: po.po_number,
      sub: po.supplier_name,
      status: statusText(t, po.status),
      state: po.status === 'billed' || po.status === 'paid' ? 'positive' : 'information',
      onClick: onOpenPurchaseOrder ? () => onOpenPurchaseOrder(po) : undefined,
    })),
    ...(model.dns.length > 0
      ? model.dns.map((dn) => ({ key: `dn-${dn.id}`, label: t.deliveryNote, icon: Truck, number: dn.dn_number, sub: fmtDate(dn.delivered_at, lang) }))
      : [{ key: 'dn-pending', label: t.deliveryNote, icon: Truck, pending: true }]),
    ...(model.invs.length > 0
      ? model.invs.map((inv) => ({
          key: `inv-${inv.id}`,
          label: t.invoice,
          icon: Receipt,
          number: inv.invoice_number,
          sub: `SAR ${sar(inv.grand_total_sar)}`,
          status: statusText(t, inv.payment_status),
          state: inv.payment_status === 'paid' ? 'positive' : inv.payment_status === 'partial' ? 'critical' : 'information',
          onClick: onOpenInvoice ? () => onOpenInvoice(inv) : undefined,
        }))
      : [{ key: 'inv-pending', label: t.invoice, icon: Receipt, pending: true }]),
  ];

  const actions = [
    onDeliver && !model.fullyDelivered && (
      <ActionButton key="deliver" primary icon={Truck} onClick={() => onDeliver(order)}>{t.deliver}</ActionButton>
    ),
    onPrint && <ActionButton key="print" icon={Printer} onClick={() => onPrint(order)}>{t.print}</ActionButton>,
  ].filter(Boolean);

  return (
    <ObjectPageLayout
      lang={lang}
      onBack={onBack}
      breadcrumb={[t.home, t.sales, t.salesOrder]}
      title={order.so_number}
      subtitle={[order.client_name, order.contact_person, order.salesman_name ? `${t.salesman}: ${order.salesman_name}` : ''].filter(Boolean).join(' • ')}
      statuses={[
        <ObjectStatus key="st" state={soState}>{statusText(t, order.status)}</ObjectStatus>,
        order.division && <ObjectStatus key="div" state="information">{`${t.division}: ${order.division}`}</ObjectStatus>,
      ].filter(Boolean)}
      facets={[
        <Facet key="v" label={t.orderValue} value={`SAR ${sar(order.grand_total_sar)}`} sub={fmtDate(order.created_at, lang)} />,
        <Facet key="d" label={t.deliveredPct} value={pct(model.deliveredPct)} state={model.fullyDelivered ? 'positive' : model.delivered > 0 ? 'critical' : undefined} />,
        <Facet key="i" label={t.invoiced} value={`SAR ${sar(model.invoiced)}`} />,
        <Facet key="c" label={t.collected} value={`SAR ${sar(model.collected)}`} state="positive" />,
        <Facet key="m" label={t.estMargin} value={pct(model.estMarginPct)} sub={`SAR ${sar(model.estMargin)}`} state={model.estMargin < 0 ? 'negative' : undefined} />,
      ]}
      actions={actions}
      tabs={[
        { id: 'items', label: t.items, count: model.items.length, content: itemsTab },
        { id: 'deliveries', label: t.deliveries, count: model.dns.length, content: deliveriesTab },
        { id: 'invoices', label: t.invoices, count: model.invs.length, content: invoicesTab },
        { id: 'purchasing', label: t.purchasingTab, count: model.pos.length, content: purchasingTab },
        { id: 'profit', label: t.profitability, content: profitTab },
        { id: 'flow', label: t.docFlow, content: <DocumentFlow lang={lang} nodes={flowNodes} /> },
      ]}
    />
  );
}

/* ================================================================== */
/* 3. PURCHASE ORDER OBJECT PAGE                                       */
/* ================================================================== */
const PO_STAGES = ['po_issued', 'grn_completed', 'billed', 'paid'];

function StageStepper({ lang, stageIndex }) {
  const t = tr(lang);
  const labels = [t.stageIssued, t.stageGrn, t.stageBilled, t.stagePaid];
  return (
    <div className="flex flex-wrap items-center gap-2 p-4">
      {labels.map((label, i) => {
        const done = i <= stageIndex;
        return (
          <React.Fragment key={label}>
            {i > 0 && <div className={`h-0.5 w-6 sm:w-10 ${i <= stageIndex ? 'bg-emerald-600' : 'bg-slate-200'}`} aria-hidden="true" />}
            <div className={`flex items-center gap-1.5 text-xs font-semibold ${done ? 'text-emerald-700' : 'text-slate-400'}`}>
              {done ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
              {label}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function PurchaseOrderObjectPage({
  lang = 'en',
  po,
  supplierPayments,
  glEntries,
  vendors,
  salesOrders,
  onBack,
  onPrint,
  onPay,
  onOpenSalesOrder,
}) {
  const t = tr(lang);
  const order = po || {};

  const model = useMemo(() => {
    const items = arr(order.items);
    const fx = num(order.fx_rate) || 1;
    const goodsSar = num(order.goods_total_sar);
    const landed = num(order.landed_cost_sar);
    const vat = num(order.supplier_vat_sar ?? order.input_vat_sar);
    const totalSar = goodsSar + landed + vat;
    const totalFx = num(order.total_amount_fx) || (fx > 0 ? totalSar / fx : 0);
    const pays = arr(supplierPayments)
      .filter((p) => p && (p.po_id === order.id || (order.po_number && p.po_number === order.po_number)))
      .sort((a, b) => dateKey(a.payment_date || a.created_at) - dateKey(b.payment_date || b.created_at));
    const paidSar = num(order.paid_amount_sar) || pays.reduce((s, p) => s + num(p.amount_sar), 0);
    const paidFx = num(order.paid_amount_fx) || pays.reduce((s, p) => s + num(p.amount_fx), 0);
    const openFx = Math.max(0, totalFx - paidFx);
    const openSar = openFx * fx;
    const fxVariance = pays.reduce((s, p) => s + num(p.fx_variance_sar), 0);
    const isPaid = order.payment_status === 'paid' || order.status === 'paid' || order.bill_status === 'paid';
    const stageIndex = isPaid ? 3 : Math.max(0, PO_STAGES.indexOf(order.status));
    const billNumber = order.bill_number || (stageIndex >= 2 ? `BILL-${order.po_number}` : '');
    const journals = relatedJournals(glEntries, [billNumber, `BILL-${order.po_number}`, order.po_number, ...pays.map((p) => p.voucher_number)]);
    const supplierName = String(order.supplier_name || '').trim().toLowerCase();
    const vendor = arr(vendors).find((v) => v && String(v.name_en || '').trim().toLowerCase() === supplierName) || null;
    const so = arr(salesOrders).find((s) => s && (s.id === order.so_id || (order.so_number && s.so_number === order.so_number))) || null;
    return { items, fx, goodsSar, landed, vat, totalSar, totalFx, pays, paidSar, openFx, openSar, fxVariance, isPaid, stageIndex, billNumber, journals, vendor, so };
  }, [order, supplierPayments, glEntries, vendors, salesOrders]);

  const cur = order.currency || 'SAR';
  const statusKey = model.isPaid ? 'paid' : order.status;
  const poState = model.isPaid ? 'positive' : order.status === 'billed' ? 'critical' : 'information';
  const canPay = onPay && !model.isPaid && (order.status === 'billed' || order.bill_status === 'posted');

  const itemsTab = (
    <Section title={t.items} icon={FileText}>
      {model.items.length === 0 ? (
        <Empty>{t.noItems}</Empty>
      ) : (
        <Table
          head={
            <tr>
              <th className={thCls}>{t.description}</th>
              <th className={thNum}>{t.qty}</th>
              <th className={thNum}>{`${t.unitCostFx} (${cur})`}</th>
              <th className={thNum}>{`${t.lineFx} (${cur})`}</th>
              <th className={thNum}>{t.lineSar}</th>
              <th className={thCls}>{t.stocked}</th>
            </tr>
          }
          foot={
            <tr>
              <td className="p-3" colSpan={3}>{t.totals}</td>
              <td className={tdNum}>{sar(order.goods_total_fx)}</td>
              <td className={tdNum}>{sar(model.goodsSar)}</td>
              <td />
            </tr>
          }
        >
          {model.items.map((it, i) => {
            const q = itemQty(it);
            const lineFx = q * num(it.unitCostFx);
            return (
              <tr key={it.id || i}>
                <td className={`${tdCls} font-semibold`}>{itemDesc(it)}</td>
                <td className={tdNum}>{q}</td>
                <td className={tdNum}>{sar(it.unitCostFx)}</td>
                <td className={tdNum}>{sar(lineFx)}</td>
                <td className={`${tdNum} font-bold`}>{sar(lineFx * model.fx)}</td>
                <td className="p-3 text-slate-600">{it.is_stocked_item ? t.yes : t.no}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </Section>
  );

  const costingTab = (
    <Section title={t.costing} icon={Percent}>
      <KeyValueGrid
        rows={[
          [`${t.goodsFx} (${cur})`, `${cur} ${sar(order.goods_total_fx)}`],
          [t.fxRate, String(model.fx)],
          [t.goodsSar, `SAR ${sar(model.goodsSar)}`],
          [t.landedCost, `SAR ${sar(model.landed)}`],
          [t.supplierVat, `SAR ${sar(model.vat)}`],
          [t.totalPayable, `SAR ${sar(model.totalSar)}`],
          [`${t.total} (${cur})`, `${cur} ${sar(model.totalFx)}`],
          [t.fxVariance, model.pays.length > 0 ? `SAR ${sar(model.fxVariance)}` : '—'],
        ]}
      />
    </Section>
  );

  const paymentsTab = (
    <Section title={t.payments} icon={Banknote}>
      {model.pays.length === 0 ? (
        <Empty>{t.noPayments}</Empty>
      ) : (
        <Table
          head={
            <tr>
              <th className={thCls}>{t.document}</th>
              <th className={thCls}>{t.date}</th>
              <th className={thCls}>{t.method}</th>
              <th className={thNum}>{`${t.amountFx} (${cur})`}</th>
              <th className={thNum}>{t.amount}</th>
              <th className={thNum}>{t.fxVariance}</th>
            </tr>
          }
          foot={
            <tr>
              <td className="p-3" colSpan={4}>{t.totals}</td>
              <td className={tdNum}>{sar(model.pays.reduce((s, p) => s + num(p.amount_sar), 0))}</td>
              <td className={tdNum}>{sar(model.fxVariance)}</td>
            </tr>
          }
        >
          {model.pays.map((p) => (
            <tr key={p.id || p.voucher_number}>
              <td className={`${tdCls} font-mono font-semibold`}>{p.voucher_number || '—'}</td>
              <td className="p-3 text-slate-600 whitespace-nowrap">{fmtDate(p.payment_date || p.created_at, lang)}</td>
              <td className="p-3 text-slate-600">
                {p.payment_method || '—'}
                {p.bank_reference && <div className="text-[11px] text-slate-500">{p.bank_reference}</div>}
              </td>
              <td className={tdNum}>{sar(p.amount_fx)}</td>
              <td className={`${tdNum} font-bold`}>{sar(p.amount_sar)}</td>
              <td className={`${tdNum} ${num(p.fx_variance_sar) > 0 ? 'text-rose-600' : num(p.fx_variance_sar) < 0 ? 'text-emerald-700' : ''}`}>{sar(p.fx_variance_sar)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );

  const v = model.vendor;
  const supplierTab = (
    <Section title={t.supplier} icon={Building2}>
      {!v && <div className="px-4 pt-3 text-[11px] text-amber-700 font-semibold">{t.noSupplier}</div>}
      <KeyValueGrid
        rows={
          v
            ? [
                [t.vendorCode, v.vendor_code],
                [t.nameEn, v.name_en],
                [t.nameAr, v.name_ar],
                [t.origin, v.vendor_origin],
                [t.vatNo, v.vat_number],
                [t.cr, v.cr_number],
                [t.contact, v.contact_person],
                [t.phone, v.phone],
                [t.email, v.email],
                [t.country, v.country],
                [t.city, v.city],
                [t.address, v.address],
                [t.currency, v.default_currency],
                [t.terms, v.payment_terms],
                [t.iban, v.iban],
              ]
            : [
                [t.nameEn, order.supplier_name],
                [t.vatNo, order.supplier_vat],
                [t.email, order.supplier_email],
                [t.phone, order.supplier_phone],
                [t.currency, order.currency],
                [t.terms, order.payment_terms],
              ]
        }
      />
    </Section>
  );

  const so = model.so;
  const flowNodes = [
    {
      key: 'so',
      label: t.salesOrder,
      icon: ShoppingBag,
      number: so?.so_number || order.so_number || '',
      pending: !so && !order.so_number,
      sub: so?.client_name || '',
      onClick: so && onOpenSalesOrder ? () => onOpenSalesOrder(so) : undefined,
    },
    {
      key: 'po',
      label: t.purchaseOrder,
      icon: FileText,
      number: order.po_number,
      current: true,
      sub: `${cur} ${sar(model.totalFx)}`,
      status: statusText(t, statusKey),
      state: poState,
    },
    { key: 'grn', label: t.grn, icon: PackageCheck, number: model.stageIndex >= 1 ? t.statusLabels.grn_completed : '', pending: model.stageIndex < 1 },
    {
      key: 'bill',
      label: t.bill,
      icon: Receipt,
      number: model.stageIndex >= 2 ? model.billNumber : '',
      pending: model.stageIndex < 2,
      sub: model.stageIndex >= 2 ? `SAR ${sar(model.totalSar)} • ${fmtDate(order.billed_at, lang)}` : '',
    },
    ...(model.pays.length > 0
      ? model.pays.map((p) => ({
          key: `pay-${p.voucher_number}`,
          label: t.supplierPayment,
          icon: Banknote,
          number: p.voucher_number,
          sub: `SAR ${sar(p.amount_sar)} • ${fmtDate(p.payment_date, lang)}`,
          state: 'positive',
        }))
      : [{ key: 'pay-pending', label: t.supplierPayment, icon: Banknote, pending: true }]),
  ];

  const actions = [
    canPay && <ActionButton key="pay" primary icon={Banknote} onClick={() => onPay(order)}>{t.paySupplier}</ActionButton>,
    onPrint && <ActionButton key="print" icon={Printer} onClick={() => onPrint(order)}>{t.print}</ActionButton>,
  ].filter(Boolean);

  return (
    <ObjectPageLayout
      lang={lang}
      onBack={onBack}
      breadcrumb={[t.home, t.purchasing, t.purchaseOrder]}
      title={order.po_number}
      subtitle={[order.supplier_name, order.supplier_vat ? `${t.vatNo}: ${order.supplier_vat}` : '', order.so_number ? `${t.soRef}: ${order.so_number}` : ''].filter(Boolean).join(' • ')}
      statuses={[
        <ObjectStatus key="st" state={poState}>{statusText(t, statusKey)}</ObjectStatus>,
        order.bill_status && <ObjectStatus key="bill" state={order.bill_status === 'unbilled' ? 'neutral' : 'information'}>{statusText(t, order.bill_status)}</ObjectStatus>,
      ].filter(Boolean)}
      facets={[
        <Facet key="t" label={`${t.total} (${cur})`} value={`${cur} ${sar(model.totalFx)}`} sub={`${t.fxRate}: ${model.fx}`} />,
        <Facet key="ts" label={t.totalSar} value={`SAR ${sar(model.totalSar)}`} />,
        <Facet key="p" label={t.paidSar} value={`SAR ${sar(model.paidSar)}`} state="positive" />,
        <Facet key="o" label={t.openSar} value={`SAR ${sar(model.openSar)}`} state={model.openSar > 0.009 ? 'critical' : 'positive'} />,
        <Facet key="s" label={t.status} value={statusText(t, statusKey)} state={poState} />,
      ]}
      actions={actions}
      tabs={[
        { id: 'items', label: t.items, count: model.items.length, content: itemsTab },
        { id: 'costing', label: t.costing, content: costingTab },
        { id: 'payments', label: t.payments, count: model.pays.length, content: paymentsTab },
        { id: 'accounting', label: t.accounting, count: model.journals.length, content: <JournalList lang={lang} journals={model.journals} /> },
        { id: 'supplier', label: t.supplier, content: supplierTab },
        {
          id: 'flow',
          label: t.docFlow,
          content: (
            <div className="space-y-4">
              <Section title={t.status} icon={CheckCircle2}>
                <StageStepper lang={lang} stageIndex={model.stageIndex} />
              </Section>
              <DocumentFlow lang={lang} nodes={flowNodes} />
            </div>
          ),
        },
      ]}
    />
  );
}
