// Aging maths shared by the AR / AP aging screens (extracted for tests, Prompt 15).
// SQL ar_aging() / ap_aging() are the reports of record; these mirror them for the in-app lists.
const DAY = 86400000;

/** Aging bucket of a number of days (past due for AR / AP bills, days old for legacy POs). */
export function getBucket(days) {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

/** Whole days since a timestamp (0 when missing or in the future). */
export function daysOld(dateStr, now = Date.now()) {
  if (!dateStr) return 0;
  return Math.max(0, Math.floor((now - new Date(dateStr).getTime()) / DAY));
}

/** Days past the due date (Riyadh midnight); negative = not yet due. Invoices without a due date: issue + 30 days. */
export function daysPastDue(inv, now = Date.now()) {
  return inv.due_date
    ? Math.floor((now - new Date(`${inv.due_date}T00:00:00+03:00`).getTime()) / DAY)
    : daysOld(inv.issued_at || inv.created_at, now) - 30;
}
