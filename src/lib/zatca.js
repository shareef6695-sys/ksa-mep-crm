// ZATCA Phase 2 helpers for the UI. The database and the `zatca` Edge Function are the real gate.

const STATUS = {
  phase1_qr_ready: { en: 'Phase 1 QR', ar: 'المرحلة 1', tone: 'neutral' },
  pending: { en: 'Awaiting ZATCA', ar: 'بانتظار الهيئة', tone: 'critical' },
  submitting: { en: 'Sending to ZATCA', ar: 'جارٍ الإرسال', tone: 'critical' },
  retrying: { en: 'ZATCA retry scheduled', ar: 'إعادة المحاولة', tone: 'critical' },
  rejected: { en: 'Rejected by ZATCA', ar: 'مرفوضة من الهيئة', tone: 'negative' },
  cleared: { en: 'Cleared by ZATCA', ar: 'معتمدة من الهيئة', tone: 'positive' },
  reported: { en: 'Reported to ZATCA', ar: 'مُبلغ عنها', tone: 'positive' },
};

export const zatcaStatus = (doc, lang = 'en') => {
  const s = STATUS[doc?.zatca_status] || STATUS.phase1_qr_ready;
  return { label: lang === 'ar' ? s.ar : s.en, tone: s.tone, key: doc?.zatca_status || 'phase1_qr_ready' };
};

/** A Phase 2 standard (B2B) document may be printed or shared only after ZATCA cleared it. */
export const blocksSharing = (doc, profileType) => {
  const status = doc?.zatca_status;
  const type = profileType || doc?.invoice_type;
  return type === 'standard' && !!status && status !== 'phase1_qr_ready' && status !== 'cleared';
};

/** Phase 2 QR (ZATCA's for cleared B2B, our signed one for B2C) when there is one, else the Phase 1 QR. */
export const zatcaQr = (doc) => doc?.zatca_qr || doc?.qr_base64 || '';

export const needsSubmission = (doc) => ['pending', 'retrying', 'rejected', 'submitting'].includes(doc?.zatca_status);

export async function callZatca(supabase, action, body = {}) {
  const { data, error } = await supabase.functions.invoke('zatca', { body: { action, ...body } });
  if (error) {
    let message = error.message;
    try {
      const ctx = await error.context?.json?.();
      if (ctx?.error) message = ctx.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
  return data;
}

/** Submit right after posting. Never throws: returns a short message for the user. */
export async function submitAfterPosting(supabase, docType, doc) {
  if (!doc || doc.zatca_status !== 'pending') return null;
  try {
    const r = await callZatca(supabase, 'submit', { doc_type: docType, doc_id: doc.id });
    if (r?.status === 'cleared' || r?.status === 'reported') {
      return `ZATCA: ${r.status}${(r.warnings || []).length ? ` with ${r.warnings.length} warning(s)` : ''}.`;
    }
    if (r?.status === 'rejected') return `ZATCA rejected ${docType.replace('_', ' ')}: ${(r.errors || []).map((x) => x.message || x).join('; ')}`;
    return 'ZATCA could not be reached; the document is queued and will be retried.';
  } catch (e) {
    return `ZATCA submission failed: ${e.message}. The document stays queued.`;
  }
}
