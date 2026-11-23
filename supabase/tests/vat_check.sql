-- =====================================================================
-- vat_check.sql — proves 0009. LOCAL TEST DATABASE ONLY.
-- Order: stub -> 0001 -> rls_check (seed) -> 0002 -> 0003 -> 0004 -> 0006 -> 0007 -> 0008 -> 0009
--        -> posting_check.sql -> this file. Prints "VAT OK".
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
create or replace function pg_temp.box(p_box text, p_col text) returns numeric language plpgsql as $$
declare v numeric;
begin
  execute format('select %I from public.vat_return(current_date - 1, current_date) where box = %L', p_col, p_box) into v;
  return v;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

\set fin  '00000000-0000-0000-0000-0000000000f1'
\set mgr  '00000000-0000-0000-0000-0000000000b1'
\set proc '00000000-0000-0000-0000-0000000000d1'

-- ---------- master data (maintenance session) ----------
select pg_temp.as_user(null);
select pg_temp.expect_error($$insert into public.customers (id, name_en, vat_number) values ('bad-vat', 'Bad VAT Co', '12345')$$, 'customers_vat_format', 'invalid customer VAT refused');
insert into public.customers (id, name_en, vat_number, building_no, street, district, city, postal_code, country)
values ('cust-b2b', 'Gulf Contracting', '310122393500003', '1234', 'King Fahd Rd', 'Al Olaya', 'Riyadh', '12211', 'SA');
insert into public.items (id, name_en, uom, purchase_price, purchase_currency, zatca_vat_type, zatca_exemption_reason) values
  ('itm-export', 'Generator (export)', 'PCS', 1000, 'SAR', 'Z', 'VATEX-SA-32'),
  ('itm-exempt', 'Finance fee', 'LOT', 100, 'SAR', 'E', 'VATEX-SA-29');
insert into public.vendors (id, name_en, vendor_origin, country, vat_number) values
  ('vend-uk', 'London Engineering Ltd', 'International', 'United Kingdom', ''),
  ('vend-ksa', 'Riyadh Supplies', 'KSA', 'Saudi Arabia', '300222222200003');
insert into public.app_settings (key, value) values ('company_profile', '{"nameEn":"Horizon Business Solutions Est.","vatNumber":"300000000000003","crNumber":"4030000000","buildingNo":"7788","street":"Tahlia St","district":"Al Andalus","city":"Jeddah","postalCode":"23326"}')
on conflict (key) do update set value = excluded.value;
-- these quotes are priced at cost: no margin-floor approval in this VAT test (0013)
update public.app_settings set value = value || '{"minMarginPct": 0}' where key = 'sales_settings';
-- a mixed quote: one standard line, one export line, one exempt line, for a VAT-registered customer
insert into public.inquiries (id, data) values ('INQ-VAT', '{"id":"INQ-VAT","customerId":"cust-b2b","clientName":"Gulf Contracting","clientVat":"310122393500003",
  "salesmanId":"00000000-0000-0000-0000-0000000000c1","marginPercent":0,
  "boqItems":[{"id":"s1","desc":"Cable (standard)","qty":10,"buyCurrency":"SAR","buyUnitCost":100},
              {"id":"z1","desc":"Generator (export)","qty":2,"itemId":"itm-export","buyCurrency":"SAR","buyUnitCost":1000},
              {"id":"e1","desc":"Finance fee","qty":1,"itemId":"itm-exempt","buyCurrency":"SAR","buyUnitCost":100}]}');

set role authenticated;

-- ---------- sales: VAT per line ----------
select pg_temp.as_user(:'mgr');
create temp table t_so as select * from public.post_sales_order('INQ-VAT');
select pg_temp.eq((select subtotal_sar from t_so), 3100, 'SO net 1000 + 2000 + 100');
select pg_temp.eq((select vat_sar from t_so), 150, 'VAT only on the standard line');
select pg_temp.eq((select grand_total_sar from t_so), 3250, 'SO total');
select pg_temp.expect((select items->1->>'vatCategory' from t_so) = 'Z' and (select items->1->>'exemptionReason' from t_so) = 'VATEX-SA-32', 'export line carries Z + reason');
select pg_temp.expect((select customer_id from t_so) = 'cust-b2b', 'SO linked to the customer record');

select pg_temp.as_user(:'proc');
create temp table t_dn as select * from public.post_delivery_note((select id from t_so), '{"s1":10,"z1":2,"e1":1}');
select pg_temp.expect((select items->2->>'vatCategory' from t_dn) = 'E', 'DN keeps VAT category');

select pg_temp.as_user(:'fin');
create temp table t_inv as select * from public.post_invoice((select id from t_dn));
select pg_temp.eq((select vat_sar from t_inv), 150, 'invoice VAT');
select pg_temp.eq((select grand_total_sar from t_inv), 3250, 'invoice total');
select pg_temp.eq((select jsonb_array_length(vat_breakdown) from t_inv), 3, 'VAT breakdown has 3 categories');
select pg_temp.expect((select invoice_type from t_inv) = 'standard', 'B2B standard invoice');
select pg_temp.expect((select buyer_address->>'postalCode' from t_inv) = '12211' and (select seller_address->>'buildingNo' from t_inv) = '7788', 'addresses snapshotted');
select pg_temp.eq((select cardinality(zatca_warnings) from t_inv), 0, 'no ZATCA warnings when data is complete');

-- credit 1 export generator: no VAT on it
create temp table t_cn as select * from public.post_credit_note((select id from t_inv), '[0,1,0]', 'Returned', 'RETURN');
select pg_temp.eq((select vat_sar from t_cn), 0, 'zero-rated credit note has no VAT');
select pg_temp.eq((select grand_total_sar from t_cn), 1000, 'credit note total');

-- an old-style line with no VAT fields is still standard rated
reset role;
select pg_temp.eq(public._line_rate('{"qty":1,"unitSellSar":100}'::jsonb), 0.15, 'line without VAT fields = 15%');
set role authenticated;

-- warnings on a B2B invoice with a bad VAT number and no address
reset role;
select pg_temp.as_user(null);
insert into public.inquiries (id, data) values ('INQ-WARN', '{"id":"INQ-WARN","clientName":"Unknown Buyer","clientVat":"399999","marginPercent":0,
  "boqItems":[{"id":"w1","desc":"Item","qty":1,"buyCurrency":"SAR","buyUnitCost":100}]}');
set role authenticated;
select pg_temp.as_user(:'mgr');
create temp table t_so2 as select * from public.post_sales_order('INQ-WARN');
select pg_temp.as_user(:'proc');
create temp table t_dn2 as select * from public.post_delivery_note((select id from t_so2), '{"w1":1}');
select pg_temp.as_user(:'fin');
create temp table t_inv2 as select * from public.post_invoice((select id from t_dn2));
select pg_temp.eq((select cardinality(zatca_warnings) from t_inv2), 2, 'bad buyer VAT + missing buyer address flagged');

-- ---------- purchases ----------
select pg_temp.as_user(:'proc');
create temp table t_po_ksa as select * from public.post_purchase_order('{"vendor_id":"vend-ksa","supplier_name":"Riyadh Supplies","supplier_vat":"300222222200003","currency":"SAR","fx_rate":1,"items":[{"desc":"Fittings","qty":10,"unitCostFx":50}]}');
select pg_temp.eq((select supplier_vat_sar from t_po_ksa), 75, 'domestic supplier VAT');
create temp table t_po_unbilled as select * from public.post_purchase_order('{"vendor_id":"vend-ksa","supplier_name":"Riyadh Supplies","supplier_vat":"300222222200003","currency":"SAR","fx_rate":1,"items":[{"desc":"Later","qty":1,"unitCostFx":1000}]}');
create temp table t_po_svc as select * from public.post_purchase_order('{"vendor_id":"vend-uk","supplier_name":"London Engineering Ltd","supplier_vat":"GB123456789","currency":"GBP","fx_rate":4.78,"supply_type":"services","items":[{"desc":"Design services","qty":1,"unitCostFx":1000}]}');
select pg_temp.eq((select supplier_vat_sar from t_po_svc), 0, 'no KSA VAT from a foreign supplier, even with a tax id');
select pg_temp.expect((select is_foreign_supplier from t_po_svc), 'flagged foreign');
create temp table t_po_imp as select * from public.post_purchase_order('{"vendor_id":"vend-uk","supplier_name":"London Engineering Ltd","currency":"GBP","fx_rate":4.78,"items":[{"desc":"Pump (import)","qty":1,"unitCostFx":2000}]}');
select public.post_goods_receipt(id) from (select id from t_po_ksa union all select id from t_po_svc union all select id from t_po_imp) x;

select pg_temp.as_user(:'fin');
select public.post_supplier_bill((select id from t_po_ksa));
create temp table t_bill_svc as select * from public.post_supplier_bill((select id from t_po_svc));
select pg_temp.eq((select reverse_charge_vat_sar from t_bill_svc), 717, 'reverse charge 15% of 4,780');
select public.post_supplier_bill((select id from t_po_imp));
select pg_temp.eq((select reverse_charge_vat_sar from public.purchase_orders where id = (select id from t_po_imp)), 0, 'imported goods: VAT is paid at customs, not reverse charged');
create temp table t_cust as select * from public.post_import_vat('CUS-2026-555', current_date, 1434, 9560, (select id from t_po_imp), '1020');
select pg_temp.expect_error($$select public.post_import_vat('CUS-2026-555', current_date, 1, 1)$$, 'already recorded', 'declaration recorded once');
select public.post_expense_voucher('{"payee":"STC","expense_account_code":"5220","amount_sar":200,"vat_applied":true,"vat_recoverable":true,"paid_from_account_code":"1020"}');

-- ---------- VAT return ----------
select pg_temp.eq(pg_temp.box('4', 'amount_sar'), 2000, 'exports: 2 generators x 1,000');
select pg_temp.eq(pg_temp.box('4', 'adjustment_sar'), -1000, 'export credit note in adjustments');
select pg_temp.eq(pg_temp.box('5', 'amount_sar'), 100, 'exempt sales');
-- box 7 = posted domestic bills (by bill date) + recoverable expenses; the unbilled PO is not in it
select pg_temp.eq(pg_temp.box('7', 'vat_sar'),
  (select coalesce(sum(supplier_vat_sar), 0) from public.purchase_orders
    where bill_status in ('posted','paid') and not is_foreign_supplier and supplier_vat_sar > 0 and public.riyadh_date(billed_at) between current_date - 1 and current_date)
  + (select coalesce(sum(vat_sar), 0) from public.expense_vouchers where status = 'posted' and vat_recoverable and expense_date between current_date - 1 and current_date),
  'domestic purchase VAT from posted bills + expenses only');
select pg_temp.expect((select bill_status from public.purchase_orders where id = (select id from t_po_unbilled)) = 'unbilled'
  and pg_temp.box('7', 'vat_sar') >= 75 + 30, 'unbilled PO VAT (150) excluded, billed (75) and expense (30) included');
select pg_temp.eq(pg_temp.box('8', 'vat_sar'), 1434, 'customs import VAT');
select pg_temp.eq(pg_temp.box('9', 'vat_sar'), 717, 'reverse charge VAT');
-- the only difference is the hand-seeded invoice inv-1 (10 x 46.875 + 15%), which has no journal: the check catches it
select pg_temp.eq(pg_temp.box('GL-DIFF-OUT', 'vat_sar'), 70.31, 'output VAT reconciles to GL 2100 except the seeded invoice with no journal');
select pg_temp.eq(pg_temp.box('GL-DIFF-IN', 'vat_sar'), 0, 'input VAT reconciles to GL 1150');
select pg_temp.eq(pg_temp.box('16', 'vat_sar'), pg_temp.box('13', 'vat_sar') - pg_temp.box('12', 'vat_sar'), 'net VAT = output - input');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect_error($$select * from public.vat_return(current_date - 1, current_date)$$, 'cannot do this', 'sales cannot run the VAT return');

reset role;
select pg_temp.expect((select sum(debit) = sum(credit) from public.gl_journal_lines), 'ledger balances');
select 'VAT OK' as result;
