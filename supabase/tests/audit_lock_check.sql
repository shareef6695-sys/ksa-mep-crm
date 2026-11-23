-- =====================================================================
-- audit_lock_check.sql — proves the 0003 rules. LOCAL TEST DATABASE ONLY.
-- Order: supabase_stub.sql -> 0001 -> rls_check.sql (part=seed) -> 0002 -> 0003 -> this file
-- Prints "AUDIT/LOCK OK" on success; raises on the first failure.
-- =====================================================================
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid)::text end, false); end $$;
create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'CHECK FAILED: %', msg; end if; end $$;
-- run a statement and require it to fail with a message containing p_like
create or replace function pg_temp.expect_error(p_sql text, p_like text, msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'CHECK FAILED (no error): %', msg;
exception when others then
  if sqlerrm like 'CHECK FAILED%' then raise; end if;
  if sqlerrm not ilike '%' || p_like || '%' then raise exception 'CHECK FAILED (wrong error "%"): %', sqlerrm, msg; end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

\set fin   '00000000-0000-0000-0000-0000000000f1'
\set adm   '00000000-0000-0000-0000-0000000000a1'
\set sales '00000000-0000-0000-0000-0000000000c1'

set role authenticated;

-- ---------- Immutability (no lock yet) ----------
select pg_temp.as_user(:'fin');
insert into public.gl_journal_entries (id, voucher_number, entry_date, status, total_debit_sar, total_credit_sar, lines)
values ('jv-t1', 'JV-T1', current_date, 'posted', 10, 10, '[{"account_code":"5100","debit":10},{"account_code":"1020","credit":10}]');
select pg_temp.expect((select created_by_uid::text from public.gl_journal_entries where id = 'jv-t1') = :'fin', 'created_by_uid stamped');
select pg_temp.expect(exists (select 1 from public.audit_log where table_name = 'gl_journal_entries' and row_id = 'jv-t1' and action = 'INSERT' and user_id::text = :'fin' and user_role = 'finance'), 'insert audited with user and role');
select pg_temp.expect_error($$update public.gl_journal_entries set description = 'x' where id = 'jv-t1'$$, 'is posted', 'posted JV cannot be edited');

update public.invoices set paid_amount_sar = 50, payment_status = 'partial' where id = 'inv-1';
select pg_temp.expect((select payment_status from public.invoices where id = 'inv-1') = 'partial', 'invoice payment fields can change');
select pg_temp.expect((select changed from public.audit_log where table_name = 'invoices' and row_id = 'inv-1' order by id desc limit 1) @> array['paid_amount_sar','payment_status'], 'changed columns recorded');
select pg_temp.expect_error($$update public.invoices set subtotal_sar = 1 where id = 'inv-1'$$, 'cannot be changed: subtotal_sar', 'invoice amounts locked');
-- 0003 refuses increases; from 0006 any change to the total is refused (both messages name the invoice)
select pg_temp.expect_error($$update public.invoices set grand_total_sar = grand_total_sar + 100 where id = 'inv-1'$$, 'INV-1', 'invoice total cannot go up');

select pg_temp.expect_error($$update public.customer_receipts set amount_sar = 1 where id = 'rcp-1'$$, 'is posted', 'receipt immutable');

insert into public.expense_vouchers (id, voucher_number, expense_account_code, amount_sar, total_sar, status)
values ('exp-t1', 'EXP-T1', '5100', 100, 115, 'posted');
select pg_temp.expect_error($$update public.expense_vouchers set amount_sar = 1 where id = 'exp-t1'$$, 'only allowed change', 'expense amounts locked');
update public.expense_vouchers set status = 'void' where id = 'exp-t1';
select pg_temp.expect_error($$update public.expense_vouchers set status = 'posted' where id = 'exp-t1'$$, 'only allowed change', 'void cannot be undone');

-- admin may delete in general, but not posted documents
select pg_temp.as_user(:'adm');
select pg_temp.expect_error($$delete from public.customer_receipts where id = 'rcp-1'$$, 'is posted', 'receipt cannot be deleted');
select pg_temp.expect_error($$delete from public.invoices where id = 'inv-2'$$, 'cannot be deleted', 'invoice cannot be deleted');
select pg_temp.expect_error($$delete from public.gl_journal_entries where id = 'jv-t1'$$, 'is posted', 'JV cannot be deleted');
insert into public.invoices (id, invoice_number, dn_id) values ('inv-dn', 'INV-DN', 'dn-1');
select pg_temp.expect_error($$delete from public.delivery_notes where id = 'dn-1'$$, 'cannot be deleted', 'invoiced DN cannot be deleted');
insert into public.delivery_notes (id, dn_number, so_id) values ('dn-t', 'DN-T', 'so-1');
delete from public.delivery_notes where id = 'dn-t';  -- not invoiced: allowed
select pg_temp.expect(exists (select 1 from public.audit_log where table_name = 'delivery_notes' and row_id = 'dn-t' and action = 'DELETE' and old_row is not null), 'delete audited with old row');

-- ---------- Period lock ----------
select pg_temp.as_user(:'sales');
select pg_temp.expect_error($$select public.set_period_lock(current_date - 1)$$, 'Only Finance', 'sales cannot change the lock');
select pg_temp.expect((select count(*) from public.audit_log) = 0, 'sales cannot read the audit log');

select pg_temp.as_user(:'fin');
-- the app path: Period Lock screen writes app_settings
insert into public.app_settings (key, value) values ('gl_period_lock', jsonb_build_object('lockDate', (current_date - 1)::text))
on conflict (key) do update set value = excluded.value;
select pg_temp.expect(public.current_lock_date() = current_date - 1, 'app_settings write recorded as lock');

select pg_temp.expect_error($$insert into public.gl_journal_entries (id, entry_date, status) values ('jv-old', current_date - 1, 'posted')$$, 'period is locked', 'no JV in locked period');
insert into public.gl_journal_entries (id, entry_date, status, lines) values ('jv-today', current_date, 'posted', '[{"account_code":"5100","debit":10},{"account_code":"1020","credit":10}]');
select pg_temp.expect_error($$insert into public.invoices (id, invoice_number, issued_at) values ('inv-old', 'INV-OLD', now() - interval '2 days')$$, 'period is locked', 'no back-dated invoice');
select pg_temp.expect_error($$insert into public.expense_vouchers (id, expense_account_code, expense_date) values ('exp-old', '5100', current_date - 5)$$, 'period is locked', 'no back-dated expense');
insert into public.customer_receipts (id, invoice_id, amount_sar) values ('rcp-today', 'inv-2', 10);  -- defaults to now: allowed

-- documents from a locked month: can still be paid / voided, but not re-dated
reset role;
select pg_temp.as_user(null);
update public.invoices set issued_at = now() - interval '10 days' where id = 'inv-2';          -- maintenance bypass
update public.gl_journal_entries set description = 'maintenance edit' where id = 'jv-t1';    -- maintenance bypass
select pg_temp.expect(exists (select 1 from public.audit_log where row_id = 'jv-t1' and user_id is null and action = 'UPDATE'), 'maintenance edits are still audited');
set role authenticated;
select pg_temp.as_user(:'fin');
update public.invoices set paid_amount_sar = 100, payment_status = 'partial' where id = 'inv-2';
select pg_temp.expect_error($$update public.invoices set issued_at = now() where id = 'inv-2'$$, 'period is locked', 'locked invoice cannot be re-dated');

-- set_period_lock moves the lock and mirrors app_settings
select public.set_period_lock(current_date - 30, 'Reopen for corrections');
select pg_temp.expect(public.current_lock_date() = current_date - 30, 'set_period_lock applied');
select pg_temp.expect((select value->>'lockDate' from public.app_settings where key = 'gl_period_lock') = (current_date - 30)::text, 'mirrored to app_settings');
select pg_temp.expect((select count(*) from public.gl_period_locks) = 2, 'one history row per change (no double row from the mirror)');
select public.set_period_lock(null);
insert into public.gl_journal_entries (id, entry_date, status, lines) values ('jv-anydate', current_date - 400, 'posted', '[{"account_code":"5100","debit":10},{"account_code":"1020","credit":10}]');
select pg_temp.expect((select count(*) from public.audit_log where table_name = 'gl_period_locks') = 3, 'lock changes audited');

-- audit log is read-only even for admin
select pg_temp.as_user(:'adm');
select pg_temp.expect((select count(*) from public.audit_log) > 0, 'admin reads audit log');
select pg_temp.expect_error($$delete from public.audit_log$$, 'permission denied', 'audit log cannot be deleted');
select pg_temp.expect_error($$update public.audit_log set user_role = 'x'$$, 'permission denied', 'audit log cannot be edited');

-- number generation alone is not logged as noise
reset role;
select pg_temp.as_user(:'fin');
set role authenticated;
reset role;
do $$
declare before_n bigint;
begin
  select count(*) into before_n from public.audit_log where table_name = 'document_number_ranges';
  perform public.next_doc_number('JOURNAL');
  if (select count(*) from public.audit_log where table_name = 'document_number_ranges') > before_n + 1 then
    raise exception 'CHECK FAILED: number generation flooded the audit log';
  end if;
end $$;

select 'AUDIT/LOCK OK' as result;
