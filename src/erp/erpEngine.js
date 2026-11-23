export function generateZatcaQrBase64({ sellerName, vatNumber, timestampIso, totalWithVat, vatAmount }) {
  const encoder = new TextEncoder();
  const fields = [
    { tag: 1, val: String(sellerName || 'Horizon Business Solutions Est.') },
    { tag: 2, val: String(vatNumber || '300000000000003') },
    { tag: 3, val: String(timestampIso || new Date().toISOString()) },
    { tag: 4, val: Number(totalWithVat || 0).toFixed(2) },
    { tag: 5, val: Number(vatAmount || 0).toFixed(2) },
  ];

  const chunks = [];
  for (const f of fields) {
    const valBytes = encoder.encode(f.val);
    chunks.push(new Uint8Array([f.tag, valBytes.length]));
    chunks.push(valBytes);
  }

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.length;
  }

  let binary = '';
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  return btoa(binary);
}

// ZATCA Phase 2 (integration) waves currently announced:
//   Wave 24: VAT-taxable revenue > SAR 375,000 in any of 2022, 2023, 2024  -> integrate by 30 June 2026
//   Wave 25: VAT-taxable revenue > SAR 187,500 in any of 2022, 2023, 2024, 2025 -> integrate by 1 February 2027
// Both are mandatory. ZATCA notifies each taxpayer; check the Fatoora portal for your own notification.
// revenue: { 2022: n, 2023: n, 2024: n, 2025: n } (preferred) or a single annual number (older callers).
export function getZatcaComplianceAdvice(revenue, isPhase2Connected) {
  const byYear = typeof revenue === 'object' && revenue !== null ? revenue : { current: Number(revenue) || 0 };
  const val = (y) => Number(byYear[y]) || 0;
  const anyOver = (years, limit) => years.some((y) => val(y) > limit) || (byYear.current !== undefined && byYear.current > limit);
  const connected = {
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    statusText: 'Phase 2 integration active: invoices are cleared / reported through Fatoora.',
  };

  if (anyOver(['2022', '2023', '2024'], 375000)) {
    return {
      level: 'wave24',
      wave: 'Wave 24 (VAT-taxable revenue > SAR 375,000 in 2022–2024)',
      deadline: '30 June 2026 (passed)',
      ...(isPhase2Connected ? connected : {
        statusText: 'ACTION REQUIRED: the Wave 24 integration deadline (30 June 2026) has passed. Complete Fatoora Phase 2 onboarding now — penalties apply.',
        badgeClass: 'bg-rose-50 text-rose-800 border-rose-300',
      }),
    };
  }
  if (anyOver(['2022', '2023', '2024', '2025'], 187500)) {
    return {
      level: 'wave25',
      wave: 'Wave 25 (VAT-taxable revenue > SAR 187,500 in 2022–2025)',
      deadline: '1 February 2027',
      ...(isPhase2Connected ? connected : {
        statusText: 'MANDATORY: integrate with Fatoora (Phase 2) by 1 February 2027.',
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-300',
      }),
    };
  }
  return {
    level: 'phase1',
    wave: 'Phase 1 (below current wave thresholds)',
    deadline: 'ZATCA gives at least 6 months notice',
    statusText: 'Phase 1: issue compliant e-invoices with QR codes. Enter your VAT-taxable revenue for 2022–2025 in Company & ZATCA Profile to check future waves.',
    badgeClass: 'bg-blue-50 text-blue-800 border-blue-300',
  };
}

// VAT categories (mirror of public.vat_categories) and ZATCA exemption / zero-rating reason codes
export const VAT_RATES = { S: 0.15, Z: 0, E: 0, O: 0 };
export const vatRateOf = (line) =>
  typeof line?.vatRate === 'number' ? line.vatRate : VAT_RATES[String(line?.vatCategory || 'S').toUpperCase()] ?? 0.15;

export const VAT_EXEMPTION_REASONS = [
  { code: 'VATEX-SA-29', category: 'E', label: 'Financial services' },
  { code: 'VATEX-SA-29-7', category: 'E', label: 'Life insurance services' },
  { code: 'VATEX-SA-30', category: 'E', label: 'Real estate transactions' },
  { code: 'VATEX-SA-32', category: 'Z', label: 'Export of goods' },
  { code: 'VATEX-SA-33', category: 'Z', label: 'Export of services' },
  { code: 'VATEX-SA-34-1', category: 'Z', label: 'International transport of goods' },
  { code: 'VATEX-SA-34-2', category: 'Z', label: 'International transport of passengers' },
  { code: 'VATEX-SA-34-3', category: 'Z', label: 'Services connected to international passenger transport' },
  { code: 'VATEX-SA-34-4', category: 'Z', label: 'Supply of a qualifying means of transport' },
  { code: 'VATEX-SA-34-5', category: 'Z', label: 'Services relating to goods or passenger transportation' },
  { code: 'VATEX-SA-35', category: 'Z', label: 'Medicines and medical equipment' },
  { code: 'VATEX-SA-36', category: 'Z', label: 'Qualifying metals' },
  { code: 'VATEX-SA-EDU', category: 'Z', label: 'Private education to citizens' },
  { code: 'VATEX-SA-HEA', category: 'Z', label: 'Private healthcare to citizens' },
  { code: 'VATEX-SA-MLTRY', category: 'Z', label: 'Qualified military goods' },
  { code: 'VATEX-SA-OOS', category: 'O', label: 'Not subject to VAT (out of scope)' },
];

// KSA VAT number: 15 digits, starts and ends with 3. CR number: 10 digits.
export const isValidKsaVat = (v) => /^3\d{13}3$/.test(String(v || '').trim());
export const isValidCr = (v) => /^\d{10}$/.test(String(v || '').trim());

export const formatSAR = (num) =>
  new Intl.NumberFormat('en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(num) || 0);
// Open balance of a customer invoice (migrations 0006 / 0010): invoices are never changed after issue;
// collections, credit notes and debit notes are tracked separately. open = grand + debited - paid - credited.
export const invoiceOpenSar = (inv) =>
  Math.round(
    ((Number(inv?.grand_total_sar) || 0) + (Number(inv?.debited_amount_sar) || 0) - (Number(inv?.paid_amount_sar) || 0) - (Number(inv?.credited_amount_sar) || 0)) * 100
  ) / 100;
