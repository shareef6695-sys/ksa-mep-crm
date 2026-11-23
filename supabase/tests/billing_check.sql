-- =====================================================================
-- billing_check.sql — proves 0016. LOCAL TEST DATABASE ONLY.
-- Order: any full chain up to 0016 (run_sql_tests.sh runs it after notifications_check). Prints "BILLING OK".
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
create or replace function pg_temp.comm(p_inv text) returns public.commission_ledger language sql security definer as $$ select * from public.commission_ledger where invoice_id = p_inv $$;
create or replace function pg_temp.gl(p_doc text, p_acct text) returns numeric language sql security definer as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.gl_journal_lines l join public.gl_journal_entries e on e.id = l.entry_id
  where e.source_doc_number = p_doc and l.account_code = p_acct $$;
grant execute on all functions in schema pg_temp to authenticated;

\set fin   '00000000-0000-0000-0000-0000000000f1'
\set mgr   '00000000-0000-0000-0000-0000000000b1'
\set sales '00000000-0000-0000-0000-0000000000c1'
\set salesit '00000000-0000-0000-0000-0000000000c2'

select pg_temp.as_user(null);
reset role;
insert into public.customers (id, name_en, customer_type, vat_number, credit_limit_sar, building_no, street, district, city, postal_code) values
  ('cust-bil', 'Commission Towers Co', 'B2B', '300121212100003', 0, '1234', 'Corniche Rd', 'Al Shati', 'Jeddah', '23511')
on conflict (id) do nothing;
insert into public.inquiries (id, data) values ('Q-BIL', '{"id":"Q-BIL","refNo":"INQ-BIL","clientName":"Commission Towers Co","customerId":"cust-bil",
  "salesmanId":"00000000-0000-0000-0000-0000000000c1","assignedSalesName":"Sami Sales","commissionPct":10,"marginPercent":20,"division":"MEP",
  "boqItems":[{"id":"a","desc":"Ductwork","qty":10,"buyCurrency":"SAR","buyUnitCost":100}]}') on conflict (id) do nothing;
set role authenticated;

-- ---------- 1. commission on a progress claim ----------
select pg_temp.as_user(:'mgr');
create temp table bso as select * from public.post_sales_order('Q-BIL');
select pg_temp.expect((select commission_pct from bso) > 0, 'SO carries the salesman commission %');
create temp table bp as select * from public.save_project('{"name":"Commission Towers","customer_id":"cust-bil","billing_method":"percent","contract_value_sar":1000000,
  "retention_pct":10,"budget":{"revenue":1000000,"material":500000,"labour":150000,"subcontract":50000}}');
select public.link_sales_order_to_project((select id from bso), (select id from bp));
select pg_temp.as_user(:'fin');
create temp table bc1 as select * from public.post_progress_invoice((select id from bp), '{"percentComplete":50}');
-- expected margin 30% of SAR 500,000 work done = 150,000 profit
select pg_temp.eq((pg_temp.comm((select id from bc1))).net_profit_sar, 150000, 'commission base = work done x project margin');
select pg_temp.eq((pg_temp.comm((select id from bc1))).total_eligible_commission_sar, 150000 * (select commission_pct from bso) / 100, 'eligible = base x SO commission %');
select pg_temp.eq((pg_temp.comm((select id from bc1))).unlocked_commission_sar, 0, 'nothing unlocked before payment');
select public.post_customer_receipt((select id from bc1), (select grand_total_sar from bc1), 'Bank Transfer', 'TT-BIL', current_date);
select pg_temp.eq((pg_temp.comm((select id from bc1))).unlocked_commission_sar, (pg_temp.comm((select id from bc1))).total_eligible_commission_sar, 'unlocked when the claim is paid');
create temp table brr as select * from public.post_retention_release((select id from bp), 10000);
select pg_temp.expect((pg_temp.comm((select id from brr))).id is null, 'no commission on a retention release');

-- ---------- 2. commission on contract invoices ----------
select pg_temp.as_user(:'salesit');
create temp table bk as select * from public.save_contract(jsonb_build_object('title','Network AMC','customer_id','cust-bil','start_date',(date_trunc('month', current_date))::date,
  'end_date',(date_trunc('month', current_date) + interval '12 months')::date - 1,'billing_frequency','monthly','lines','[{"desc":"Network support","qty":1,"monthlySar":2000}]'::jsonb));
select pg_temp.expect_error(format($$select public.set_contract_commission(%L, 5)$$, (select id from bk)), 'cannot do this', 'sales cannot set their own commission');
select pg_temp.as_user(:'mgr');
select pg_temp.expect_error(format($$select public.set_contract_commission(%L, 60)$$, (select id from bk)), 'between 0 and 50', 'commission capped');
select public.set_contract_commission((select id from bk), 5);
select public.activate_contract((select id from bk));
select pg_temp.as_user(:'fin');
select public.generate_contract_drafts(null, (select id from bk));
create temp table bki as select * from public.post_contract_invoice((select id from public.contract_billing_periods where contract_id = (select id from bk) order by period_no limit 1));
select pg_temp.eq((pg_temp.comm((select id from bki))).total_eligible_commission_sar, 100, '5% of SAR 2,000');
select pg_temp.expect((pg_temp.comm((select id from bki))).salesman_id = :'salesit', 'contract salesman earns it');

-- ---------- 3. invoicing a chargeable ticket ----------
select pg_temp.as_user(:'sales');
create temp table bt as select * from public.open_service_ticket('{"customer_id":"cust-bil","subject":"Server room AC alarm","chargeable":true}');
select pg_temp.as_user(:'fin');
select pg_temp.expect_error(format($$select public.invoice_service_ticket(%L)$$, (select id from bt)), 'Resolve ticket', 'only resolved tickets');
select public.update_service_ticket((select id from bt), '{"status":"resolved","resolution":"Sensor replaced","labour_hours":2,"chargeable_sar":400}');
select pg_temp.as_user(:'sales');
select pg_temp.expect_error(format($$select public.invoice_service_ticket(%L)$$, (select id from bt)), 'cannot do this', 'sales cannot invoice');
select pg_temp.as_user(:'fin');
create temp table bti as select * from public.invoice_service_ticket((select id from bt));
select pg_temp.expect((select invoice_kind from bti) = 'service' and (select invoice_type from bti) = 'standard', 'service tax invoice');
select pg_temp.eq((select grand_total_sar from bti), 460, '400 + VAT');
select pg_temp.eq(pg_temp.gl((select invoice_number from bti), case when (select division from bt) = 'MEP' then '4010' else '4020' end), -400, 'revenue posted');
select pg_temp.expect((select invoice_number from public.service_tickets where id = (select id from bt)) = (select invoice_number from bti), 'ticket keeps the invoice number');
select pg_temp.expect_error(format($$select public.invoice_service_ticket(%L)$$, (select id from bt)), 'already been invoiced', 'one invoice per ticket');

select pg_temp.as_user(null);
reset role;
select 'BILLING OK';
