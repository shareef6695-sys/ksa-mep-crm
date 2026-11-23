-- =====================================================================
-- procurement_check.sql — proves 0012. LOCAL TEST DATABASE ONLY.
-- Order: the inventory_check.sql order (incl. inventory_check), then 0012, then this file. Prints "PROCUREMENT OK".
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
create or replace function pg_temp.bal(p_code text, p_doc text) returns numeric language sql security definer as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.gl_journal_lines l join public.gl_journal_entries e on e.id = l.entry_id
  where l.account_code = p_code and e.source_doc_number = p_doc
$$;
create or replace function pg_temp.po(p_id text) returns public.purchase_orders language sql security definer as $$
  select * from public.purchase_orders where id = p_id
$$;
create or replace function pg_temp.line(p_id text, p_line int) returns jsonb language sql security definer as $$
  select x from public.purchase_orders po, jsonb_array_elements(po.items) x where po.id = p_id and (x->>'line')::int = p_line
$$;
grant execute on all functions in schema pg_temp to authenticated;

\set admin '00000000-0000-0000-0000-0000000000a1'
\set fin   '00000000-0000-0000-0000-0000000000f1'
\set mgr   '00000000-0000-0000-0000-0000000000b1'
\set proc  '00000000-0000-0000-0000-0000000000d1'
\set sales '00000000-0000-0000-0000-0000000000c1'

select pg_temp.as_user(null);
reset role;
select pg_temp.expect(not exists (select 1 from public.purchase_orders po, jsonb_array_elements(po.items) x where not x ? 'line'), 'existing PO lines numbered');
select pg_temp.expect((select count(*) from public.supplier_bills where legacy) = (select count(*) from public.purchase_orders where status in ('billed','paid') or bill_status in ('posted','paid')),
  'every PO billed before 0012 has its bill document');
insert into public.vendors (id, name_en, vendor_origin, country, vat_number, payment_terms) values
  ('vend-p1', 'Riyadh Valves Co', 'KSA', 'Saudi Arabia', '300333333300003', 'Net 45') on conflict (id) do nothing;
insert into public.items (id, item_code, item_type, name_en, uom, purchase_price, is_stocked_item) values
  ('itm-valve', 'VLV-1', 'Goods', 'Gate valve 2in', 'PCS', 100, true),
  ('itm-tool', 'TL-1', 'Goods', 'Site tool (non-stock)', 'PCS', 50, false)
on conflict (id) do nothing;
set role authenticated;

-- ---------- 1. multi-line PO, VAT per line ----------
select pg_temp.as_user(:'proc');
create temp table p_po1 as select * from public.post_purchase_order('{"supplier_name":"Riyadh Valves Co","vendor_id":"vend-p1","supplier_vat":"300333333300003","currency":"SAR","fx_rate":1,
  "landed_cost_sar":120,"items":[
    {"itemId":"itm-valve","qty":10,"unitCostFx":100},
    {"itemId":"itm-tool","desc":"Site tool","qty":4,"unitCostFx":50,"vatCategory":"S"},
    {"desc":"Zero-rated testing service","qty":1,"unitCostFx":100,"vatCategory":"Z"}]}');
select pg_temp.eq((select jsonb_array_length(items) from p_po1), 3, 'three lines');
select pg_temp.expect((select items->0->>'is_stocked_item' from p_po1) = 'true' and (select items->1->>'is_stocked_item' from p_po1) = 'false', 'stocked flag from item master');
select pg_temp.eq((select goods_total_sar from p_po1), 1300, 'goods 1000 + 200 + 100');
-- VAT on standard lines (1200) + their landed share (120 x 1200/1300 = 110.77) = 1310.77 x 15%
select pg_temp.eq((select supplier_vat_sar from p_po1), 196.62, 'VAT only on standard lines and their landed share');
select pg_temp.expect((select status from p_po1) = 'po_issued' and (select approval_status from p_po1) = 'not_required', 'under 20,000: no approval');
select pg_temp.expect((select payment_terms from p_po1) = 'Net 45', 'payment terms from the vendor');

-- ---------- 2. approval by amount ----------
create temp table p_po2 as select * from public.post_purchase_order('{"supplier_name":"Big Supplier","currency":"SAR","fx_rate":1,"items":[{"desc":"Chiller","qty":1,"unitCostFx":50000,"vatCategory":"S"}]}');
select pg_temp.expect((select status from p_po2) = 'pending_approval' and (select approval_level from p_po2) = 'manager', '50,000: manager approval');
create temp table p_po3 as select * from public.post_purchase_order('{"supplier_name":"Big Supplier","currency":"SAR","fx_rate":1,"items":[{"desc":"Generator","qty":1,"unitCostFx":150000,"vatCategory":"S"}]}');
select pg_temp.expect((select approval_level from p_po3) = 'ceo', '150,000: CEO approval');
select pg_temp.expect_error($$select public.post_goods_receipt((select id from p_po2))$$, 'waiting for approval', 'no receipt before approval');
select pg_temp.expect_error($$select public.approve_purchase_order((select id from p_po2))$$, 'cannot do this', 'procurement cannot approve');
select pg_temp.as_user(:'mgr');
select pg_temp.expect_error($$select public.approve_purchase_order((select id from p_po3))$$, 'cannot do this', 'manager cannot approve a CEO-level PO');
select public.approve_purchase_order((select id from p_po2));
select pg_temp.expect((pg_temp.po((select id from p_po2))).status = 'po_issued' and (pg_temp.po((select id from p_po2))).approved_by_name is not null, 'approved and issued');
select pg_temp.expect_error($$select public.reject_purchase_order((select id from p_po3), '')$$, 'cannot do this', 'manager cannot reject a CEO-level PO either');
select pg_temp.as_user(:'admin');
select public.reject_purchase_order((select id from p_po3), 'Over budget');
select pg_temp.expect((pg_temp.po((select id from p_po3))).status = 'cancelled' and (pg_temp.po((select id from p_po3))).rejection_reason = 'Over budget', 'rejected');
-- approver cannot approve their own PO
reset role; select pg_temp.as_user(null);
update public.app_settings set value = value || '{"managerApprovalAboveSar": 10}' where key = 'procurement_settings';
set role authenticated;
select pg_temp.as_user(:'proc');
create temp table p_po4 as select * from public.post_purchase_order('{"supplier_name":"S","currency":"SAR","fx_rate":1,"items":[{"desc":"x","qty":1,"unitCostFx":100}]}');
reset role; select pg_temp.as_user(null);
update public.purchase_orders set raised_by_uid = '00000000-0000-0000-0000-0000000000b1' where id = (select id from p_po4);
update public.app_settings set value = value || '{"managerApprovalAboveSar": 20000}' where key = 'procurement_settings';
set role authenticated;
select pg_temp.as_user(:'mgr');
select pg_temp.expect_error($$select public.approve_purchase_order((select id from p_po4))$$, 'another approver', 'no self-approval');

-- ---------- 3. partial receipts, no over-receipt ----------
select pg_temp.as_user(:'proc');
select pg_temp.expect_error($$select public.post_goods_receipt((select id from p_po1), '{}', null, '{"1":11}')$$, 'Over-receipt', 'over-receipt blocked');
create temp table p_g1 as select * from public.post_goods_receipt((select id from p_po1), '{}', null, '{"1":6,"2":4,"3":1}', 'First delivery');
select pg_temp.expect((select grn_number from p_g1) like 'GRN-%' and (select jsonb_array_length(lines) from p_g1) = 3, 'GRN document with 3 lines');
-- valve unit cost = 100 + 120 x 1000/1300 / 10 = 109.230769
select pg_temp.eq((select value_sar from p_g1), round(6 * 109.230769, 2), 'stock value at PO cost incl. landed share');
select pg_temp.eq(pg_temp.bal('2150', (select grn_number from p_g1)), -(select value_sar from p_g1), 'GRNI credited');
select pg_temp.expect((pg_temp.po((select id from p_po1))).status = 'partially_received', 'partially received');
select pg_temp.eq((pg_temp.line((select id from p_po1), 1)->>'receivedQty')::numeric, 6, 'line 1 received 6');
create temp table p_g2 as select * from public.post_goods_receipt((select id from p_po1), '{}', null, '{"1":4}');
select pg_temp.expect((pg_temp.po((select id from p_po1))).status = 'grn_completed', 'fully received');
select pg_temp.expect_error($$select public.post_goods_receipt((select id from p_po1), '{}', null, '{"1":1}')$$, 'not waiting', 'nothing left to receive');

-- ---------- 4. supplier bills: 3-way match, variance, landed cost ----------
select pg_temp.as_user(:'fin');
select pg_temp.expect_error($$select public.post_supplier_bill((select id from p_po1), '{"supplierInvoiceDate":"2026-11-01","lines":[{"line":1,"qty":5}]}')$$, 'invoice number', 'supplier invoice no. required');
select pg_temp.expect_error($$select public.post_supplier_bill((select id from p_po1), '{"supplierInvoiceNo":"RV-77","lines":[{"line":1,"qty":11}]}')$$, '3-way match', 'cannot bill more than received');
-- bill 1: 5 valves at 104 (4% over PO, tolerance 2%), part of the landed cost
create temp table p_b1 as select * from public.post_supplier_bill((select id from p_po1),
  '{"supplierInvoiceNo":"RV-77","supplierInvoiceDate":"2026-11-10","landedCostSar":60,"lines":[{"line":1,"qty":5,"unitCostFx":104}]}');
select pg_temp.expect((select bill_number from p_b1) like 'BILL-%', 'bill numbered');
select pg_temp.expect((select warnings[1] from p_b1) like 'Line 1%4.0%difference%', 'price variance warning');
select pg_temp.expect((select due_date from p_b1) = date '2026-11-10' + 45, 'due date from Net 45');
select pg_temp.eq((select grni_cleared_sar from p_b1), 546.15, 'GRNI cleared pro rata: 5/10 of 655.38 + 436.92');
select pg_temp.eq((select total_sar from p_b1), round((520 + 60) * 1.15, 2), 'bill total = goods + landed + VAT');
select pg_temp.eq(pg_temp.bal('5010', (select bill_number from p_b1)), (520 + 60) - (select grni_cleared_sar from p_b1), 'price + landed difference to 5010');
select pg_temp.eq(pg_temp.bal('2010', (select bill_number from p_b1)), -(select total_sar from p_b1), 'AP credited');
select pg_temp.expect((pg_temp.po((select id from p_po1))).status = 'partially_billed', 'partially billed');
select pg_temp.expect_error($$select public.post_supplier_bill((select id from p_po1), '{"supplierInvoiceNo":"RV-77","lines":[{"line":1,"qty":1}]}')$$, 'duplicate key', 'same supplier invoice cannot be billed twice');
-- bill 2: the rest at PO prices, rest of the landed cost by quantity
create temp table p_b2 as select * from public.post_supplier_bill((select id from p_po1),
  '{"supplierInvoiceNo":"RV-78","supplierInvoiceDate":"2026-11-15","landedAllocation":"qty","lines":[{"line":1,"qty":5},{"line":2,"qty":4},{"line":3,"qty":1}]}');
select pg_temp.eq((select landed_sar from p_b2), 60, 'remaining landed cost (120 - 60)');
select pg_temp.eq((select sum((x->>'landedSar')::numeric) from p_b2, jsonb_array_elements(lines) x), 60, 'landed allocated over the lines');
select pg_temp.eq((select (x->>'landedSar')::numeric from p_b2, jsonb_array_elements(lines) x where (x->>'line')::int = 2), 24, 'by quantity: 4 of 10 units');
select pg_temp.eq(pg_temp.bal('2150', (select grn_number from p_g1)) + pg_temp.bal('2150', (select grn_number from p_g2))
                + pg_temp.bal('2150', (select bill_number from p_b1)) + pg_temp.bal('2150', (select bill_number from p_b2)), 0, 'GRNI fully cleared for this PO');
select pg_temp.eq((select supplier_vat_sar from p_b2), round((500 + 200 + 30 + 24) * 0.15, 2), 'VAT not on the zero-rated line');
select pg_temp.expect((pg_temp.po((select id from p_po1))).status = 'billed' and (pg_temp.po((select id from p_po1))).bill_status = 'posted', 'fully billed');
select pg_temp.eq((pg_temp.po((select id from p_po1))).total_amount_fx, (select total_sar from p_b1) + (select total_sar from p_b2), 'what is owed = the bills');
select pg_temp.expect_error($$select public.post_supplier_bill((select id from p_po1), '{"supplierInvoiceNo":"RV-79","lines":[{"line":1,"qty":1}]}')$$, 'already been billed', 'nothing left to bill');

-- ---------- 5. AP aging by due date, payments oldest bill first ----------
select public.post_supplier_payment((select id from p_po1), (select total_sar from p_b1) + 100, 1, 'TT', 'PAY-1', date '2026-11-20');
select pg_temp.expect(not exists (select 1 from public.ap_aging(date '2026-12-01') where bill_id = (select id from p_b1)), 'bill 1 paid first');
select pg_temp.eq((select open_sar from public.ap_aging(date '2026-12-01') where bill_id = (select id from p_b2)), (select total_sar from p_b2) - 100, 'bill 2 partly paid');
select pg_temp.expect((select bucket from public.ap_aging(date '2026-12-01') where bill_id = (select id from p_b2)) = 'current', 'not due yet (Net 45)');
select pg_temp.expect((select bucket from public.ap_aging(date '2027-01-20') where bill_id = (select id from p_b2)) = '1-30', '1-30 days past due');
select public.post_supplier_payment((select id from p_po1), (select total_sar from p_b2) - 100, 1, 'TT', 'PAY-2', date '2026-11-21');
select pg_temp.expect((pg_temp.po((select id from p_po1))).status = 'paid', 'paid when billed and paid');
-- an advance before any bill
select pg_temp.as_user(:'fin');
select public.post_supplier_payment((select id from p_po2), 10000, 1, 'TT', 'ADV', date '2026-11-21');
select pg_temp.expect((pg_temp.po((select id from p_po2))).status = 'po_issued', 'advance does not mark it paid');
select pg_temp.eq((select open_sar from public.ap_aging(date '2026-11-30') where po_id = (select id from p_po2) and bucket = 'advance'), -10000, 'advance shown');

-- ---------- 6. requisition from SO shortfall -> PO ----------
reset role; select pg_temp.as_user(null);
insert into public.inquiries (id, data) values ('INQ-PR1', '{"id":"INQ-PR1","clientName":"Gulf Contracting","clientVat":"310122393500003","marginPercent":20,
  "boqItems":[{"id":"v","desc":"Gate valve","qty":25,"itemId":"itm-valve","buyCurrency":"SAR","buyUnitCost":100},
              {"id":"t","desc":"Commissioning","qty":1,"buyCurrency":"SAR","buyUnitCost":800}]}');
set role authenticated;
select pg_temp.as_user(:'mgr');
create temp table p_so as select * from public.post_sales_order('INQ-PR1');
select pg_temp.as_user(:'proc');
create temp table p_pr as select * from public.create_requisition_from_so((select id from p_so));
-- 25 needed; 10 valves in stock, nothing else on order for valves
select pg_temp.eq((select (x->>'qty')::numeric from p_pr, jsonb_array_elements(lines) x where x->>'soLineId' = 'v'), 15, 'valve shortfall 25 - 10 in stock');
select pg_temp.eq((select (x->>'qty')::numeric from p_pr, jsonb_array_elements(lines) x where x->>'soLineId' = 't'), 1, 'non-stock line needs buying');
select pg_temp.expect_error($$select public.create_requisition_from_so((select id from p_so))$$, 'Nothing to requisition', 'open requisition already covers it');
create temp table p_po5 as select * from public.post_purchase_order(format('{"supplier_name":"Riyadh Valves Co","currency":"SAR","fx_rate":1,"so_id":"%s","pr_id":"%s","items":[
  {"itemId":"itm-valve","qty":15,"unitCostFx":100,"soLineId":"v"},{"desc":"Commissioning","qty":1,"unitCostFx":800,"soLineId":"t"}]}',
  (select id from p_so), (select id from p_pr))::jsonb);
select pg_temp.expect((select status from public.purchase_requisitions where id = (select id from p_pr)) = 'ordered', 'requisition ordered');
select pg_temp.expect((select po_ids[1] from public.purchase_requisitions where id = (select id from p_pr)) = (select id from p_po5), 'linked to its PO');
select pg_temp.expect_error($$select public.create_requisition_from_so((select id from p_so))$$, 'Nothing to requisition', 'the PO now covers it');

-- ---------- 7. short-close ----------
create temp table p_g5 as select * from public.post_goods_receipt((select id from p_po5), '{}', null, '{"1":12,"2":1}');
create temp table p_c5 as select * from public.close_purchase_order((select id from p_po5), 'Supplier cannot deliver the last 3');
select pg_temp.expect((select status from p_c5) = 'closed', 'short-closed');
select pg_temp.expect_error($$select public.post_goods_receipt((select id from p_po5), '{}', null, '{"1":1}')$$, 'not waiting', 'no receipts after closing');
select pg_temp.as_user(:'fin');
create temp table p_b5 as select * from public.post_supplier_bill((select id from p_po5), '{"supplierInvoiceNo":"RV-90","lines":[{"line":1,"qty":12},{"line":2,"qty":1}]}');
select pg_temp.expect((pg_temp.po((select id from p_po5))).bill_status = 'posted', 'closed PO fully billed for what arrived');
select pg_temp.as_user(:'proc');
create temp table p_c4 as select * from public.close_purchase_order((select id from p_po4), 'Not needed');
select pg_temp.expect((select status from p_c4) = 'cancelled', 'nothing received: cancelled');

-- ---------- 8. VAT return, stock and access ----------
select pg_temp.as_user(:'fin');
select pg_temp.expect((select vat_sar from public.vat_return(date '2026-11-01', date '2026-11-30') where box = '7') >= (select supplier_vat_sar from p_b1) + (select supplier_vat_sar from p_b2),
  'bills in the VAT return by bill date');
select pg_temp.eq((select difference_sar from public.inventory_reconciliation()), 0, 'stock still equals GL 1200');
select pg_temp.as_user(:'sales');
select pg_temp.expect((select count(*) from public.supplier_bills) = 0 and (select count(*) from public.goods_receipts) = 0, 'sales see no purchasing documents');
select pg_temp.expect_error($$select public.create_requisition_from_so((select id from p_so))$$, 'cannot do this', 'sales cannot raise requisitions');
select pg_temp.as_user(:'fin');
select pg_temp.expect_error($$update public.supplier_bills set total_sar = 1 where id = (select id from p_b1)$$, 'permission denied', 'bills cannot be edited');

select 'PROCUREMENT OK' as result;
