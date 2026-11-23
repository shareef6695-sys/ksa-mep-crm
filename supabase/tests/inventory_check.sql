-- =====================================================================
-- inventory_check.sql — proves 0011. LOCAL TEST DATABASE ONLY.
-- Order: stub -> 0001 -> rls_check (seed) -> 0002 -> 0003 -> 0004 -> posting_check -> 0006 -> credit_check
--        -> 0007 -> 0008 -> 0009 -> 0010 -> 0011 -> this file (before any other stock movement). Prints "INVENTORY OK".
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
-- GL movement of one account for one source document
create or replace function pg_temp.bal(p_code text, p_doc text) returns numeric language sql security definer as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.gl_journal_lines l join public.gl_journal_entries e on e.id = l.entry_id
  where l.account_code = p_code and e.source_doc_number = p_doc
$$;
create or replace function pg_temp.stk(p_item text, p_wh text default 'MAIN') returns public.item_stock language sql security definer as $$
  select * from public.item_stock where item_id = p_item and warehouse = p_wh
$$;
grant execute on all functions in schema pg_temp to authenticated;

\set fin   '00000000-0000-0000-0000-0000000000f1'
\set mgr   '00000000-0000-0000-0000-0000000000b1'
\set proc  '00000000-0000-0000-0000-0000000000d1'
\set sales '00000000-0000-0000-0000-0000000000c1'

select pg_temp.as_user(null);
reset role;
select pg_temp.expect(not exists (select 1 from public.stock_moves), 'starts with an empty stock ledger');
insert into public.items (id, item_code, item_type, name_en, uom, sales_price_sar, purchase_price, is_stocked_item, is_serialized, reorder_level) values
  ('itm-pipe', 'PIPE-1', 'Goods', 'Copper pipe 22mm', 'PCS', 200, 100, true, false, 6),
  ('itm-cable', 'CBL-1', 'Goods', 'Cable 4mm', 'MTR', 40, 25, true, false, 0),
  ('itm-cam', 'CAM-1', 'Goods', 'IP camera', 'PCS', 900, 500, true, true, 0),
  ('itm-svc', 'SVC-1', 'Service', 'Installation service', 'JOB', 500, 300, false, false, 0)
on conflict (id) do nothing;
insert into public.warehouses (code, name_en) values ('WH2', 'Riyadh store') on conflict do nothing;
-- a PO received under the old rules, not billed yet (2 x 50 = 100)
insert into public.purchase_orders (id, po_number, supplier_name, currency, fx_rate, status, items, goods_total_fx, goods_total_sar, landed_cost_sar, supplier_vat_sar, bill_status)
values ('po-old', 'PO-OLD-1', 'Old Supplier', 'SAR', 1, 'grn_completed', '[{"desc":"Cable (old GRN)","qty":2,"unitCostFx":50,"is_stocked_item":true,"itemId":"itm-cable"}]', 100, 100, 0, 0, 'unbilled');
create temp table i_gl0 as select coalesce(sum(debit - credit), 0) as v from public.gl_journal_lines where account_code = '1200';
grant select on i_gl0 to authenticated;
set role authenticated;

-- ---------- 0. go-live: opening stock ----------
select pg_temp.as_user(:'proc');
select pg_temp.expect_error($$select public.post_opening_stock('MAIN', '[{"itemId":"itm-cable","qty":4,"unitCost":25}]')$$, 'cannot do this', 'procurement cannot post opening stock');
select pg_temp.as_user(:'fin');
select pg_temp.expect_error($$select public.post_opening_stock('MAIN', '[{"itemId":"itm-svc","qty":1,"unitCost":5}]')$$, 'not a stocked item', 'services have no stock');
create temp table i_open as select * from public.post_opening_stock('MAIN', '[{"itemId":"itm-cable","qty":4,"unitCost":25}]', 'Go-live count');
select pg_temp.eq((select (summary->>'stock_value')::numeric from i_open), 100, 'opening value');
select pg_temp.eq((select (summary->>'to_grni')::numeric from i_open), 100, 'old unbilled receipt moved to GRNI');
select pg_temp.eq((select (summary->>'to_1200')::numeric from i_open), 100 - (select v from i_gl0), 'GL 1200 brought to the stock ledger');
select pg_temp.eq(pg_temp.bal('3020', (select doc_number from i_open)), (select v from i_gl0), 'retained earnings takes the old GL 1200 balance');
select pg_temp.eq((select difference_sar from public.inventory_reconciliation()), 0, 'reconciled after go-live');
select pg_temp.expect_error($$select public.post_opening_stock('MAIN', '[{"itemId":"itm-cable","qty":1,"unitCost":25}]')$$, 'already has stock', 'opening only once per warehouse');
select pg_temp.eq((select grn_value_sar from public.purchase_orders where id = 'po-old'), 100, 'old PO now carries a GRN value');
create temp table i_bill0 as select * from public.post_supplier_bill('po-old');
select pg_temp.eq(pg_temp.bal('2150', (select bill_number from i_bill0)), 100, 'its bill clears GRNI');
select pg_temp.eq(pg_temp.bal('1200', (select bill_number from i_bill0)), 0, 'and no longer debits 1200');

-- ---------- 1. GRN 10 @ 100, GRN 10 @ 120 (110 + 100 landed / 10), deliver 15 ----------
select pg_temp.as_user(:'proc');
select pg_temp.expect_error($$select public.post_purchase_order('{"supplier_name":"S","currency":"SAR","items":[{"desc":"x","qty":1,"unitCostFx":1,"is_stocked_item":true}]}')$$,
  'must be linked to an item', 'stocked PO line needs a stocked item');
create temp table i_po1 as select * from public.post_purchase_order('{"supplier_name":"Pipe Co","currency":"SAR","fx_rate":1,"items":[{"desc":"Pipe","qty":10,"unitCostFx":100,"is_stocked_item":true,"itemId":"itm-pipe"}]}');
create temp table i_po2 as select * from public.post_purchase_order('{"supplier_name":"Pipe Co","currency":"SAR","fx_rate":1,"landed_cost_sar":100,"items":[{"desc":"Pipe","qty":10,"unitCostFx":110,"is_stocked_item":true,"itemId":"itm-pipe"}]}');
create temp table i_grn1 as select * from public.post_goods_receipt((select id from i_po1));
select pg_temp.expect((select grn_number from i_grn1) like 'GRN-%', 'GRN numbered');
select pg_temp.eq(pg_temp.bal('1200', (select grn_number from i_grn1)), 1000, 'GRN Dr 1200');
select pg_temp.eq(pg_temp.bal('2150', (select grn_number from i_grn1)), -1000, 'GRN Cr 2150');
create temp table i_grn2 as select * from public.post_goods_receipt((select id from i_po2));
select pg_temp.eq((select grn_value_sar from i_grn2), 1200, 'landed cost included in stock value');
select pg_temp.eq((pg_temp.stk('itm-pipe')).qty, 20, '20 on hand');
select pg_temp.eq((pg_temp.stk('itm-pipe')).avg_cost, 110, 'moving average 110');
select pg_temp.expect_error($$select public.post_goods_receipt((select id from i_po1))$$, 'not waiting', 'no second GRN');

reset role; select pg_temp.as_user(null);
insert into public.inquiries (id, data) values ('INQ-INV1', '{"id":"INQ-INV1","clientName":"Gulf Contracting","clientVat":"310122393500003","customerId":"cust-b2b",
  "salesmanId":"00000000-0000-0000-0000-0000000000c1","marginPercent":20,
  "boqItems":[{"id":"p","desc":"Copper pipe","qty":15,"itemId":"itm-pipe","buyCurrency":"SAR","buyUnitCost":100},
              {"id":"s","desc":"Installation","qty":1,"itemId":"itm-svc","buyCurrency":"SAR","buyUnitCost":300}]}');
set role authenticated;
select pg_temp.as_user(:'mgr');
create temp table i_so1 as select * from public.post_sales_order('INQ-INV1');
select pg_temp.as_user(:'proc');
create temp table i_dn1 as select * from public.post_delivery_note((select id from i_so1), '{"p":15,"s":1}');
select pg_temp.eq((select cogs_sar from i_dn1), 1650, 'COGS 15 x 110 = 1,650');
select pg_temp.eq(pg_temp.bal('5010', (select dn_number from i_dn1)), 1650, 'Dr 5010 at delivery');
select pg_temp.eq(pg_temp.bal('1200', (select dn_number from i_dn1)), -1650, 'Cr 1200 at delivery');
select pg_temp.eq((pg_temp.stk('itm-pipe')).qty, 5, '5 left');
select pg_temp.eq((pg_temp.stk('itm-pipe')).avg_cost, 110, '... at 110');
select pg_temp.eq((pg_temp.stk('itm-pipe')).value_sar, 550, 'stock value 550 (= GL 1200 for this item)');
select pg_temp.expect((select items->0->>'stockIssued' from i_dn1) = 'true' and (select (items->0->>'unitCostSar')::numeric from i_dn1) = 110, 'DN line carries actual cost');
select pg_temp.expect((select items->1->>'stockIssued' from i_dn1) is null, 'service line not stocked');
select pg_temp.expect(cardinality((select stock_warnings from i_dn1)) = 0, 'no warnings');
select pg_temp.eq((select stock_on_hand from public.items where id = 'itm-pipe'), 5, 'item master stock on hand maintained');
select pg_temp.expect(exists (select 1 from public.low_stock_items where item_id = 'itm-pipe'), 'below reorder level 6');

select pg_temp.as_user(:'fin');
create temp table i_inv1 as select * from public.post_invoice((select id from i_dn1));
select pg_temp.eq(pg_temp.bal('1200', (select invoice_number from i_inv1)), 0, 'invoice no longer relieves stock');
select pg_temp.eq(pg_temp.bal('5010', (select invoice_number from i_inv1)), 0, 'invoice posts no COGS');
select pg_temp.eq((select landed_cost_sar from i_inv1), 1650 + 300, 'invoice cost = actual stock cost + service estimate (for margin / commission)');
create temp table i_b1 as select * from public.post_supplier_bill((select id from i_po1));
create temp table i_b2 as select * from public.post_supplier_bill((select id from i_po2));
select pg_temp.eq(pg_temp.bal('2150', (select bill_number from i_b1)) + pg_temp.bal('2150', (select bill_number from i_b2)), 2200, 'bills clear GRNI');
select pg_temp.eq(pg_temp.bal('5010', (select bill_number from i_b2)), 0, 'no price difference');

-- non-stock purchase goes straight to cost of sales
select pg_temp.as_user(:'proc');
create temp table i_po3 as select * from public.post_purchase_order('{"supplier_name":"Install Co","currency":"SAR","fx_rate":1,"items":[{"desc":"Installation","qty":1,"unitCostFx":300,"is_stocked_item":false}]}');
create temp table i_grn3 as select * from public.post_goods_receipt((select id from i_po3));
select pg_temp.eq((select grn_value_sar from i_grn3), 0, 'non-stock GRN puts nothing into stock');
select pg_temp.as_user(:'fin');
create temp table i_b3 as select * from public.post_supplier_bill((select id from i_po3));
select pg_temp.eq(pg_temp.bal('5010', (select bill_number from i_b3)), 300, 'non-stock bill Dr 5010');
select pg_temp.eq(pg_temp.bal('1200', (select bill_number from i_b3)), 0, '... never 1200');

-- ---------- 2. negative stock: deliver 8 with 5 on hand, then receive 10 @ 130 ----------
reset role; select pg_temp.as_user(null);
insert into public.inquiries (id, data) values ('INQ-INV2', '{"id":"INQ-INV2","clientName":"Walk-in","clientVat":"","marginPercent":20,
  "boqItems":[{"id":"p","desc":"Copper pipe","qty":8,"itemId":"itm-pipe","buyCurrency":"SAR","buyUnitCost":100}]}');
set role authenticated;
select pg_temp.as_user(:'mgr');
create temp table i_so2 as select * from public.post_sales_order('INQ-INV2');
select pg_temp.as_user(:'proc');
create temp table i_dn2 as select * from public.post_delivery_note((select id from i_so2), '{"p":8}');
select pg_temp.expect((select stock_warnings[1] from i_dn2) like '%more than in stock%', 'short delivery allowed with a warning');
select pg_temp.eq((select cogs_sar from i_dn2), 880, 'COGS at the last known cost 110');
select pg_temp.eq((pg_temp.stk('itm-pipe')).qty, -3, 'stock -3');
select pg_temp.eq((pg_temp.stk('itm-pipe')).value_sar, -330, 'value -330');
select pg_temp.eq((select negative_lines from public.inventory_reconciliation()), 1, 'negative stock reported');
create temp table i_po4 as select * from public.post_purchase_order('{"supplier_name":"Pipe Co","currency":"SAR","fx_rate":1,"items":[{"desc":"Pipe","qty":10,"unitCostFx":130,"is_stocked_item":true,"itemId":"itm-pipe"}]}');
create temp table i_grn4 as select * from public.post_goods_receipt((select id from i_po4));
select pg_temp.eq(pg_temp.bal('5010', (select grn_number from i_grn4)), 60, '3 units re-priced 110 -> 130: Dr 5010 60');
select pg_temp.eq(pg_temp.bal('1200', (select grn_number from i_grn4)), 1300 - 60, 'GL 1200 +1300 -60');
select pg_temp.eq((pg_temp.stk('itm-pipe')).qty, 7, '7 on hand');
select pg_temp.eq((pg_temp.stk('itm-pipe')).avg_cost, 130, '... at 130');
select pg_temp.eq((pg_temp.stk('itm-pipe')).value_sar, 910, 'value 910');
select pg_temp.eq((select difference_sar from public.inventory_reconciliation()), 0, 'still reconciled');

-- ---------- 3. credit note returns stock at the original delivery cost ----------
select pg_temp.as_user(:'fin');
create temp table i_cn1 as select * from public.post_credit_note((select id from i_inv1), '[5, 0]', 'Returned', 'RETURN');
select pg_temp.eq(pg_temp.bal('1200', (select credit_note_number from i_cn1)), 550, 'Dr 1200 5 x 110');
select pg_temp.eq(pg_temp.bal('5010', (select credit_note_number from i_cn1)), -550, 'Cr 5010');
select pg_temp.eq((pg_temp.stk('itm-pipe')).qty, 12, '12 on hand');
select pg_temp.eq((pg_temp.stk('itm-pipe')).value_sar, 1460, 'value 910 + 550');

-- ---------- 4. serials ----------
select pg_temp.as_user(:'proc');
create temp table i_po5 as select * from public.post_purchase_order('{"supplier_name":"Cam Co","currency":"SAR","fx_rate":1,"items":[{"desc":"Camera","qty":2,"unitCostFx":500,"is_stocked_item":true,"itemId":"itm-cam"}]}');
select pg_temp.expect_error($$select public.post_goods_receipt((select id from i_po5))$$, 'one serial number per unit', 'serials required on GRN');
select pg_temp.expect_error($$select public.post_goods_receipt((select id from i_po5), '{"0":["C1","C1"]}')$$, 'already in stock', 'duplicate serial refused');
create temp table i_grn5 as select * from public.post_goods_receipt((select id from i_po5), '{"0":["C1","C2"]}');
select pg_temp.eq((select count(*) from public.item_serials where item_id = 'itm-cam' and status = 'in_stock'), 2, 'two serials in stock');
reset role; select pg_temp.as_user(null);
insert into public.inquiries (id, data) values ('INQ-CAM', '{"id":"INQ-CAM","clientName":"Walk-in","clientVat":"","marginPercent":20,
  "boqItems":[{"id":"c","desc":"Camera","qty":1,"itemId":"itm-cam","buyCurrency":"SAR","buyUnitCost":500}]}');
set role authenticated;
select pg_temp.as_user(:'mgr');
create temp table i_so3 as select * from public.post_sales_order('INQ-CAM');
select pg_temp.as_user(:'proc');
select pg_temp.expect_error($$select public.post_delivery_note((select id from i_so3), '{"c":1}')$$, 'pick one serial', 'serial required when serials are in stock');
select pg_temp.expect_error($$select public.post_delivery_note((select id from i_so3), '{"c":1}', '', '{"c":["C9"]}')$$, 'not in stock', 'unknown serial refused');
create temp table i_dn3 as select * from public.post_delivery_note((select id from i_so3), '{"c":1}', '', '{"c":["C1"]}');
select pg_temp.expect((select status from public.item_serials where serial = 'C1') = 'delivered' and (select dn_number from public.item_serials where serial = 'C1') = (select dn_number from i_dn3), 'serial checked out to the DN');

-- ---------- 5. adjustment, count, transfer ----------
select pg_temp.expect_error($$select public.post_stock_adjustment('MAIN', '[{"itemId":"itm-pipe","qty":-1}]', 'Damaged')$$, 'cannot do this', 'procurement cannot write off');
select pg_temp.as_user(:'fin');
select pg_temp.expect_error($$select public.post_stock_adjustment('MAIN', '[{"itemId":"itm-pipe","qty":-1}]', '')$$, 'needs a reason', 'reason required');
create temp table i_adj as select * from public.post_stock_adjustment('MAIN', '[{"itemId":"itm-pipe","qty":-1}]', 'Damaged in yard');
select pg_temp.eq(pg_temp.bal('5020', (select doc_number from i_adj)), round(1460 / 12.0, 2), 'write-off Dr 5020 at average cost');
select pg_temp.as_user(:'proc');
create temp table i_cnt as select * from public.post_stock_count('MAIN', '[{"itemId":"itm-pipe","countedQty":10},{"itemId":"itm-cable","countedQty":4}]', 'Month-end count');
select pg_temp.eq((pg_temp.stk('itm-pipe')).qty, 10, 'count sets the quantity');
select pg_temp.eq((select (lines->0->>'difference')::numeric from i_cnt), -1, 'count difference recorded');
create temp table i_trf as select * from public.post_stock_transfer('MAIN', 'WH2', '[{"itemId":"itm-pipe","qty":4},{"itemId":"itm-cam","qty":1,"serials":["C2"]}]', 'To Riyadh');
select pg_temp.eq((pg_temp.stk('itm-pipe', 'WH2')).qty, 4, 'transferred');
select pg_temp.eq(round((pg_temp.stk('itm-pipe', 'WH2')).avg_cost, 2), round((pg_temp.stk('itm-pipe')).avg_cost, 2), 'at the same cost (value moves to the cent)');
select pg_temp.expect((select warehouse from public.item_serials where serial = 'C2') = 'WH2', 'serial moved');
select pg_temp.expect_error($$select public.post_stock_transfer('MAIN', 'WH2', '[{"itemId":"itm-pipe","qty":99}]')$$, 'not enough', 'cannot transfer more than on hand');
select pg_temp.as_user(:'fin');
select pg_temp.eq((select difference_sar from public.inventory_reconciliation()), 0, 'stock ledger = GL 1200 after everything');
select pg_temp.eq((select sum(value_sar) from public.item_stock), (select stock_value_sar from public.inventory_reconciliation()), 'item_stock agrees with the ledger');

-- ---------- 6. who sees what ----------
select pg_temp.as_user(:'sales');
select pg_temp.expect((select count(*) from public.stock_moves) = 0, 'sales cannot read the stock ledger (costs)');
select pg_temp.expect((select qty from public.item_stock_v where item_id = 'itm-pipe' and warehouse = 'MAIN') = 6 and (select value_sar from public.item_stock_v where item_id = 'itm-pipe' and warehouse = 'MAIN') is null, 'sales see quantity, not value');
select pg_temp.expect((select avg_cost_sar from public.items_v where id = 'itm-pipe') is null, 'items_v hides average cost from sales');
select pg_temp.expect((select items->0->>'cogsSar' from public.delivery_notes_v where id = (select id from i_dn1)) is null, 'DN cost hidden from sales');
select pg_temp.expect_error($$insert into public.stock_moves (move_date, item_id, warehouse, qty, unit_cost_sar, value_sar, move_type, qty_after, value_after) values (current_date, 'itm-pipe', 'MAIN', 1, 1, 1, 'ADJUST', 1, 1)$$, 'permission denied', 'no direct writes');
reset role; select pg_temp.as_user(null);
select pg_temp.expect_error($$update public.stock_moves set qty = 1 where id = (select min(id) from public.stock_moves)$$, 'cannot be changed', 'stock ledger is immutable');

select 'INVENTORY OK' as result;
