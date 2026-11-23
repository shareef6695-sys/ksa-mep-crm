-- =====================================================================
-- 0017_vat_view_invoker.sql — invalid_vat_numbers follows the caller's access
-- ---------------------------------------------------------------------
-- The view (0009) ran with its owner's rights, so any signed-in user saw every customer and vendor with an
-- invalid VAT number. security_invoker makes it apply customers / vendors RLS for the person reading it
-- (sales see only their own customers). Found by the Supabase security advisor on 2026-11-23.
-- Idempotent. Re-run 0005_lock_writes afterwards is not needed (no new posting function).
-- =====================================================================
begin;
alter view public.invalid_vat_numbers set (security_invoker = true);
commit;
