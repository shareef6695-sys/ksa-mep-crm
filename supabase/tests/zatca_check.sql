-- =====================================================================
-- zatca_check.sql — proves 0010. LOCAL TEST DATABASE ONLY.
-- Order: the vat_check.sql order, then 0010, then vat_check.sql again (optional), then this file.
-- Prints "ZATCA OK".
-- =====================================================================
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid)::text end, false); end $$;
create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'CHECK FAILED: %', msg; end if; end $$;
create or replace function pg_temp.eq(a numeric, b numeric, msg text) returns void language plpgsql as $$
begin if a is distinct from b then raise exception 'CHECK FAILED: % (got %, expected %)', msg, a, b; end if; end $$;
create or replace function pg_temp.expect_error(p_sql text, p_like text, msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'CHECK FAILED (no error): %', msg;
exception when others then
  if sqlerrm like 'CHECK FAILED%' then raise; end if;
  if sqlerrm not ilike '%' || p_like || '%' then raise exception 'CHECK FAILED (wrong error "%"): %', sqlerrm, msg; end if;
end $$;
create or replace function pg_temp.bal(p_code text, p_doc text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.gl_journal_lines l join public.gl_journal_entries e on e.id = l.entry_id
  where l.account_code = p_code and e.source_doc_number = p_doc
$$;
grant execute on all functions in schema pg_temp to authenticated;

\set fin  '00000000-0000-0000-0000-0000000000f1'
\set mgr  '00000000-0000-0000-0000-0000000000b1'
\set proc '00000000-0000-0000-0000-0000000000d1'
\set sales '00000000-0000-0000-0000-0000000000c1'

select pg_temp.as_user(null);
reset role;
-- quotes priced at cost: no margin-floor approval in this test (0013)
update public.app_settings set value = value || '{"minMarginPct": 0}' where key = 'sales_settings';
select pg_temp.expect(not exists (select 1 from public.invoices where zatca_status = 'cleared' and zatca_submission_id is null), 'no fake "cleared" invoices left');
select pg_temp.expect(not exists (select 1 from public.app_settings where key = 'company_profile' and value ? 'zatcaPhase2Connected'), 'old switch removed');

-- ---------- 1. ZATCA rounding (no EGS yet: Phase 1 only) ----------
insert into public.inquiries (id, data) values ('INQ-RND', '{"id":"INQ-RND","customerId":"cust-b2b","clientName":"Gulf Contracting","clientVat":"310122393500003",
  "salesmanId":"00000000-0000-0000-0000-0000000000c1","marginPercent":0,
  "boqItems":[{"id":"a","desc":"Fitting A","qty":3,"buyCurrency":"SAR","buyUnitCost":33.335},
              {"id":"b","desc":"Fitting B","qty":1,"buyCurrency":"SAR","buyUnitCost":0.335}]}');
set role authenticated;
select pg_temp.as_user(:'mgr');
create temp table z_so as select * from public.post_sales_order('INQ-RND');
select pg_temp.as_user(:'proc');
create temp table z_dn as select * from public.post_delivery_note((select id from z_so), '{"a":3,"b":1}');
select pg_temp.as_user(:'fin');
create temp table z_inv as select * from public.post_invoice((select id from z_dn));
select pg_temp.eq((select subtotal_sar from z_inv), 100.35, 'subtotal = sum of rounded lines (100.01 + 0.34), not round(100.34)');
select pg_temp.eq((select vat_sar from z_inv), 15.05, 'VAT = round(100.35 x 15%)');
select pg_temp.eq((select grand_total_sar from z_inv), 115.40, 'grand total');
select pg_temp.eq((select (vat_breakdown->0->>'net')::numeric from z_inv), 100.35, 'stored breakdown net');
select pg_temp.eq(pg_temp.bal('2100', (select invoice_number from z_inv)), -15.05, 'GL output VAT = invoice VAT');
select pg_temp.expect((select zatca_status from z_inv) = 'phase1_qr_ready', 'no EGS: Phase 1 document');
select pg_temp.expect((select zatca_uuid from z_inv) is not null, 'every document gets a UUID');

-- ---------- 2. Debit note ----------
select pg_temp.expect_error($$select public.post_debit_note((select id from z_inv), '[{"desc":"x","qty":1,"unitSellSar":10}]', '')$$, 'needs a reason', 'reason required');
select pg_temp.expect_error($$select public.post_debit_note((select id from z_inv), '[{"desc":"x","qty":1,"unitSellSar":10,"vatCategory":"Z"}]', 'Price increase')$$, 'exemption reason', 'Z line without reason refused');
select pg_temp.as_user(:'sales');
select pg_temp.expect_error($$select public.post_debit_note((select id from z_inv), '[{"desc":"x","qty":1,"unitSellSar":10}]', 'Price increase')$$, 'cannot do this', 'sales cannot post debit notes');
select pg_temp.as_user(:'fin');
create temp table z_dbn as select * from public.post_debit_note((select id from z_inv), '[{"desc":"Copper surcharge","qty":2,"unitSellSar":12.505}]', 'Copper price increase per contract clause 7');
select pg_temp.eq((select subtotal_sar from z_dbn), 25.01, 'debit net');
select pg_temp.eq((select vat_sar from z_dbn), 3.75, 'debit VAT');
select pg_temp.eq((select grand_total_sar from z_dbn), 28.76, 'debit total');
select pg_temp.expect((select debit_note_number from z_dbn) like 'DBN-%', 'DBN numbering');
select pg_temp.eq(pg_temp.bal('1100', (select debit_note_number from z_dbn)), 28.76, 'Dr 1100');
select pg_temp.eq(pg_temp.bal('4010', (select debit_note_number from z_dbn)), -25.01, 'Cr revenue');
select pg_temp.eq(pg_temp.bal('2100', (select debit_note_number from z_dbn)), -3.75, 'Cr output VAT');
select pg_temp.eq((select debited_amount_sar from public.invoices where id = (select id from z_inv)), 28.76, 'invoice debited total');
select pg_temp.eq((select open_balance_sar from public.invoice_balances where invoice_id = (select id from z_inv)), 144.16, 'open = 115.40 + 28.76');
select pg_temp.eq((select open_sar from public.ar_aging() where invoice_id = (select id from z_inv)), 144.16, 'AR aging includes the debit');
-- receipt for the full new balance closes it
select public.post_customer_receipt((select id from z_inv), 144.16, 'Bank Transfer', 'TT-DBN', current_date);
select pg_temp.expect((select payment_status from public.invoices where id = (select id from z_inv)) = 'paid', 'paid after paying invoice + debit');
-- credit cap now includes the debit
create temp table z_cn as select * from public.post_credit_note((select id from z_inv), '[3, 1]', 'Full return', 'RETURN');
select pg_temp.eq((select grand_total_sar from z_cn), 115.40, 'credit note rounding matches invoice');
select pg_temp.eq((select to_customer_credit_sar from z_cn), 115.40, 'paid invoice: credit goes to customer credit');
-- the VAT return picks up debit notes as a positive adjustment and still agrees with the GL for these documents
reset role; select pg_temp.as_user(null);
create temp table z_adj as
  select coalesce((select sum((b->>'net')::numeric) from public.debit_notes d cross join lateral jsonb_array_elements(d.vat_breakdown) b
                    where public.riyadh_date(d.issued_at) = public._riyadh_today() and b->>'category' = 'S'), 0)
       - coalesce((select sum((b->>'net')::numeric) from public.credit_notes c cross join lateral jsonb_array_elements(public._doc_breakdown(c.vat_breakdown, c.items)) b
                    where public.riyadh_date(c.issued_at) = public._riyadh_today() and b->>'category' = 'S'), 0) as v;
grant select on z_adj to authenticated;
set role authenticated; select pg_temp.as_user(:'fin');
select pg_temp.eq((select adjustment_sar from public.vat_return(public._riyadh_today(), public._riyadh_today()) where box = '1'), (select public._r2(v) from z_adj), 'box 1 adjustments: + debit notes - credit notes');
select pg_temp.expect((select v from z_adj) < 0 and exists (select 1 from public.debit_notes), 'debit notes counted');
reset role;

-- ---------- 3. EGS + hash chain (service-role functions) ----------
select pg_temp.as_user(null);
insert into public.zatca_egs (environment, status, is_active, csr_input) values ('sandbox', 'active', true, '{"commonName":"TEST"}');
set role authenticated;
select pg_temp.as_user(:'fin');
select pg_temp.expect_error($$select * from public.zatca_egs$$, 'permission denied', 'authenticated cannot read the EGS table (keys)');
select pg_temp.expect_error($$select public.zatca_begin('invoice', 'x')$$, 'permission denied', 'authenticated cannot drive the chain');
select pg_temp.expect_error($$select public.zatca_queue(5)$$, 'permission denied', 'authenticated cannot read the queue function');
select pg_temp.expect((select count(*) from public.zatca_egs_status) = 1 and (select has_production_csid from public.zatca_egs_status) = false, 'finance sees the safe status view');
select pg_temp.expect(public.zatca_phase2_active(), 'phase 2 active');
select pg_temp.expect_error($$update public.credit_notes set zatca_status = 'cleared' where id = (select id from z_cn)$$, 'cannot be updated', 'a user cannot mark a document cleared');
select pg_temp.as_user(:'sales');
select pg_temp.expect((select count(*) from public.zatca_egs_status) = 0, 'sales see no EGS status');
select pg_temp.as_user(:'fin');

-- a new B2B invoice while the EGS is active
reset role;
insert into public.inquiries (id, data) values ('INQ-Z2', '{"id":"INQ-Z2","customerId":"cust-b2b","clientName":"Gulf Contracting","clientVat":"310122393500003",
  "salesmanId":"00000000-0000-0000-0000-0000000000c1","marginPercent":0,"boqItems":[{"id":"a","desc":"Panel","qty":1,"buyCurrency":"SAR","buyUnitCost":1000}]}');
set role authenticated;
select pg_temp.as_user(:'mgr');
create temp table z_so2 as select * from public.post_sales_order('INQ-Z2');
select pg_temp.as_user(:'proc');
create temp table z_dn2 as select * from public.post_delivery_note((select id from z_so2), '{"a":1}');
select pg_temp.as_user(:'fin');
create temp table z_inv2 as select * from public.post_invoice((select id from z_dn2));
select pg_temp.expect((select zatca_status from z_inv2) = 'pending', 'Phase 2: new invoice starts pending');
reset role;
select pg_temp.as_user(null);
select pg_temp.expect((select count(*) from public.zatca_queue(50) q where q.doc_id = (select id from z_inv2) and q.profile = 'standard') = 1, 'queued as standard');
select pg_temp.expect(not exists (select 1 from public.zatca_queue(50) q where q.doc_id = (select id from z_inv)), 'Phase 1 documents are not queued');

create temp table z_b1 as select public.zatca_begin('invoice', (select id from z_inv2)) as r;
select pg_temp.expect((select r->>'mode' from z_b1) = 'sign' and (select (r->>'icv')::int from z_b1) = 1, 'first ICV is 1');
select pg_temp.expect((select r->>'pih' from z_b1) = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==', 'first PIH is the ZATCA initial hash');
select pg_temp.expect((select (r->>'uuid')::uuid from z_b1) = (select zatca_uuid from z_inv2), 'first submission uses the document UUID');
select pg_temp.expect((select r->'payload'->>'profile' from z_b1) = 'standard' and (select (r->'payload'->>'grand')::numeric from z_b1) = 1150, 'payload');
select pg_temp.expect((select r->'payload'->'seller'->>'buildingNo' from z_b1) = '7788' and (select r->'payload'->'buyer'->>'vatNumber' from z_b1) = '310122393500003', 'payload seller / buyer');
select pg_temp.expect_error($$select public.zatca_begin('credit_note', (select id from z_cn))$$, 'Phase 1', 'Phase 1 documents cannot enter the chain');
-- a second document while the lease is held
reset role;
insert into public.inquiries (id, data) values ('INQ-Z3', '{"id":"INQ-Z3","clientName":"Walk-in","clientVat":"","marginPercent":0,"boqItems":[{"id":"a","desc":"Lamp","qty":2,"buyCurrency":"SAR","buyUnitCost":50}]}');
select pg_temp.as_user(:'mgr'); set role authenticated;
create temp table z_so3 as select * from public.post_sales_order('INQ-Z3');
select pg_temp.as_user(:'proc');
create temp table z_dn3 as select * from public.post_delivery_note((select id from z_so3), '{"a":2}');
select pg_temp.as_user(:'fin');
create temp table z_inv3 as select * from public.post_invoice((select id from z_dn3));
reset role; select pg_temp.as_user(null);
select pg_temp.expect((select invoice_type from z_inv3) = 'simplified' and (select zatca_status from z_inv3) = 'pending', 'B2C invoice pending');
select pg_temp.expect_error($$select public.zatca_begin('invoice', (select id from z_inv3))$$, 'busy', 'lease blocks a second document');
select pg_temp.expect_error($$select public.zatca_commit(gen_random_uuid(), 'invoice', 'x', 'x', 'standard', 1, gen_random_uuid(), 'p', 'h', '<x/>', null)$$, 'lease was lost', 'commit needs the lease');
select pg_temp.expect_error(format($$select public.zatca_commit(%L, 'invoice', %L, 'n', 'standard', 2, gen_random_uuid(), 'p', 'h', '<x/>', null)$$,
  (select r->>'lease' from z_b1), (select id from z_inv2)), 'chain moved', 'commit checks ICV / PIH');
create temp table z_c1 as select public.zatca_commit((select (r->>'lease')::uuid from z_b1), 'invoice', (select id from z_inv2), (select invoice_number from z_inv2),
  'standard', 1, (select (r->>'uuid')::uuid from z_b1), (select r->>'pih' from z_b1), 'HASH-1', '<Invoice/>', null) as id;
select pg_temp.expect((select last_icv from public.zatca_egs where is_active) = 1 and (select last_hash from public.zatca_egs where is_active) = 'HASH-1', 'chain advanced');
select pg_temp.expect((select zatca_status from public.invoices where id = (select id from z_inv2)) = 'submitting', 'document submitting');
select pg_temp.expect((select public.zatca_begin('invoice', (select id from z_inv2))->>'mode') = 'resend', 'same document again = resend, no new ICV');
-- network failure -> retry with back-off
create temp table z_r1 as select public.zatca_record_result((select id from z_c1), 0, '{"error":"timeout"}') as r;
select pg_temp.expect((select r->>'status' from z_r1) = 'retry', 'timeout -> retry');
select pg_temp.expect((select zatca_status from public.invoices where id = (select id from z_inv2)) = 'retrying', 'document retrying');
select pg_temp.expect((select next_attempt_at from public.zatca_submissions where id = (select id from z_c1)) > now(), 'back-off scheduled');
select pg_temp.expect(not exists (select 1 from public.zatca_queue(50) q where q.doc_id = (select id from z_inv2)), 'not due yet');
-- cleared with a warning
select public.zatca_record_result((select id from z_c1), 202,
  '{"clearanceStatus":"CLEARED","validationResults":{"status":"WARNING","warningMessages":[{"code":"BR-KSA-08","message":"Buyer ID"}],"errorMessages":[]}}',
  '<Invoice>cleared</Invoice>', 'QRFROMZATCA');
select pg_temp.expect((select zatca_status from public.invoices where id = (select id from z_inv2)) = 'cleared', 'cleared');
select pg_temp.expect((select zatca_qr from public.invoices where id = (select id from z_inv2)) = 'QRFROMZATCA', 'ZATCA QR stored');
select pg_temp.expect((select zatca_messages->0->>'code' from public.invoices where id = (select id from z_inv2)) = 'BR-KSA-08', 'warning kept on the invoice');
select pg_temp.expect((select zatca_cleared_at from public.invoices where id = (select id from z_inv2)) is not null, 'cleared time');
select pg_temp.expect((select public.zatca_begin('invoice', (select id from z_inv2))->>'mode') = 'done', 'cleared document is done');

-- B2C: rejected, then re-issued with a new UUID and the next ICV
create temp table z_b3 as select public.zatca_begin('invoice', (select id from z_inv3)) as r;
select pg_temp.expect((select (r->>'icv')::int from z_b3) = 2 and (select r->>'pih' from z_b3) = 'HASH-1', 'ICV 2 chains to HASH-1');
create temp table z_c3 as select public.zatca_commit((select (r->>'lease')::uuid from z_b3), 'invoice', (select id from z_inv3), 'n3', 'simplified', 2,
  (select (r->>'uuid')::uuid from z_b3), 'HASH-1', 'HASH-2', '<Invoice/>', 'OWNQR') as id;
select pg_temp.expect((select api from public.zatca_submissions where id = (select id from z_c3)) = 'reporting', 'B2C goes to reporting');
select public.zatca_record_result((select id from z_c3), 400, '{"reportingStatus":"NOT_REPORTED","validationResults":{"errorMessages":[{"code":"BR-KSA-37","message":"bad"}]}}');
select pg_temp.expect((select zatca_status from public.invoices where id = (select id from z_inv3)) = 'rejected', 'rejected');
create temp table z_b4 as select public.zatca_begin('invoice', (select id from z_inv3)) as r;
select pg_temp.expect((select r->>'mode' from z_b4) = 'sign' and (select (r->>'icv')::int from z_b4) = 3 and (select r->>'pih' from z_b4) = 'HASH-2', 'rejected document re-signed with the next link (the chain counts it)');
select pg_temp.expect((select (r->>'uuid')::uuid from z_b4) <> (select (r->>'uuid')::uuid from z_b3), 'new UUID on re-issue');
select public.zatca_release((select (r->>'lease')::uuid from z_b4));
select pg_temp.expect((select lease_token from public.zatca_egs where is_active) is null, 'lease released');
select pg_temp.expect((select count(*) from public.zatca_queue(50) q where q.doc_id = (select id from z_inv3)) = 0, 'rejected waits for a fix, not auto-retried');
-- 409 duplicate counts as done
create temp table z_b5 as select public.zatca_begin('invoice', (select id from z_inv3)) as r;
create temp table z_c5 as select public.zatca_commit((select (r->>'lease')::uuid from z_b5), 'invoice', (select id from z_inv3), 'n3', 'simplified', 3,
  (select (r->>'uuid')::uuid from z_b5), 'HASH-2', 'HASH-3', '<Invoice/>', 'OWNQR2') as id;
select public.zatca_record_result((select id from z_c5), 409, '{}');
select pg_temp.expect((select zatca_status from public.invoices where id = (select id from z_inv3)) = 'reported' and (select zatca_qr from public.invoices where id = (select id from z_inv3)) = 'OWNQR2', '409 = reported, own QR kept');
select pg_temp.expect((select count(*) from public.zatca_submissions where doc_id = (select id from z_inv3)) = 2, 'two submissions on record');

-- audit log never stores the keys
update public.zatca_egs set private_key_enc = 'v1:secret' where is_active;
select pg_temp.expect(exists (select 1 from public.audit_log where table_name = 'zatca_egs' and 'private_key_enc' = any(changed) and new_row->>'private_key_enc' = '(set)'), 'key change is audited');
select pg_temp.expect(not exists (select 1 from public.audit_log where table_name = 'zatca_egs' and (old_row::text like '%v1:secret%' or new_row::text like '%v1:secret%')), 'key value never in the audit log');

select 'ZATCA OK' as result;
