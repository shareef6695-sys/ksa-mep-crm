-- =====================================================================
-- 0005_lock_writes.sql — the browser can no longer write posted records directly.
-- ---------------------------------------------------------------------
-- Run ONLY AFTER the app version that uses the post_* functions (Prompt 5) is
-- deployed. From then on, these tables change only through the posting
-- functions in 0004 (and save_inquiry from 0002). Reads are unchanged.
-- Idempotent; one transaction.
-- =====================================================================

begin;

do $$
declare t text;
begin
  foreach t in array array[
    'inquiries','sales_orders','delivery_notes','invoices','customer_receipts','credit_notes','commission_ledger',
    'purchase_orders','supplier_payments','gl_journal_entries','gl_journal_lines','expense_vouchers','fixed_assets'] loop
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated, anon', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- After cleaning up anything listed in public.orphan_references, run these
-- (they check existing rows against the foreign keys added in 0004):
--
-- alter table public.delivery_notes    validate constraint fk_dn_so;
-- alter table public.invoices          validate constraint fk_inv_so;
-- alter table public.invoices          validate constraint fk_inv_dn;
-- alter table public.customer_receipts validate constraint fk_rcp_inv;
-- alter table public.credit_notes      validate constraint fk_cn_inv;
-- alter table public.commission_ledger validate constraint fk_comm_inv;
-- alter table public.purchase_orders   validate constraint fk_po_so;
-- alter table public.supplier_payments validate constraint fk_spay_po;
-- alter table public.expense_vouchers  validate constraint fk_exp_acc;
-- alter table public.fixed_assets      validate constraint fk_fa_acc;
-- ---------------------------------------------------------------------
