-- =====================================================================
-- rls_check.sql — proves the 0002 access rules. LOCAL TEST DATABASE ONLY.
-- Order: supabase_stub.sql -> 0001_baseline.sql -> this file's SEED part
--        -> 0002_roles_rls.sql -> this file's CHECK part (psql -v part=check)
-- Each check raises an exception on failure; success prints "RLS OK".
-- =====================================================================
\if :{?part}
\else
  \set part seed
\endif

select :'part' = 'seed' as is_seed \gset
\if :is_seed
-- ---------------------------------------------------------------- SEED
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@test'),
 ('00000000-0000-0000-0000-0000000000f1','finance@test'),
 ('00000000-0000-0000-0000-0000000000b1','manager@test'),
 ('00000000-0000-0000-0000-0000000000c1','sales1@test'),
 ('00000000-0000-0000-0000-0000000000c2','sales2@test'),
 ('00000000-0000-0000-0000-0000000000d1','proc@test'),
 ('00000000-0000-0000-0000-0000000000e1','noprofile@test');
insert into public.team_profiles (id, email, full_name, role_key, division, is_salesman, commission_pct, active) values
 ('00000000-0000-0000-0000-0000000000a1','admin@test','Admin','admin',null,false,0,true),
 ('00000000-0000-0000-0000-0000000000f1','finance@test','Fatima Finance','finance',null,false,0,true),
 ('00000000-0000-0000-0000-0000000000b1','manager@test','Majid Manager','manager','MEP',true,5,true),
 ('00000000-0000-0000-0000-0000000000c1','sales1@test','Sami Sales','sales_mep','MEP',true,10,true),
 ('00000000-0000-0000-0000-0000000000c2','sales2@test','Sara Sales','sales_it','IT & ELV',true,10,true),
 ('00000000-0000-0000-0000-0000000000d1','proc@test','Pete Procurement','procurement',null,false,0,true);
insert into public.app_settings (key, value) values ('fx_rates', '{"SAR":1,"USD":3.75}');
insert into public.items (id, name_en, uom, purchase_price, purchase_currency) values ('itm-1','Copper cable','M', 10, 'USD');
insert into public.customers (id, name_en, assigned_salesman_id) values
 ('cust-1','Client One','00000000-0000-0000-0000-0000000000c1'),
 ('cust-2','Client Two','00000000-0000-0000-0000-0000000000c2');
insert into public.inquiries (id, data) values
 ('INQ-1', '{"id":"INQ-1","clientName":"Client One","salesmanId":"00000000-0000-0000-0000-0000000000c1","marginPercent":20,"stage":"new_inquiry","managerApproved":false,
            "boqItems":[{"id":"b1","desc":"Cable","qty":100,"buyCurrency":"USD","buyUnitCost":10}]}'),
 ('INQ-2', '{"id":"INQ-2","clientName":"Client Two","salesmanId":"00000000-0000-0000-0000-0000000000c2","marginPercent":30,"boqItems":[]}');
insert into public.sales_orders (id, so_number, salesman_id, client_name, items, subtotal_sar, total_cost_sar) values
 ('so-1','SO-1','00000000-0000-0000-0000-0000000000c1','Client One','[{"id":"b1","desc":"Cable","orderedQty":100,"unitCostSar":37.5,"unitSellSar":46.875}]', 4687.5, 3750),
 ('so-2','SO-2','00000000-0000-0000-0000-0000000000c2','Client Two','[]', 1000, 700);
insert into public.delivery_notes (id, dn_number, so_id, items) values ('dn-1','DN-1','so-1','[{"id":"b1","qty":10,"unitCostSar":37.5,"unitSellSar":46.875}]');
insert into public.invoices (id, invoice_number, so_id, salesman_id, items, subtotal_sar, landed_cost_sar) values
 ('inv-1','INV-1','so-1','00000000-0000-0000-0000-0000000000c1','[{"qty":10,"unitCostSar":37.5,"unitSellSar":46.875}]', 468.75, 375),
 ('inv-2','INV-2','so-2','00000000-0000-0000-0000-0000000000c2','[]', 1000, 700);
insert into public.customer_receipts (id, invoice_id, amount_sar) values ('rcp-1','inv-1',100),('rcp-2','inv-2',100);
insert into public.commission_ledger (id, invoice_id, salesman_id, net_profit_sar, total_eligible_commission_sar) values
 ('c1','inv-1','00000000-0000-0000-0000-0000000000c1', 93.75, 9.38),
 ('c2','inv-2','00000000-0000-0000-0000-0000000000c2', 300, 30);
insert into public.gl_journal_entries (id, voucher_number, total_debit_sar, total_credit_sar) values ('jv-1','JV-1',100,100);

\else
-- --------------------------------------------------------------- CHECKS
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, false);
end $$;
create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'RLS CHECK FAILED: %', msg; end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- roles were seeded from team_profiles
select pg_temp.expect((select count(*) from public.user_roles) = 6, 'six roles seeded');

set role authenticated;

-- ---------- Sales 1 (MEP) ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect(public.app_role() = 'sales_mep', 'sales1 role');
select pg_temp.expect((select count(*) from public.gl_journal_entries) = 0, 'sales cannot read GL');
select pg_temp.expect((select count(*) from public.invoices) = 0, 'sales cannot read invoices table directly (costs)');
select pg_temp.expect((select count(*) from public.sales_orders) = 0, 'sales cannot read sales_orders table directly');
select pg_temp.expect((select count(*) from public.inquiries) = 0, 'sales cannot read inquiries table directly');
select pg_temp.expect((select count(*) from public.invoices_v) = 1, 'sales sees only own invoice');
select pg_temp.expect((select landed_cost_sar from public.invoices_v) is null, 'invoice cost hidden');
select pg_temp.expect(not (select items->0 ? 'unitCostSar' from public.invoices_v), 'invoice line cost hidden');
select pg_temp.expect((select (items->0->>'unitSellSar')::numeric from public.invoices_v) = 46.875, 'invoice sell price visible');
select pg_temp.expect((select count(*) from public.sales_orders_v) = 1 and (select total_cost_sar from public.sales_orders_v) is null, 'own SO only, cost hidden');
select pg_temp.expect((select count(*) from public.delivery_notes_v) = 1, 'DN of own SO visible');
select pg_temp.expect((select count(*) from public.customer_receipts) = 1, 'own receipts only');
select pg_temp.expect((select count(*) from public.customers) = 1, 'own customers only');
select pg_temp.expect((select count(*) from public.commission_ledger_v) = 1 and (select net_profit_sar from public.commission_ledger_v) is null, 'own commission, net profit hidden');
select pg_temp.expect((select purchase_price from public.items_v where id = 'itm-1') is null, 'item cost hidden');
select pg_temp.expect((select count(*) from public.inquiries_v) = 1, 'own quote only');
select pg_temp.expect(not ((select data from public.inquiries_v)->'boqItems'->0 ? 'buyUnitCost'), 'quote cost hidden');
select pg_temp.expect(not ((select data from public.inquiries_v) ? 'marginPercent'), 'quote margin hidden');
select pg_temp.expect(((select data from public.inquiries_v)->'boqItems'->0->>'sellUnitSar')::numeric = 46.875, 'quote sell price = 10 USD * 3.75 / 0.8');

-- sales edits own quote: change qty, try to change margin/cost/stage, add a catalogue line
select public.save_inquiry('INQ-1', '{"id":"INQ-1","clientName":"Client One (edited)","salesmanId":"someone-else","marginPercent":90,"stage":"won","managerApproved":true,
  "boqItems":[{"id":"b1","desc":"Cable","qty":120,"buyUnitCost":1,"buyCurrency":"SAR","sellUnitSar":999},
              {"id":"b2","desc":"Copper cable","qty":5,"itemId":"itm-1"},
              {"id":"b3","desc":"Free text line","qty":1}]}'::jsonb);
reset role;
select pg_temp.expect((select data->>'clientName' from public.inquiries where id='INQ-1') = 'Client One (edited)', 'sales edit saved');
select pg_temp.expect((select (data->>'marginPercent')::numeric from public.inquiries where id='INQ-1') = 20, 'margin kept');
select pg_temp.expect((select data->>'stage' from public.inquiries where id='INQ-1') = 'new_inquiry', 'sales cannot mark won');
select pg_temp.expect(coalesce((select (data->>'managerApproved')::boolean from public.inquiries where id='INQ-1'), false) = false and not coalesce((select data ? 'approval' from public.inquiries where id='INQ-1'), false), 'sales cannot approve');
select pg_temp.expect((select data->>'salesmanId' from public.inquiries where id='INQ-1') = '00000000-0000-0000-0000-0000000000c1', 'owner kept');
select pg_temp.expect((select (data->'boqItems'->0->>'buyUnitCost')::numeric from public.inquiries where id='INQ-1') = 10, 'line cost kept');
select pg_temp.expect((select data->'boqItems'->0->>'buyCurrency' from public.inquiries where id='INQ-1') = 'USD', 'line currency kept');
select pg_temp.expect((select (data->'boqItems'->0->>'qty')::numeric from public.inquiries where id='INQ-1') = 120, 'qty change saved');
select pg_temp.expect(not ((select data from public.inquiries where id='INQ-1')->'boqItems'->0 ? 'sellUnitSar'), 'computed price not stored');
select pg_temp.expect((select (data->'boqItems'->1->>'buyUnitCost')::numeric from public.inquiries where id='INQ-1') = 10, 'catalogue line priced from item master');
select pg_temp.expect((select (data->'boqItems'->2->>'buyUnitCost')::numeric from public.inquiries where id='INQ-1') = 0, 'free-text line has no cost');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');

-- sales cannot edit someone else's quote
do $$ begin
  perform public.save_inquiry('INQ-2', '{"clientName":"hijack"}'::jsonb);
  raise exception 'RLS CHECK FAILED: sales edited another salesperson''s quote';
exception when raise_exception then
  if sqlerrm like 'RLS CHECK FAILED%' then raise; end if;
end $$;

-- sales cannot write GL, roles, or their own role
do $$ begin
  begin insert into public.gl_journal_entries (id) values ('hack'); raise exception 'RLS CHECK FAILED: sales inserted GL';
  exception when insufficient_privilege then null; end;
  begin insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000c1','admin'); raise exception 'RLS CHECK FAILED: sales inserted role';
  exception when insufficient_privilege then null; end;
  update public.user_roles set role = 'admin' where user_id = auth.uid();
  begin update public.team_profiles set role_key = 'admin' where id::text = auth.uid()::text; raise exception 'RLS CHECK FAILED: sales changed own role_key';
  exception when raise_exception then if sqlerrm like 'RLS CHECK FAILED%' then raise; end if; end;
end $$;
select pg_temp.expect(public.app_role() = 'sales_mep', 'sales still sales after escalation attempts');
update public.team_profiles set phone = '+966500000000' where id::text = auth.uid()::text;

-- sales creates a customer: owner forced to self
insert into public.customers (id, name_en, assigned_salesman_id) values ('cust-3','New Client','00000000-0000-0000-0000-0000000000c2');
select pg_temp.expect((select assigned_salesman_id from public.customers where id='cust-3') = '00000000-0000-0000-0000-0000000000c1', 'new customer owned by creator');

-- ---------- Sales 2 (IT) ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.expect((select count(*) from public.invoices_v) = 1 and (select id from public.invoices_v) = 'inv-2', 'sales2 sees only inv-2');
select pg_temp.expect((select count(*) from public.customers where id = 'cust-3') = 0, 'sales2 cannot see sales1 customer');

-- ---------- Manager ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect((select count(*) from public.inquiries_v) = 2, 'manager sees all quotes');
select pg_temp.expect((select data from public.inquiries_v where id='INQ-1')->'boqItems'->0 ? 'buyUnitCost', 'manager sees cost');
select pg_temp.expect((select landed_cost_sar from public.invoices_v where id='inv-1') = 375, 'manager sees invoice cost');
select pg_temp.expect((select count(*) from public.gl_journal_entries) = 0, 'manager cannot read GL');
select public.save_inquiry('INQ-1', (select data from public.inquiries_v where id='INQ-1') || '{"marginPercent":25,"managerApproved":true}');
insert into public.sales_orders (id, so_number, salesman_id) values ('so-3','SO-3','00000000-0000-0000-0000-0000000000c1');
do $$ begin
  insert into public.invoices (id) values ('inv-hack'); raise exception 'RLS CHECK FAILED: manager inserted invoice';
exception when insufficient_privilege then null; end $$;

-- ---------- Procurement ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
insert into public.delivery_notes (id, dn_number, so_id) values ('dn-2','DN-2','so-1');
update public.sales_orders set status = 'partially_delivered' where id = 'so-1';
select pg_temp.expect((select count(*) from public.invoices_v) = 0, 'procurement cannot see invoices');
do $$ begin
  perform public.save_inquiry('INQ-1', '{}'::jsonb); raise exception 'RLS CHECK FAILED: procurement edited a quote';
exception when raise_exception then if sqlerrm like 'RLS CHECK FAILED%' then raise; end if; end $$;

-- ---------- Finance ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect((select count(*) from public.gl_journal_entries) = 1, 'finance reads GL');
insert into public.invoices (id, invoice_number) values ('inv-3','INV-3');
insert into public.gl_journal_entries (id, lines) values ('jv-2', '[{"account_code":"5100","debit":10},{"account_code":"1020","credit":10}]');
do $$ begin
  insert into public.delivery_notes (id) values ('dn-hack'); raise exception 'RLS CHECK FAILED: finance created DN';
exception when insufficient_privilege then null; end $$;

-- ---------- User with no role ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select pg_temp.expect(public.app_role() is null, 'no profile = no role');
select pg_temp.expect((select count(*) from public.customers) + (select count(*) from public.invoices_v) + (select count(*) from public.app_settings) = 0, 'no role sees nothing');

-- ---------- Anonymous ----------
reset role;
set role anon;
do $$ begin
  perform 1 from public.invoices_v; raise exception 'RLS CHECK FAILED: anon read invoices_v';
exception when insufficient_privilege then null; end $$;

-- ---------- Admin ----------
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
update public.team_profiles set role_key = 'manager' where id = '00000000-0000-0000-0000-0000000000c2';
select pg_temp.expect((select role from public.user_roles where user_id = '00000000-0000-0000-0000-0000000000c2') = 'manager', 'admin role change syncs to user_roles');
update public.team_profiles set active = false where id = '00000000-0000-0000-0000-0000000000c2';
select pg_temp.expect((select active from public.user_roles where user_id = '00000000-0000-0000-0000-0000000000c2') = false, 'deactivation syncs');
reset role;

select 'RLS OK' as result;
\endif
