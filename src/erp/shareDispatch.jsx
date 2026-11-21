import React from 'react';
import { MessageCircle, Mail } from 'lucide-react';
import { formatSAR } from './erpEngine';

export function normalizeKsaPhone(rawPhone) {
  if (!rawPhone) return '';
  let digits = String(rawPhone).replace(/[^\d]/g, '');
  if (digits.startsWith('00966')) digits = digits.slice(2);
  else if (digits.startsWith('05') && digits.length === 10) digits = '966' + digits.slice(1);
  else if (digits.startsWith('5') && digits.length === 9) digits = '966' + digits;
  return digits;
}

export function buildDocumentSharePayload({ company, docType, docNumber, clientName, division, totalSar, status }) {
  const coName = company?.nameEn || 'KSA MEP & IT Trading';
  const vatTin = company?.vatNumber ? ` (VAT TIN: ${company.vatNumber})` : '';
  const divLabel = division ? ` | Division: ${division}` : '';
  const amtText = totalSar !== undefined && totalSar !== null ? `\nTotal Amount (incl. 15% VAT): SAR ${formatSAR(totalSar)}` : '';
  const statusText = status ? `\nStatus: ${String(status).toUpperCase()}` : '';

  const subject = `${docType} ${docNumber} — ${coName}`;
  const body =
    `Dear ${clientName || 'Valued Partner'},\n\n` +
    `Please find the details for ${docType} ${docNumber} from ${coName}${vatTin}:${divLabel}` +
    `${amtText}${statusText}\n\n` +
    `Kindly review and confirm at your earliest convenience.\n\n` +
    `Best regards,\n${coName}\n${company?.phone || ''}`;

  return { subject, body };
}

export function openWhatsAppShare({ company, customers = [], docType, docNumber, clientName, division, totalSar, status, directPhone }) {
  const matchedCustomer = customers.find(
    (c) => String(c.name_en || c.name || '').trim().toLowerCase() === String(clientName || '').trim().toLowerCase()
  );
  const rawPhone = directPhone || matchedCustomer?.whatsapp || matchedCustomer?.phone || matchedCustomer?.mobile || '';
  const ksaPhone = normalizeKsaPhone(rawPhone);
  const { body } = buildDocumentSharePayload({ company, docType, docNumber, clientName, division, totalSar, status });
  const encodedText = encodeURIComponent(body);
  const waUrl = ksaPhone ? `https://wa.me/${ksaPhone}?text=${encodedText}` : `https://wa.me/?text=${encodedText}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');
}

export function openEmailShare({ company, customers = [], docType, docNumber, clientName, division, totalSar, status, directEmail }) {
  const matchedCustomer = customers.find(
    (c) => String(c.name_en || c.name || '').trim().toLowerCase() === String(clientName || '').trim().toLowerCase()
  );
  const emailAddr = directEmail || matchedCustomer?.email || '';
  const { subject, body } = buildDocumentSharePayload({ company, docType, docNumber, clientName, division, totalSar, status });
  const mailtoUrl = `mailto:${encodeURIComponent(emailAddr)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailtoUrl;
}

export function ShareDocumentButtons({
  company,
  customers = [],
  docType,
  docNumber,
  clientName,
  division,
  totalSar,
  status,
  directPhone,
  directEmail,
  compact = false,
}) {
  return (
    <div className="no-print inline-flex items-center gap-1.5">
      <button
        type="button"
        title="Send via WhatsApp (+966)"
        onClick={(e) => {
          e.stopPropagation();
          openWhatsAppShare({ company, customers, docType, docNumber, clientName, division, totalSar, status, directPhone });
        }}
        className={`${
          compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
        } rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold inline-flex items-center gap-1 cursor-pointer transition`}
      >
        <MessageCircle className="w-3.5 h-3.5" />
        <span>WhatsApp</span>
      </button>

      <button
        type="button"
        title="Send via Email"
        onClick={(e) => {
          e.stopPropagation();
          openEmailShare({ company, customers, docType, docNumber, clientName, division, totalSar, status, directEmail });
        }}
        className={`${
          compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
        } rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold inline-flex items-center gap-1 cursor-pointer transition`}
      >
        <Mail className="w-3.5 h-3.5" />
        <span>Email</span>
      </button>
    </div>
  );
}

export function normalizePartyPhone(rawPhone) {
  if (!rawPhone) return '';
  const trimmed = String(rawPhone).trim();
  let digits = trimmed.replace(/[^\d]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('05') && digits.length === 10) digits = '966' + digits.slice(1);
  else if (digits.startsWith('5') && digits.length === 9) digits = '966' + digits;
  return digits;
}

export function buildPurchaseOrderPayload({ company, po }) {
  const coName = company?.nameEn || 'KSA MEP & IT Trading';
  const vatTin = company?.vatNumber ? ` (VAT TIN: ${company.vatNumber})` : '';
  const currency = po?.currency || 'SAR';
  const fxAmt = Number(po?.total_amount_fx || po?.total_landed_sar || 0);
  const sarAmt = Number(po?.total_landed_sar || 0);
  const amtLine =
    currency === 'SAR'
      ? `\nTotal PO Value: SAR ${formatSAR(sarAmt)}`
      : `\nTotal PO Value: ${currency} ${formatSAR(fxAmt)} (Est. SAR ${formatSAR(sarAmt)})`;

  const subject = `Purchase Order ${po.po_number} — ${coName}`;
  const body =
    `Dear ${po.supplier_name || 'Valued Supplier'},\n\n` +
    `Please find our Purchase Order ${po.po_number} issued by ${coName}${vatTin}.` +
    `${amtLine}\nStatus: ${String(po.status || 'issued').toUpperCase()}\n\n` +
    `Kindly acknowledge receipt and confirm expected delivery schedule.\n\n` +
    `Best regards,\nProcurement Department\n${coName}\n${company?.phone || ''}`;

  return { subject, body };
}

export function SharePurchaseOrderButtons({ company, suppliers = [], po, compact = true }) {
  const matchedSupplier = suppliers.find(
    (s) =>
      String(s.name_en || s.name || s.supplier_name || '')
        .trim()
        .toLowerCase() === String(po?.supplier_name || '').trim().toLowerCase()
  );

  const rawPhone =
    po?.supplier_phone ||
    matchedSupplier?.whatsapp ||
    matchedSupplier?.phone ||
    matchedSupplier?.mobile ||
    '';
  const emailAddr = po?.supplier_email || matchedSupplier?.email || '';

  const handleWhatsApp = (e) => {
    e.stopPropagation();
    const phoneDigits = normalizePartyPhone(rawPhone);
    const { body } = buildPurchaseOrderPayload({ company, po });
    const encoded = encodeURIComponent(body);
    const waUrl = phoneDigits
      ? `https://wa.me/${phoneDigits}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  const handleEmail = (e) => {
    e.stopPropagation();
    const { subject, body } = buildPurchaseOrderPayload({ company, po });
    window.location.href = `mailto:${encodeURIComponent(emailAddr)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="no-print inline-flex items-center gap-1.5">
      <button
        type="button"
        title="Send PO via WhatsApp (+966 / Intl)"
        onClick={handleWhatsApp}
        className={`${
          compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
        } rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold inline-flex items-center gap-1 cursor-pointer transition`}
      >
        <MessageCircle className="w-3.5 h-3.5" />
        <span>WhatsApp</span>
      </button>

      <button
        type="button"
        title="Send PO via Email"
        onClick={handleEmail}
        className={`${
          compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
        } rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold inline-flex items-center gap-1 cursor-pointer transition`}
      >
        <Mail className="w-3.5 h-3.5" />
        <span>Email</span>
      </button>
    </div>
  );
}