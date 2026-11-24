// Right-to-erasure helpers (migration 0020, admin-users "erase"). Admin only; the database checks it again.

export const ERASE_NOTE =
  'This removes contact names, phone, WhatsApp and email from the record, its open documents and the audit trail. ' +
  'Legal names, VAT / CR numbers, addresses and posted documents stay, because tax law requires them. It cannot be undone.';

/** Asks for confirmation and a reason. Returns the reason, or null when the admin cancels. */
export function confirmErasure(label) {
  const typed = window.prompt(`Erase personal data of ${label}?\n\n${ERASE_NOTE}\n\nType ERASE to confirm.`);
  if (typed === null) return null;
  if (typed.trim().toUpperCase() !== 'ERASE') {
    window.alert('Not erased: type ERASE to confirm.');
    return null;
  }
  const reason = window.prompt('Reason (for the erasure record, e.g. "Data subject request 24 Nov 2026"). No personal data here.');
  return reason === null ? null : reason.trim() || 'Not given';
}

/** Customer or vendor: runs the database function and reports what changed. */
export async function eraseParty(supabase, kind, record) {
  const reason = confirmErasure(record.name_en || record.id);
  if (!reason) return false;
  const { data, error } = await supabase.rpc('erase_personal_data', { p_kind: kind, p_id: record.id, p_reason: reason });
  if (error) {
    window.alert(`Not erased: ${error.message}`);
    return false;
  }
  const parts = Object.entries(data || {}).filter(([, v]) => typeof v === 'number' && v > 0).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`);
  window.alert(`Personal data erased for ${record.name_en || record.id}.${parts.length ? ` Also cleaned: ${parts.join(', ')}.` : ''}`);
  return true;
}
