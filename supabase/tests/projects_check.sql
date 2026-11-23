-- =====================================================================
-- projects_check.sql — proves 0014. LOCAL TEST DATABASE ONLY.
-- Order: the sales_check.sql order (sales_check optional), then 0014, then this file. Prints "PROJECTS OK".
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
-- GL movement of an account for one document (security definer: reads under RLS)
create or replace function pg_temp.gl(p_doc text, p_acct text) returns numeric language sql security definer as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.gl_journal_lines l join public.gl_journal_entries e on e.id = l.entry_id
  where e.source_doc_number = p_doc and l.account_code = p_acct $$;
create or replace function pg_temp.gl_proj(p_project text, p_acct text) returns numeric language sql security definer as $$
  select coalesce(sum(debit - credit), 0) from public.gl_journal_lines where project_id = p_project and account_code = p_acct $$;
create or replace function pg_temp.inv(p_id text) returns public.invoices language sql security definer as $$ select * from public.invoices where id = p_id $$;
create or replace function pg_temp.vat_diff() returns numeric language sql security definer as $$
  select coalesce(vat_sar, 0) from public.vat_return('2000-01-01', '2100-12-31') where box = 'GL-DIFF-OUT' $$;
create or replace function pg_temp.zp(t text, i text) returns jsonb language sql security definer as $$ select public.zatca_doc_payload(t, i) $$;
grant execute on all functions in schema pg_temp to authenticated;

\set admin '00000000-0000-0000-0000-0000000000a1'
\set fin   '00000000-0000-0000-0000-0000000000f1'
\set mgr   '00000000-0000-0000-0000-0000000000b1'
\set proc  '00000000-0000-0000-0000-0000000000d1'
\set sales '00000000-0000-0000-0000-0000000000c1'
\set salesit '00000000-0000-0000-0000-0000000000c2'

select pg_temp.as_user(null);
reset role;
insert into public.app_settings (key, value) values ('company_profile', '{"nameEn":"Horizon Business Solutions Est.","vatNumber":"300000000000003","crNumber":"4030000000","buildingNo":"7788","street":"Tahlia St","district":"Al Andalus","city":"Jeddah","postalCode":"23326"}')
on conflict (key) do nothing;
insert into public.customers (id, name_en, customer_type, vat_number, credit_limit_sar, payment_terms, building_no, street, district, city, postal_code) values
  ('cust-prj', 'Red Sea Towers Co', 'B2B', '300666666600003', 0, 'Net 30', '1234', 'Corniche Rd', 'Al Shati', 'Jeddah', '23511'),
  ('cust-boq', 'Small Builder Est', 'B2B', '300777777700003', 5000, 'Net 30', '4321', 'Madinah Rd', 'Al Rawdah', 'Jeddah', '23435'),
  ('cust-amc', 'Data Centre Co', 'B2B', '300888888800003', 0, 'Net 30', '5555', 'Prince Sultan', 'Al Zahra', 'Jeddah', '23424')
on conflict (id) do nothing;
insert into public.inquiries (id, data) values ('Q-PRJ', '{"id":"Q-PRJ","refNo":"INQ-PRJ","clientName":"Red Sea Towers Co","customerId":"cust-prj","salesmanId":"00000000-0000-0000-0000-0000000000c1",
  "assignedSalesName":"Sami Sales","marginPercent":20,"division":"MEP","boqItems":[{"id":"a","desc":"Chilled water pipework","qty":10,"buyCurrency":"SAR","buyUnitCost":100}]}')
on conflict (id) do nothing;
insert into public.items (id, name_en, uom, is_serialized) values ('itm-cam', 'IP camera 4MP', 'PCS', true) on conflict (id) do nothing;
insert into public.item_serials (item_id, serial, status, delivered_at, warranty_end) values
  ('itm-cam', 'CAM-W-001', 'delivered', now(), current_date + 200),
  ('itm-cam', 'CAM-X-002', 'delivered', now() - interval '3 years', current_date - 10),
  ('itm-cam', 'CAM-X-003', 'delivered', now() - interval '3 years', current_date - 10)
on conflict do nothing;
set role authenticated;

select pg_temp.as_user(:'fin');
create temp table vat0 as select pg_temp.vat_diff() as d;

-- ---------- 1. project master, roles ----------
select pg_temp.as_user(:'sales');
select pg_temp.expect_error($$select public.save_project('{"name":"x","customer_id":"cust-prj"}')$$, 'cannot do this', 'sales cannot create projects');
select pg_temp.as_user(:'mgr');
select pg_temp.expect_error($$select public.save_project('{"name":"Towers","customer_id":"cust-prj","billing_method":"percent"}')$$, 'contract value', 'percent billing needs a contract value');
create temp table p1 as select * from public.save_project('{"name":"Red Sea Towers MEP","customer_id":"cust-prj","division":"MEP","cost_centre":"CC-RST",
  "billing_method":"percent","contract_value_sar":1000000,"retention_pct":10,"advance_pct":10,
  "budget":{"revenue":1000000,"material":500000,"labour":150000,"subcontract":100000,"other":20000}}');
select pg_temp.expect((select project_code from p1) like 'PROJ-%' and (select client_vat from p1) = '300666666600003', 'project numbered, VAT from customer');
select pg_temp.as_user(:'sales');
select pg_temp.eq((select count(*) from public.projects), 0, 'sales cannot read projects (budgets, costs)');

-- SO linked to the project
select pg_temp.as_user(:'mgr');
create temp table p1so as select * from public.post_sales_order('Q-PRJ');
select pg_temp.expect_error(format($$select public.link_sales_order_to_project(%L, %L)$$, (select id from p1so), 'nope'), 'not found', 'unknown project');
select public.link_sales_order_to_project((select id from p1so), (select id from p1));
select pg_temp.expect((select main_so_id from public.projects where id = (select id from p1)) = (select id from p1so), 'first SO becomes the main SO');
select pg_temp.as_user(:'proc');
create temp table p1dn as select * from public.post_delivery_note((select id from p1so), '{"a":2}');
select pg_temp.as_user(:'fin');
select pg_temp.expect_error(format($$select public.post_invoice(%L)$$, (select id from p1dn)), 'billed by progress claims', 'no per-delivery invoice on a claim-billed project');

-- ---------- 2. project costs: material PO, subcontract PO, labour expense ----------
select pg_temp.as_user(:'proc');
create temp table p1po as select * from public.post_purchase_order(jsonb_build_object('supplier_name','Pipe Supplier','supplier_vat','300999999900003','currency','SAR','fx_rate',1,
  'project_id', (select id from p1), 'items', '[{"desc":"Pipes (site delivery)","qty":10,"unitCostFx":1000,"vatCategory":"S"}]'::jsonb));
create temp table p1po2 as select * from public.post_purchase_order(jsonb_build_object('supplier_name','Insulation Subcon','supplier_vat','300999999900003','currency','SAR','fx_rate',1,
  'so_id', (select id from p1so), 'cost_type', 'subcontract', 'items', '[{"desc":"Insulation works","qty":1,"unitCostFx":8000,"vatCategory":"S"}]'::jsonb));
select pg_temp.expect((select project_id from p1po2) = (select id from p1) and (select cost_type from p1po2) = 'subcontract', 'PO takes the SO''s project');
select public.post_goods_receipt((select id from p1po));
select public.post_goods_receipt((select id from p1po2));
select pg_temp.as_user(:'fin');
select public.post_supplier_bill((select id from p1po), '{"supplierInvoiceNo":"PS-1"}');
select public.post_supplier_bill((select id from p1po2), '{"supplierInvoiceNo":"IS-1"}');
select public.post_expense_voucher(jsonb_build_object('payee','Site labour contractor','expense_account_code','5310','amount_sar',5000,'project_id',(select id from p1)));
select pg_temp.eq(pg_temp.gl_proj((select id from p1), '5010'), 10000, 'material bill on the project (5010)');
select pg_temp.eq(pg_temp.gl_proj((select id from p1), '5300'), 8000, 'subcontract bill on the project (5300)');
select pg_temp.eq(pg_temp.gl_proj((select id from p1), '5310'), 5000, 'labour expense on the project (5310)');
select pg_temp.eq(pg_temp.gl_proj((select id from p1), '2010'), -18000 - 2700, 'AP lines carry the project too');

-- ---------- 3. advance invoice ----------
select pg_temp.as_user(:'mgr');
select pg_temp.expect_error(format($$select public.post_advance_invoice(%L)$$, (select id from p1)), 'cannot do this', 'manager cannot bill');
select pg_temp.as_user(:'fin');
select pg_temp.expect_error(format($$select public.post_advance_invoice(%L, 2000000)$$, (select id from p1)), 'exceed the contract value', 'advance capped by contract');
create temp table adv as select * from public.post_advance_invoice((select id from p1));
select pg_temp.expect((select invoice_kind from adv) = 'advance' and (select invoice_type from adv) = 'standard', 'advance invoice, B2B');
select pg_temp.eq((select grand_total_sar from adv), 115000, 'advance 10% + VAT');
select pg_temp.eq(pg_temp.gl((select invoice_number from adv), '2060'), -100000, 'Cr 2060 advance billings');
select pg_temp.eq(pg_temp.gl((select invoice_number from adv), '2100'), -15000, 'VAT due on the advance');
select pg_temp.expect((pg_temp.zp('invoice', (select id from adv))->>'prepayment')::boolean, 'ZATCA payload: type 386');

-- ---------- 4. progress claim 30% ----------
create temp table c1 as select * from public.post_progress_invoice((select id from p1), '{"percentComplete":30}');
select pg_temp.eq((select subtotal_sar from c1), 270000, 'claim 1 net of 10% retention');
select pg_temp.eq((select vat_sar from c1), 40500, 'VAT on the claim (XML)');
select pg_temp.eq((select retention_sar from c1), 30000, 'retention held');
select pg_temp.eq((select prepaid_sar from c1), 34500, 'advance deducted 30,000 + VAT 4,500');
select pg_temp.eq((select grand_total_sar from c1), 276000, 'payable = 270,000 + 40,500 - 34,500');
select pg_temp.eq(pg_temp.gl((select invoice_number from c1), '1100'), 276000, 'Dr AR payable');
select pg_temp.eq(pg_temp.gl((select invoice_number from c1), '1110'), 30000, 'Dr 1110 retention');
select pg_temp.eq(pg_temp.gl((select invoice_number from c1), '2060'), 30000, 'Dr 2060 advance deducted');
select pg_temp.eq(pg_temp.gl((select invoice_number from c1), '4010'), -300000, 'revenue = work done 30%');
select pg_temp.eq(pg_temp.gl((select invoice_number from c1), '2100'), -36000, 'output VAT = 40,500 - 4,500 already declared');
select pg_temp.expect((pg_temp.zp('invoice', (select id from c1))->'prepayments'->0->>'id') = (select invoice_number from adv)
                      and (pg_temp.zp('invoice', (select id from c1))->'prepayments'->0->>'taxable')::numeric = 30000
                      and (pg_temp.zp('invoice', (select id from c1))->>'prepaid')::numeric = 34500, 'ZATCA payload references the 386 invoice');
select pg_temp.expect_error(format($$select public.post_progress_invoice(%L, '{"percentComplete":25}')$$, (select id from p1)), 'cumulative', 'claims are cumulative');
select pg_temp.expect_error(format($$select public.post_credit_note(%L, '[0.1]', 'Over-claimed', 'PRICE_ADJUSTMENT')$$, (select id from c1)), 'next claim', 'no credit notes on claims');
select pg_temp.expect_error(format($$select public.save_project(jsonb_build_object('id', %L, 'name', 'x', 'customer_id', 'cust-prj', 'billing_method', 'percent', 'contract_value_sar', 1000000, 'retention_pct', 5))$$, (select id from p1)),
  'can no longer change', 'retention fixed once billed');

-- ---------- 5. final claim, retention release ----------
create temp table c2 as select * from public.post_progress_invoice((select id from p1), '{"percentComplete":100}');
select pg_temp.eq((select subtotal_sar from c2), 630000, 'final claim net');
select pg_temp.eq((select prepaid_sar from c2), 80500, 'rest of the advance deducted (70,000 + VAT)');
select pg_temp.eq((select grand_total_sar from c2), 644000, 'final payable');
select pg_temp.expect(((select billing from c2)->>'final')::boolean, 'flagged final');
select pg_temp.eq((public.project_billing((select id from p1))->>'advanceRemaining')::numeric, 0, 'advance fully applied');
select pg_temp.eq((public.project_billing((select id from p1))->>'retentionHeld')::numeric, 100000, 'retention held 10%');
select pg_temp.expect_error(format($$select public.post_progress_invoice(%L, '{"percentComplete":100}')$$, (select id from p1)), 'not above', 'nothing left to claim');
select pg_temp.expect_error(format($$select public.post_credit_note(%L, '[1]', 'Refund', 'OTHER')$$, (select id from adv)), 'has not been deducted', 'deducted advance cannot be credited');
select pg_temp.expect_error(format($$select public.post_retention_release(%L, 100001)$$, (select id from p1)), 'retention is held', 'release capped');
create temp table rr as select * from public.post_retention_release((select id from p1));
select pg_temp.eq((select grand_total_sar from rr), 115000, 'retention release + VAT');
select pg_temp.eq(pg_temp.gl((select invoice_number from rr), '1110'), -100000, 'Cr 1110');
select pg_temp.eq(pg_temp.gl((select invoice_number from rr), '2100'), -15000, 'VAT charged on release');
select pg_temp.eq(pg_temp.gl_proj((select id from p1), '2060'), 0, '2060 cleared');
select pg_temp.eq(pg_temp.gl_proj((select id from p1), '1110'), 0, '1110 cleared');
select pg_temp.eq(pg_temp.gl_proj((select id from p1), '2100'), -150000, 'VAT on the project = 15% of the contract');
select pg_temp.eq(pg_temp.gl_proj((select id from p1), '1100'), 115000 + 276000 + 644000 + 115000, 'AR = contract + VAT');

-- job cost
select pg_temp.eq((select revenue_sar from public.project_job_cost((select id from p1))), 1000000, 'job cost revenue');
select pg_temp.eq((select material_sar from public.project_job_cost((select id from p1))), 10000, 'job cost material');
select pg_temp.eq((select subcontract_sar from public.project_job_cost((select id from p1))), 8000, 'job cost subcontract');
select pg_temp.eq((select labour_sar from public.project_job_cost((select id from p1))), 5000, 'job cost labour');
select pg_temp.eq((select margin_sar from public.project_job_cost((select id from p1))), 977000, 'job cost margin');
select pg_temp.expect((select count(*) from public.project_cost_lines((select id from p1))) = 5, 'cost line drill-down');
select pg_temp.as_user(:'sales');
select pg_temp.expect_error($$select * from public.project_job_cost()$$, 'cannot do this', 'sales cannot see job cost');

-- ---------- 6. BOQ billing, credit control on a claim ----------
select pg_temp.as_user(:'mgr');
create temp table p2 as select * from public.save_project('{"name":"Villa fit-out","customer_id":"cust-boq","billing_method":"boq","retention_pct":5,
  "boq":[{"code":"A1","description":"Cable tray","unit":"M","qty":100,"rate":50},{"code":"B1","description":"DB panel","unit":"NOS","qty":10,"rate":1000}]}');
select pg_temp.eq((select contract_value_sar from p2), 15000, 'BOQ contract value = sum of qty x rate');
select pg_temp.as_user(:'fin');
create temp table b1 as select * from public.post_progress_invoice((select id from p2), '{"quantities":{"A1":40}}');
select pg_temp.eq((select subtotal_sar from b1), 1900, 'BOQ claim 1: 40 x 47.50');
select pg_temp.eq((select retention_sar from b1), 100, '5% retention on 2,000');
select pg_temp.expect_error(format($$select public.post_progress_invoice(%L, '{"quantities":{"A1":30}}')$$, (select id from p2)), 'below what has already been claimed', 'BOQ qty is cumulative');
select pg_temp.expect_error(format($$select public.post_progress_invoice(%L, '{"quantities":{"A1":101}}')$$, (select id from p2)), 'more than the BOQ quantity', 'BOQ qty capped');
select pg_temp.expect_error(format($$select public.post_progress_invoice(%L, '{"quantities":{"A1":100,"B1":10}}')$$, (select id from p2)), 'credit limit', 'claim over the credit limit blocked');
select public.grant_credit_override('INVOICE', (select id from p2), 'Client paid claim 1 by cheque');
create temp table b2 as select * from public.post_progress_invoice((select id from p2), '{"quantities":{"A1":100,"B1":10}}');
select pg_temp.eq((select subtotal_sar from b2), 12350, 'BOQ claim 2: 60 x 47.50 + 10 x 950');
select pg_temp.eq((select retention_sar from b2), 650, 'retention on 13,000');
select pg_temp.eq(pg_temp.gl((select invoice_number from b2), '4010'), -13000, 'revenue = BOQ value done');
select pg_temp.eq(((public.project_billing((select id from p2))->'boqQty')->>'B1')::numeric, 10, 'BOQ quantities claimed');

-- ---------- 7. IT contracts ----------
select pg_temp.as_user(:'salesit');
create temp table k1 as select * from public.save_contract(jsonb_build_object('title','CCTV AMC','customer_id','cust-amc','contract_type','amc',
  'start_date', (date_trunc('month', current_date) - interval '2 months')::date, 'end_date', (date_trunc('month', current_date) + interval '10 months')::date - 1,
  'billing_frequency','quarterly','billing_timing','advance','deferred_revenue',true,'sla_response_hours',6,
  'lines','[{"desc":"CCTV preventive maintenance","qty":20,"monthlySar":50}]'::jsonb));
select pg_temp.expect((select salesman_id from k1) = :'salesit' and (select status from k1) = 'draft', 'sales creates a draft, owned by them');
select pg_temp.eq((select monthly_value_sar from k1), 1000, 'monthly value');
select pg_temp.expect_error(format($$select public.activate_contract(%L)$$, (select id from k1)), 'cannot do this', 'sales cannot activate');
select pg_temp.as_user(:'sales');
select pg_temp.eq((select count(*) from public.service_contracts where id = (select id from k1)), 0, 'other salesman cannot see it');
select pg_temp.as_user(:'mgr');
select public.activate_contract((select id from k1));
select public.save_contract(jsonb_build_object('id', (select id from k1), 'covered_serials', '["CAM-X-002"]'::jsonb));
select pg_temp.as_user(:'fin');
select pg_temp.eq(public.generate_contract_drafts(null, (select id from k1)), 1, 'one quarter due (billed in advance)');
select pg_temp.eq(public.generate_contract_drafts(null, (select id from k1)), 0, 'running it again makes nothing new');
create temp table d1 as select * from public.contract_billing_periods where contract_id = (select id from k1);
select pg_temp.eq((select amount_sar from d1), 3000, 'quarter = 20 x 3 months x 50');
select public.update_contract_draft((select id from d1), jsonb_set((select lines from d1), '{0,qty}', '57'), 'Three cameras removed in month 1');
select pg_temp.eq((select amount_sar from public.contract_billing_periods where id = (select id from d1)), 2850, 'draft edited before posting');
create temp table ki as select * from public.post_contract_invoice((select id from d1));
select pg_temp.expect((select invoice_kind from ki) = 'contract' and (select contract_id from ki) = (select id from k1), 'contract invoice');
select pg_temp.eq((select grand_total_sar from ki), 3277.5, '2,850 + VAT');
select pg_temp.eq(pg_temp.gl((select invoice_number from ki), '2400'), -2850, 'deferred revenue');
select pg_temp.eq((select sum(amount_sar) from public.deferred_revenue_schedule where invoice_id = (select id from ki)), 2850, 'schedule = invoice net');
select pg_temp.eq((select count(*) from public.deferred_revenue_schedule where invoice_id = (select id from ki)), 3, 'three months');
select pg_temp.expect_error(format($$select public.post_contract_invoice(%L)$$, (select id from d1)), 'already invoiced', 'period billed once');
-- recognise the first two months
create temp table rv as select public.recognize_deferred_revenue((date_trunc('month', current_date) - interval '1 day')::date) as r;
select pg_temp.expect((select (r->>'rows')::int from rv) >= 2, 'two months recognised');
select pg_temp.eq((select sum(amount_sar) from public.deferred_revenue_schedule where invoice_id = (select id from ki) and not recognized),
  (select amount_sar from public.deferred_revenue_schedule where invoice_id = (select id from ki) and month = date_trunc('month', current_date)::date), 'current month still deferred');
select pg_temp.expect_error(format($$select public.post_credit_note(%L, '[57]', 'Full refund', 'OTHER')$$, (select id from ki)), 'still deferred', 'cannot credit recognised revenue');
create temp table kcn as select * from public.post_credit_note((select id from ki), '[2]', 'Two camera-months not serviced', 'OTHER');
select pg_temp.eq(pg_temp.gl((select credit_note_number from kcn), '2400'), 100, 'credit note reduces deferred revenue');
select pg_temp.eq((select sum(amount_sar) from public.deferred_revenue_schedule where invoice_id = (select id from ki)), 2750, 'schedule reduced');
-- renewal
select pg_temp.expect((select count(*) from public.contract_renewals_due(400) where contract_id = (select id from k1)) = 1, 'renewal list');
select pg_temp.as_user(:'salesit');
create temp table k2 as select * from public.renew_contract((select id from k1), '{"upliftPct":5}');
select pg_temp.expect((select renewed_from from k2) = (select id from k1) and (select start_date from k2) = (select end_date from k1) + 1, 'renewal starts the day after');
select pg_temp.eq(((select lines from k2)->0->>'monthlySar')::numeric, 52.5, 'price uplift');
select pg_temp.expect_error(format($$select public.renew_contract(%L)$$, (select id from k1)), 'already been renewed', 'renew once');

-- ---------- 8. service tickets ----------
select pg_temp.as_user(:'sales');
create temp table t1 as select * from public.open_service_ticket('{"serial":"CAM-W-001","customer_id":"cust-amc","subject":"Camera offline","priority":"high"}');
select pg_temp.expect((select coverage from t1) = 'warranty' and (select item_name from t1) <> '', 'under warranty');
create temp table t2 as select * from public.open_service_ticket('{"serial":"CAM-X-002","customer_id":"cust-amc","subject":"No video"}');
select pg_temp.expect((select coverage from t2) = 'amc' and (select contract_id from t2) = (select id from k1), 'covered by the AMC');
select pg_temp.expect((select sla_due_at from t2) between now() + interval '5 hours 59 minutes' and now() + interval '6 hours 1 minute', 'SLA from the contract');
create temp table t3 as select * from public.open_service_ticket('{"serial":"CAM-X-003","customer_id":"cust-amc","subject":"Broken lens"}');
select pg_temp.expect((select coverage from t3) = 'chargeable', 'no warranty, not on the AMC: chargeable');
select pg_temp.expect_error(format($$select public.update_service_ticket(%L, '{"chargeable_sar":200}')$$, (select id from t2)), 'not charged', 'covered ticket is not charged');
select pg_temp.expect_error(format($$select public.update_service_ticket(%L, '{"status":"resolved"}')$$, (select id from t3)), 'resolution', 'resolution required');
select public.update_service_ticket((select id from t3), '{"status":"resolved","resolution":"Lens replaced","labour_hours":1.5,"chargeable_sar":350}');
select public.update_service_ticket((select id from t3), '{"status":"closed"}');
select pg_temp.expect((select status from public.service_tickets where id = (select id from t3)) = 'closed'
                      and jsonb_array_length((select history from public.service_tickets where id = (select id from t3))) = 3, 'closed with history');
select pg_temp.expect_error(format($$select public.update_service_ticket(%L, '{"status":"open"}')$$, (select id from t3)), 'cannot change', 'closed is final');

-- ---------- 9. VAT return still ties to GL 2100 ----------
select pg_temp.as_user(:'fin');
select pg_temp.eq(pg_temp.vat_diff(), (select d from vat0), 'VAT return vs GL 2100 difference unchanged by project billing');

select pg_temp.as_user(null);
reset role;
select 'PROJECTS OK';
