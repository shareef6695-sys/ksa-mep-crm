-- =====================================================================
-- sales_check.sql — proves 0013. LOCAL TEST DATABASE ONLY.
-- Order: the procurement_check.sql order (procurement_check optional), then 0013, then this file. Prints "SALES OK".
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
create or replace function pg_temp.q(p_id text) returns jsonb language sql security definer as $$ select data from public.inquiries where id = p_id $$;
create or replace function pg_temp.so(p_id text) returns public.sales_orders language sql security definer as $$ select * from public.sales_orders where id = p_id $$;
grant execute on all functions in schema pg_temp to authenticated;

\set admin '00000000-0000-0000-0000-0000000000a1'
\set fin   '00000000-0000-0000-0000-0000000000f1'
\set mgr   '00000000-0000-0000-0000-0000000000b1'
\set proc  '00000000-0000-0000-0000-0000000000d1'
\set sales '00000000-0000-0000-0000-0000000000c1'

select pg_temp.as_user(null);
reset role;
insert into public.customers (id, name_en, customer_type, vat_number, credit_limit_sar, payment_terms) values
  ('cust-cr', 'Tight Credit Trading', 'B2B', '300444444400003', 1000, 'Net 60'),
  ('cust-open', 'Open Account Co', 'B2B', '300555555500003', 0, 'Net 30')
on conflict (id) do nothing;
-- low-margin quote (5%) by Sami Sales
insert into public.inquiries (id, data) values ('Q-LOW', '{"id":"Q-LOW","refNo":"INQ-LOW","clientName":"Open Account Co","customerId":"cust-open","salesmanId":"00000000-0000-0000-0000-0000000000c1",
  "assignedSalesName":"Sami Sales","marginPercent":5,"stage":"new_inquiry","boqItems":[{"id":"a","desc":"Cable tray","qty":10,"buyCurrency":"SAR","buyUnitCost":100}]}');
set role authenticated;

-- ---------- 1. quote approval ----------
select pg_temp.as_user(:'sales');
select pg_temp.expect((select needed from public.quote_approvals() where inquiry_id = 'Q-LOW') and not (select approved from public.quote_approvals() where inquiry_id = 'Q-LOW'), 'low margin needs approval');
select pg_temp.expect((select reasons->>0 from public.quote_approvals() where inquiry_id = 'Q-LOW') = 'margin is below the approval floor', 'sales do not see the margin figure');
-- a salesman cannot approve by saving a forged approval
select public.save_inquiry('Q-LOW', pg_temp.q('Q-LOW') || '{"approval":{"status":"approved","fingerprint":"x"},"managerApproved":true,"stage":"won"}');
select pg_temp.expect(not (pg_temp.q('Q-LOW') ? 'approval') and pg_temp.q('Q-LOW')->>'stage' = 'new_inquiry', 'approval / stage cannot be set by saving');
select pg_temp.expect(pg_temp.q('Q-LOW')->>'revision' = 'A' and pg_temp.q('Q-LOW')->>'validUntil' is not null, 'revision A, validity date');
select pg_temp.expect_error($$select public.approve_quote('Q-LOW')$$, 'cannot do this', 'sales cannot approve');
select pg_temp.as_user(:'mgr');
select pg_temp.expect_error($$select public.post_sales_order('Q-LOW')$$, 'needs manager approval', 'SO blocked until approved');
select public.approve_quote('Q-LOW', 'Strategic customer');
select pg_temp.expect((pg_temp.q('Q-LOW')->'approval'->>'by') is not null and (select approved from public.quote_approvals() where inquiry_id = 'Q-LOW'), 'approved, approver recorded');
-- pricing changed after approval -> stale
select public.save_inquiry('Q-LOW', jsonb_set(pg_temp.q('Q-LOW'), '{marginPercent}', '4'));
select pg_temp.expect((select stale from public.quote_approvals() where inquiry_id = 'Q-LOW'), 'approval voided by a price change');
select pg_temp.expect_error($$select public.post_sales_order('Q-LOW')$$, 'pricing changed', 'stale approval refused');
select public.approve_quote('Q-LOW');
create temp table s_so1 as select * from public.post_sales_order('Q-LOW');
select pg_temp.as_user(:'sales');
select pg_temp.expect(not ((select data from public.inquiries_v where id = 'Q-LOW')->'approval' ? 'marginPercent'), 'approval margin hidden from sales');
select pg_temp.as_user(:'mgr');
select pg_temp.expect((select payment_terms from s_so1) = 'Net 30', 'SO terms from the customer');
select pg_temp.expect(pg_temp.q('Q-LOW')->>'stage' = 'won', 'won');
select pg_temp.expect_error($$select public.save_inquiry('Q-LOW', pg_temp.q('Q-LOW'))$$, 'already a sales order', 'a converted quote cannot be edited');
-- own quote
reset role; select pg_temp.as_user(null);
insert into public.inquiries (id, data) values ('Q-OWN', '{"id":"Q-OWN","refNo":"INQ-OWN","clientName":"Open Account Co","salesmanId":"00000000-0000-0000-0000-0000000000b1",
  "marginPercent":2,"boqItems":[{"id":"a","desc":"x","qty":1,"buyCurrency":"SAR","buyUnitCost":100}]}');
-- big quote: above SAR 250,000
insert into public.inquiries (id, data) values ('Q-BIG', '{"id":"Q-BIG","refNo":"INQ-BIG","clientName":"Open Account Co","salesmanId":"00000000-0000-0000-0000-0000000000c1",
  "marginPercent":20,"boqItems":[{"id":"a","desc":"Chiller plant","qty":1,"buyCurrency":"SAR","buyUnitCost":240000}]}');
set role authenticated;
select pg_temp.as_user(:'mgr');
select pg_temp.expect_error($$select public.approve_quote('Q-OWN')$$, 'your own quote', 'no self-approval');
select pg_temp.expect((select reasons->>0 from public.quote_approvals() where inquiry_id = 'Q-BIG') like 'value SAR 300,000.00 is above%', 'value threshold reason');
select pg_temp.as_user(:'admin');
select public.approve_quote('Q-OWN');

-- ---------- 2. revisions, stages, pipeline ----------
reset role; select pg_temp.as_user(null);
insert into public.inquiries (id, data) values ('Q-REV', '{"id":"Q-REV","refNo":"INQ-REV","clientName":"Open Account Co","salesmanId":"00000000-0000-0000-0000-0000000000c1",
  "marginPercent":25,"division":"IT & ELV","boqItems":[{"id":"a","desc":"CCTV","qty":4,"buyCurrency":"SAR","buyUnitCost":500}]}');
set role authenticated;
select pg_temp.as_user(:'sales');
select public.set_quote_stage('Q-REV', 'quoted');
select public.revise_quote('Q-REV', 'Customer asked for 6 cameras');
select pg_temp.expect(pg_temp.q('Q-REV')->>'revision' = 'B', 'Rev B');
select pg_temp.expect((select count(*) from public.quote_revisions where inquiry_id = 'Q-REV' and revision = 'A') = 1, 'Rev A kept in history');
select public.revise_quote('Q-REV');
select pg_temp.expect(pg_temp.q('Q-REV')->>'revision' = 'C', 'Rev C');
select pg_temp.expect_error($$select public.set_quote_stage('Q-REV', 'won')$$, 'converting to a sales order', 'won only through an SO');
select pg_temp.expect_error($$select public.set_quote_stage('Q-REV', 'lost')$$, 'why the quote was lost', 'lost needs a reason');
select public.set_quote_stage('Q-REV', 'lost', 'PRICE', 'Competitor 8% cheaper');
select pg_temp.expect((select quotes from public.sales_pipeline() where stage = 'lost' and lost_reason = 'PRICE' and division = 'IT & ELV') >= 1, 'pipeline by stage / reason / division');
select pg_temp.expect(not exists (select 1 from public.sales_pipeline() where salesman_id is distinct from '00000000-0000-0000-0000-0000000000c1'), 'sales see only their own pipeline');
select pg_temp.as_user(:'proc');
select pg_temp.expect_error($$select public.revise_quote('Q-REV')$$, 'own quotes', 'procurement cannot revise quotes');

-- ---------- 3. credit control ----------
reset role; select pg_temp.as_user(null);
insert into public.inquiries (id, data) values ('Q-CR1', '{"id":"Q-CR1","refNo":"INQ-CR1","clientName":"Tight Credit Trading","customerId":"cust-cr","salesmanId":"00000000-0000-0000-0000-0000000000c1",
  "marginPercent":20,"boqItems":[{"id":"a","desc":"Pump","qty":1,"buyCurrency":"SAR","buyUnitCost":800}]}');
insert into public.inquiries (id, data) values ('Q-CR2', '{"id":"Q-CR2","refNo":"INQ-CR2","clientName":"Tight Credit Trading","customerId":"cust-cr","salesmanId":"00000000-0000-0000-0000-0000000000c1",
  "marginPercent":20,"boqItems":[{"id":"a","desc":"Pump","qty":1,"buyCurrency":"SAR","buyUnitCost":80}]}');
set role authenticated;
select pg_temp.as_user(:'sales');
select pg_temp.expect(jsonb_array_length(public.credit_status('cust-cr', null, 1150)->'problems') = 1, 'credit status shows the problem');
select pg_temp.as_user(:'mgr');
select pg_temp.expect_error($$select public.post_sales_order('Q-CR1')$$, 'exceed the credit limit', 'SO over the limit blocked');
select pg_temp.expect_error($$select public.grant_credit_override('SO', 'Q-CR1', 'ok')$$, 'cannot do this', 'manager cannot override credit');
select pg_temp.as_user(:'fin');
select pg_temp.expect_error($$select public.grant_credit_override('SO', 'Q-CR1', '')$$, 'reason', 'override needs a reason');
select public.grant_credit_override('SO', 'Q-CR1', 'Bank guarantee received');
select pg_temp.as_user(:'mgr');
create temp table s_so2 as select * from public.post_sales_order('Q-CR1');
select pg_temp.expect((select used_doc from public.credit_overrides where ref_id = 'Q-CR1') = (select so_number from s_so2), 'override used once, by this SO');
select pg_temp.expect((select payment_terms from s_so2) = 'Net 60', 'customer terms on the SO');
select pg_temp.expect_error($$select public.post_sales_order('Q-CR2')$$, 'exceed the credit limit', 'the next SO is checked again (open orders count)');
select pg_temp.as_user(:'proc');
create temp table s_dn2 as select * from public.post_delivery_note((select id from s_so2), '{"a":1}');
select pg_temp.as_user(:'fin');
-- invoicing the SO converts its open order value into receivables: same exposure, no second hit
create temp table s_inv2 as select * from public.post_invoice((select id from s_dn2));
select pg_temp.expect((select due_date from s_inv2) = public.riyadh_date((select issued_at from s_inv2)) + 60, 'due date = issue + 60 (Net 60)');
select pg_temp.expect((select bucket from public.ar_aging() where invoice_id = (select id from s_inv2)) = 'current', 'not yet due');
-- overdue blocks even a customer with no limit
reset role; select pg_temp.as_user(null);
update public.invoices set due_date = public._riyadh_today() - 100 where id = (select id from s_inv2);
insert into public.inquiries (id, data) values ('Q-CR3', '{"id":"Q-CR3","refNo":"INQ-CR3","clientName":"Tight Credit Trading","customerId":"cust-cr","salesmanId":"00000000-0000-0000-0000-0000000000c1",
  "marginPercent":20,"boqItems":[{"id":"a","desc":"Seal","qty":1,"buyCurrency":"SAR","buyUnitCost":1}]}');
update public.customers set credit_limit_sar = 0 where id = 'cust-cr';
set role authenticated;
select pg_temp.as_user(:'fin');
select pg_temp.expect((select bucket from public.ar_aging() where invoice_id = (select id from s_inv2)) = '90+' and (select days_past_due from public.ar_aging() where invoice_id = (select id from s_inv2)) = 100, '90+ by days past due');
select pg_temp.as_user(:'mgr');
select pg_temp.expect_error($$select public.post_sales_order('Q-CR3')$$, 'more than 90 days past due', 'overdue invoices block new orders');
select pg_temp.as_user(:'fin');
select public.post_customer_receipt((select id from s_inv2), (select grand_total_sar from s_inv2), 'Bank Transfer', 'TT-CR', current_date);
select pg_temp.as_user(:'mgr');
create temp table s_so3 as select * from public.post_sales_order('Q-CR3');
select pg_temp.expect((select so_number from s_so3) is not null, 'paid up: orders flow again');

-- ---------- 4. SO amendments and cancellation ----------
reset role; select pg_temp.as_user(null);
insert into public.inquiries (id, data) values ('Q-AM', '{"id":"Q-AM","refNo":"INQ-AM","clientName":"Open Account Co","customerId":"cust-open","salesmanId":"00000000-0000-0000-0000-0000000000c1",
  "marginPercent":20,"boqItems":[{"id":"a","desc":"Duct","qty":10,"buyCurrency":"SAR","buyUnitCost":80},{"id":"b","desc":"Grille","qty":5,"buyCurrency":"SAR","buyUnitCost":40}]}');
insert into public.inquiries (id, data) values ('Q-CX', '{"id":"Q-CX","refNo":"INQ-CX","clientName":"Open Account Co","customerId":"cust-open","salesmanId":"00000000-0000-0000-0000-0000000000c1",
  "marginPercent":20,"boqItems":[{"id":"a","desc":"Fan","qty":2,"buyCurrency":"SAR","buyUnitCost":400}]}');
set role authenticated;
select pg_temp.as_user(:'mgr');
create temp table s_am as select * from public.post_sales_order('Q-AM');
select pg_temp.as_user(:'proc');
select public.post_delivery_note((select id from s_am), '{"a":4}');
select pg_temp.as_user(:'sales');
select pg_temp.expect_error($$select public.amend_sales_order((select id from s_am), '[{"id":"a","orderedQty":12}]', 'More')$$, 'cannot do this', 'sales cannot amend');
select pg_temp.as_user(:'mgr');
select pg_temp.expect_error($$select public.amend_sales_order((select id from s_am), '[{"id":"a","orderedQty":3}]', 'Less')$$, 'below the 4 already delivered', 'not below delivered');
select pg_temp.expect_error($$select public.amend_sales_order((select id from s_am), '[{"id":"a","unitSellSar":1}]', 'Price')$$, 'after a delivery', 'no price change after delivery');
select pg_temp.expect_error($$select public.amend_sales_order((select id from s_am), '[{"id":"b","orderedQty":6}]', '')$$, 'reason', 'reason required');
create temp table s_am2 as select * from public.amend_sales_order((select id from s_am), '[{"id":"a","orderedQty":6},{"id":"b","orderedQty":8,"unitSellSar":55}]', 'Revised site take-off');
-- 6 x 100 + 8 x 55 = 1,040 + 15%
select pg_temp.eq((select subtotal_sar from s_am2), 1040, 'totals recomputed');
select pg_temp.eq((select grand_total_sar from s_am2), 1196, 'grand total');
select pg_temp.expect((select status from s_am2) = 'partially_delivered', 'status kept');
select pg_temp.expect((select count(*) from public.sales_order_changes where so_id = (select id from s_am) and change_type = 'amend') = 1, 'change logged');
create temp table s_cx1 as select * from public.cancel_sales_order((select id from s_am), 'Client descoped the rest');
select pg_temp.expect((select status from s_cx1) = 'delivered' and (select (items->1->>'cancelledQty')::numeric from s_cx1) = 8, 'partly delivered SO: rest cancelled, closed as delivered');
select pg_temp.eq((select subtotal_sar from s_cx1), 400, 'only the delivered 4 x 100 remain');
create temp table s_cx as select * from public.post_sales_order('Q-CX');
create temp table s_cx2 as select * from public.cancel_sales_order((select id from s_cx), 'Project on hold');
select pg_temp.expect((select status from s_cx2) = 'cancelled', 'nothing delivered: cancelled');
select pg_temp.expect(pg_temp.q('Q-CX')->>'stage' = 'lost' and pg_temp.q('Q-CX')->>'lostReason' = 'PROJECT_CANCELLED', 'quote marked lost (cancelled)');
select pg_temp.expect_error($$select public.cancel_sales_order((select id from s_cx), 'again')$$, 'nothing left', 'no double cancel');
select pg_temp.as_user(:'sales');
select pg_temp.expect((select count(*) from public.sales_order_changes where so_id = (select id from s_am)) = 2, 'salesman sees the change log of their SO');

select 'SALES OK' as result;
