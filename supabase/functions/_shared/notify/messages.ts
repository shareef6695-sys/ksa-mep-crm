// Reminder texts (English + Arabic) for the notify Edge Function. Pure functions: unit-tested in supabase/tests/notify.

export interface OverdueItem {
  kind: 'overdue_invoice';
  channel: 'email' | 'whatsapp';
  to: string;
  cc?: string | null;
  refId: string;
  invoiceNumber: string;
  client: string;
  dueDate: string;
  daysOverdue: number;
  openSar: number;
  company: string;
  companyAr?: string | null;
  bankIban?: string | null;
}
export interface DigestEntry { type: 'quote_approval' | 'po_approval' | 'contract_draft' | 'contract_renewal'; ref: string; text: string }
export interface DigestItem {
  kind: 'approval_digest';
  channel: 'email' | 'whatsapp';
  to: string;
  refId: string;
  name: string;
  role: string;
  items: DigestEntry[];
  company: string;
}
export type QueueItem = OverdueItem | DigestItem;
export interface Rendered { subject: string; text: string; html: string; templateParams: string[] }

export const sar = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const DIGEST_LABEL: Record<DigestEntry['type'], [string, string]> = {
  quote_approval: ['Quotes waiting for your pricing approval', 'عروض أسعار بانتظار اعتمادك'],
  po_approval: ['Purchase orders waiting for approval', 'أوامر شراء بانتظار الاعتماد'],
  contract_draft: ['Contract invoices to review and post', 'فواتير عقود للمراجعة والترحيل'],
  contract_renewal: ['Contracts due for renewal', 'عقود تقترب من موعد التجديد'],
};

export function render(m: QueueItem): Rendered {
  if (m.kind === 'overdue_invoice') {
    const subject = `Payment reminder: ${m.invoiceNumber} — SAR ${sar(m.openSar)} overdue / تذكير بالسداد`;
    const en = `Dear ${m.client},\n\nOur records show invoice ${m.invoiceNumber} (due ${m.dueDate}) is ${m.daysOverdue} day(s) past due, `
      + `with SAR ${sar(m.openSar)} outstanding.${m.bankIban ? ` Please transfer to IBAN ${m.bankIban}.` : ''} `
      + `If you have already paid, please send us the transfer reference and ignore this reminder.\n\nRegards,\n${m.company}`;
    const ar = `السادة ${m.client}،\n\nنفيدكم بأن الفاتورة رقم ${m.invoiceNumber} (تاريخ الاستحقاق ${m.dueDate}) متأخرة ${m.daysOverdue} يومًا، `
      + `والمبلغ المستحق ${sar(m.openSar)} ريال.${m.bankIban ? ` يرجى التحويل إلى الآيبان ${m.bankIban}.` : ''} `
      + `إذا تم السداد فيرجى تزويدنا بمرجع التحويل وتجاهل هذا التذكير.\n\nمع التحية،\n${m.companyAr || m.company}`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${esc(en).replace(/\n/g, '<br>')}`
      + `<hr><div dir="rtl" style="text-align:right">${esc(ar).replace(/\n/g, '<br>')}</div></div>`;
    return { subject, text: `${en}\n\n----\n\n${ar}`, html, templateParams: [m.client, m.invoiceNumber, sar(m.openSar), String(m.daysOverdue), m.company] };
  }
  const groups = (Object.keys(DIGEST_LABEL) as DigestEntry['type'][])
    .map((t) => ({ t, rows: m.items.filter((i) => i.type === t) }))
    .filter((g) => g.rows.length);
  const subject = `${m.items.length} item(s) waiting for you in Horizon ERP / بانتظارك ${m.items.length}`;
  const textLines = [`Good morning ${m.name},`, '', ...groups.flatMap((g) => [`${DIGEST_LABEL[g.t][0]} / ${DIGEST_LABEL[g.t][1]}:`,
    ...g.rows.map((r) => `  • ${r.ref} — ${r.text}`), '']), m.company];
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6"><p>Good morning ${esc(m.name)},</p>`
    + groups.map((g) => `<p><b>${esc(DIGEST_LABEL[g.t][0])}</b> / <span dir="rtl">${esc(DIGEST_LABEL[g.t][1])}</span></p><ul>`
      + g.rows.map((r) => `<li>${esc(r.ref)} — ${esc(r.text)}</li>`).join('') + '</ul>').join('') + `<p>${esc(m.company)}</p></div>`;
  const summary = groups.map((g) => `${g.rows.length} ${DIGEST_LABEL[g.t][0].toLowerCase()}`).join('; ');
  return { subject, text: textLines.join('\n'), html, templateParams: [m.name, String(m.items.length), summary] };
}
