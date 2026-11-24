-- =====================================================================
-- delivery_billing_check.sql — proves 0024. LOCAL TEST DATABASE ONLY. Invented data. Prints "DELIVERY BILLING OK".
-- Seed users from rls_check: a1 admin, b1 manager, d1 procurement, f1 finance, c1 sales_mep.
-- =====================================================================
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, false); end $$;
create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'CHECK FAILED: %', msg; end if; end $$;
create or replace function pg_temp.expect_error(p_sql text, p_like text, msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'CHECK FAILED (no error): %', msg;
exception when others then
  if sqlerrm like 'CHECK FAILED%' then raise; end if;
  if sqlerrm not ilike '%' || p_like || '%' then raise exception 'CHECK FAILED (wrong error "%"): %', sqlerrm, msg; end if;
end $$;
create or replace function pg_temp.line(p_so text, p_line text, p_key text) returns numeric language sql as $$
  select public._num(l->p_key) from public.sales_orders s, jsonb_array_elements(s.items) l where s.id = p_so and l->>'id' = p_line $$;
create or replace function pg_temp.dn_of(p_so text, p_n int) returns text language sql as $$
  select id from public.delivery_notes where so_id = p_so order by created_at, dn_number offset p_n - 1 limit 1 $$;
grant execute on all functions in schema pg_temp to authenticated;

-- invented master data
insert into public.warehouses (code, name_en) values ('WDB', 'Billing Check Store') on conflict (code) do nothing;
insert into public.items (id, name_en, is_stocked_item, item_type) values ('itm-db-pump', 'Check Pump', true, 'Goods')
on conflict (id) do update set is_stocked_item = true;
insert into public.customers (id, name_en, assigned_salesman_id) values ('cust-db1', 'Billing Check Trading', '00000000-0000-0000-0000-0000000000c1')
on conflict (id) do nothing;
insert into public.inquiries (id, data) select q, jsonb_build_object('refNo', q, 'customerId', 'cust-db1', 'clientName', 'Billing Check Trading',
  'marginPercent', 20, 'stage', 'quoted', 'salesmanId', '00000000-0000-0000-0000-0000000000c1', 'assignedSalesName', 'Sales One',
  'commissionPct', 10, 'division', 'MEP', 'boqItems', jsonb_build_array(
     jsonb_build_object('id', 'p', 'desc', 'Check Pump', 'qty', 10, 'buyUnitCost', 100, 'buyCurrency', 'SAR', 'itemId', 'itm-db-pump', 'unit', 'PCS'),
     jsonb_build_object('id', 's', 'desc', 'Installation', 'qty', 1, 'buyUnitCost', 500, 'buyCurrency', 'SAR', 'unit', 'LOT')))
from unnest(array['Q-DB1', 'Q-DB2']) q
on conflict (id) do nothing;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.post_opening_stock('WDB', '[{"itemId":"itm-db-pump","qty":30,"unitCost":90}]');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select public.post_sales_order('Q-DB1');
select public.post_sales_order('Q-DB2');
select id as so1 from public.sales_orders where inquiry_id = 'Q-DB1' \gset
select id as so2 from public.sales_orders where inquiry_id = 'Q-DB2' \gset

-- three partial deliveries on SO1, one on SO2
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select public.post_delivery_note(:'so1', '{"p":4}', '', '{}', 'WDB');
select public.post_delivery_note(:'so1', '{"p":3}', '', '{}', 'WDB');
select public.post_delivery_note(:'so1', '{"p":3,"s":1}', '', '{}', 'WDB');
select public.post_delivery_note(:'so2', '{"p":1}', '', '{}', 'WDB');
select pg_temp.dn_of(:'so1', 1) as dn1, pg_temp.dn_of(:'so1', 2) as dn2, pg_temp.dn_of(:'so1', 3) as dn3, pg_temp.dn_of(:'so2', 1) as dn9 \gset

-- 1. combined invoice: two deliveries of the same order on one invoice
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select id as inv12 from public.post_invoice_combined(array[:'dn2', :'dn1']) \gset
select pg_temp.expect((select cardinality(dn_ids) = 2 and dn_id = :'dn1' and jsonb_array_length(items) = 2 from public.invoices where id = :'inv12'),
  'combined invoice lists both delivery notes, oldest first, with both lines');
select pg_temp.expect((select subtotal_sar = 7 * 125 from public.invoices where id = :'inv12'), 'combined invoice bills 7 pumps at the order price');
select pg_temp.expect((select count(*) = 2 from public.delivery_notes where invoice_id = :'inv12'), 'both delivery notes point to the invoice');
select pg_temp.expect(pg_temp.line(:'so1', 'p', 'invoicedQty') = 7, 'order line shows 7 invoiced');
select pg_temp.expect((select items->0->>'dnNumber' is not null from public.invoices where id = :'inv12'), 'invoice lines keep their delivery note');
select pg_temp.expect_error(format('select public.post_invoice(%L)', :'dn2'), 'already been invoiced', 'second delivery of a combined invoice cannot be billed again');
select pg_temp.expect_error(format('select public.post_invoice_combined(array[%L, %L])', :'dn3', :'dn1'), 'already been invoiced', 'cannot re-use an invoiced note in a new combination');
select pg_temp.expect_error(format('select public.post_invoice_combined(array[%L, %L])', :'dn3', :'dn9'), 'same sales order', 'notes of different orders are not combined');
select pg_temp.expect_error($$select public.post_invoice_combined('{}')$$, 'at least one', 'empty selection refused');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect_error(format('select public.post_invoice_combined(array[%L])', :'dn3'), 'cannot do this', 'sales cannot invoice');

-- 2. reverse a delivery note posted by mistake
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.expect_error(format('select public.reverse_delivery_note(%L, %L)', :'dn3', 'x'), 'cannot do this', 'procurement cannot reverse');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_error(format('select public.reverse_delivery_note(%L, %L)', :'dn3', ' '), 'reason', 'a reason is required');
select pg_temp.expect_error(format('select public.reverse_delivery_note(%L, %L)', :'dn1', 'wrong'), 'credit note', 'an invoiced note cannot be reversed');
reset role;
select qty as stock_before from public.item_stock where item_id = 'itm-db-pump' and warehouse = 'WDB' \gset
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select public.reverse_delivery_note(:'dn3', 'Posted against the wrong order');
select pg_temp.expect((select reversed_at is not null and reversal_reason = 'Posted against the wrong order' from public.delivery_notes where id = :'dn3'), 'note kept and marked reversed');
select pg_temp.expect(pg_temp.line(:'so1', 'p', 'deliveredQty') = 7 and pg_temp.line(:'so1', 's', 'deliveredQty') = 0, 'order quantities reopened');
select pg_temp.expect((select status = 'partially_delivered' from public.sales_orders where id = :'so1'), 'order back to partially delivered');
reset role;
select pg_temp.expect((select qty = :stock_before + 3 from public.item_stock where item_id = 'itm-db-pump' and warehouse = 'WDB'), 'stock back');
select pg_temp.expect((select count(*) = 1 from public.stock_moves where move_type = 'DN_REVERSAL' and source_doc_id = :'dn3'), 'one reversal stock move');
select pg_temp.expect((select coalesce(sum(debit - credit), 0) = 0 from public.gl_journal_lines l join public.gl_journal_entries e on e.id = l.entry_id
                         where e.source_doc_number in ((select dn_number from public.delivery_notes where id = :'dn3'), (select dn_number || '-REV' from public.delivery_notes where id = :'dn3'))
                           and l.account_code = '5010'), 'COGS of the reversed delivery nets to zero');
-- the posting guard freezes a reversed note (checked as table owner with a signed-in user, so only the guard stands in the way)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error(format('update public.delivery_notes set items = %L where id = %L', '[]', :'dn3'), 'cannot be changed', 'reversed note is frozen');
select pg_temp.expect_error(format('update public.delivery_notes set items = %L where id = %L', '[]', :'dn2'), 'cannot be changed', 'note on a combined invoice is frozen');
select pg_temp.expect_error(format('delete from public.delivery_notes where id = %L', :'dn3'), 'cannot be deleted', 'reversed note cannot be deleted');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_error(format('select public.reverse_delivery_note(%L, %L)', :'dn3', 'again'), 'already reversed', 'no double reversal');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect_error(format('select public.post_invoice(%L)', :'dn3'), 'reversed', 'a reversed note cannot be invoiced');
-- the reopened quantity can be delivered again and billed on its own
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select public.post_delivery_note(:'so1', '{"p":3,"s":1}', '', '{}', 'WDB');
select pg_temp.dn_of(:'so1', 4) as dn4 \gset
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select id as inv4 from public.post_invoice(:'dn4') \gset
select pg_temp.expect(pg_temp.line(:'so1', 'p', 'invoicedQty') = 10 and pg_temp.line(:'so1', 's', 'invoicedQty') = 1, 'everything delivered is invoiced');
select pg_temp.expect((select so.grand_total_sar = (select sum(grand_total_sar) from public.invoices where so_id = so.id) from public.sales_orders so where id = :'so1'),
  'invoices add up to the order');

-- 3. returns: with and without a replacement
select public.post_credit_note(:'inv12', '[1, 0]', 'Defective', 'RETURN');
select pg_temp.expect(pg_temp.line(:'so1', 'p', 'deliveredQty') = 10, 'plain return leaves the order closed');
select public.post_credit_note(:'inv12', '[2, 0]', 'Defective, replacing', 'RETURN', true);
select pg_temp.expect(pg_temp.line(:'so1', 'p', 'deliveredQty') = 8 and pg_temp.line(:'so1', 'p', 'invoicedQty') = 8, 'replacement reopens 2 on the order');
select pg_temp.expect((select status = 'partially_delivered' from public.sales_orders where id = :'so1'), 'order open for the replacement');
select pg_temp.expect((select replacement from public.credit_notes where original_invoice_id = :'inv12' order by issued_at desc, credit_note_number desc limit 1), 'credit note records the replacement');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select public.post_delivery_note(:'so1', '{"p":2}', 'Replacement', '{}', 'WDB');
select pg_temp.expect((select status = 'delivered' from public.sales_orders where id = :'so1'), 'replacement delivered');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect_error(format('select public.post_credit_note(%L, %L, %L, %L, true)', :'inv12', '[9, 0]', 'x', 'RETURN'), 'more than was invoiced', 'replacement still capped by the invoice');

-- 4. credit is checked when goods leave; delivery invoices are not held back
reset role;
select pg_temp.as_user(null);
update public.invoices set due_date = current_date - 400 where id = :'inv4';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.expect_error(format('select public.post_delivery_note(%L, %L, %L, %L, %L)', :'so2', '{"p":1}', '', '{}', 'WDB'), 'Credit check failed', 'no delivery while invoices are overdue');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.grant_credit_override('DELIVERY', :'so2', 'Customer guarantee on file');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select public.post_delivery_note(:'so2', '{"p":1}', '', '{}', 'WDB');
select pg_temp.expect_error(format('select public.post_delivery_note(%L, %L, %L, %L, %L)', :'so2', '{"p":1}', '', '{}', 'WDB'), 'Credit check failed', 'the override is used once');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect((select (public.post_invoice_combined(array[:'dn9', pg_temp.dn_of(:'so2', 2)])).id is not null), 'goods already delivered are invoiced despite the overdue invoice');

-- 5. privileges and books
reset role;
select pg_temp.expect(not has_function_privilege('anon', 'public.post_invoice_combined(text[])', 'execute'), 'anon cannot invoice');
select pg_temp.expect(not has_function_privilege('anon', 'public.reverse_delivery_note(text,text)', 'execute'), 'anon cannot reverse');
select pg_temp.expect(not has_function_privilege('anon', 'public.post_credit_note(text,jsonb,text,text,boolean)', 'execute'), 'anon cannot credit');
select pg_temp.expect(has_function_privilege('authenticated', 'public.reverse_delivery_note(text,text)', 'execute'), 'signed-in users reach the role check');
select pg_temp.expect(not exists (select 1 from pg_proc where proname = 'post_credit_note' and pronargs = 4), 'old 4-argument credit note is gone');
select pg_temp.expect((select coalesce(sum(debit) - sum(credit), 0) = 0 from public.gl_journal_lines), 'general ledger balances');
select pg_temp.expect((select coalesce(sum(value_sar), 0) from public.item_stock) = (select coalesce(sum(debit - credit), 0) from public.gl_journal_lines where account_code = '1200'),
  'stock value equals the inventory account');

select 'DELIVERY BILLING OK';
