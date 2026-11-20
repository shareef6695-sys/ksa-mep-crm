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

export function getZatcaComplianceAdvice(annualTaxableRevenueSAR, isPhase2Connected) {
  if (annualTaxableRevenueSAR > 375000) {
    return {
      level: 'mandatory_now',
      wave: 'Wave 24 (Mandatory VAT > SAR 375,000)',
      deadline: 'Active Now (30 June 2026)',
      statusText: isPhase2Connected
        ? 'Phase 2 Fatoora Integration Active (Clearance & Reporting Enabled)'
        : 'ACTION REQUIRED: Annual taxable revenue exceeds SAR 375,000. Connect ZATCA Fatoora CSID immediately.',
      badgeClass: isPhase2Connected
        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
        : 'bg-rose-50 text-rose-800 border-rose-300',
    };
  }
  if (annualTaxableRevenueSAR > 187500) {
    return {
      level: 'upcoming_wave25',
      wave: 'Wave 25 (Voluntary VAT > SAR 187,500)',
      deadline: '1 February 2027',
      statusText:
        'UPCOMING MANDATE: Revenue exceeds SAR 187,500. Phase 2 Fatoora integration required by Feb 1, 2027.',
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-300',
    };
  }
  return {
    level: 'phase1_active',
    wave: 'Phase 1 Compliant (< SAR 187,500)',
    deadline: '6 Months Prior Notice from ZATCA',
    statusText:
      'Phase 1 Compliant: Generating bilingual AR/EN Tax Invoices with Base64 TLV QR codes & UUIDs.',
    badgeClass: 'bg-blue-50 text-blue-800 border-blue-300',
  };
}

export const formatSAR = (num) =>
  new Intl.NumberFormat('en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(num) || 0);