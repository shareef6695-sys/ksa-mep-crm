-- =====================================================================
-- line_validation_check.sql — proves 0023. LOCAL TEST DATABASE ONLY. Invented data. Prints "LINE VALIDATION OK".
-- =====================================================================
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid)::text end, false); end $$;
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
grant execute on all functions in schema pg_temp to authenticated;

insert into public.customers (id, name_en, assigned_salesman_id) values ('cust-lv', 'Line Check Trading', '00000000-0000-0000-0000-0000000000c1')
on conflict (id) do nothing;
insert into public.inquiries (id, data) values ('Q-LV', '{"id":"Q-LV","clientName":"Line Check Trading","customerId":"cust-lv",
  "salesmanId":"00000000-0000-0000-0000-0000000000c1","marginPercent":25,"boqItems":[{"id":"a","desc":"Pump","qty":10,"buyCurrency":"SAR","buyUnitCost":100}]}')
on conflict (id) do nothing;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');  -- manager: prices quotes, converts to orders
select pg_temp.expect_error($$select public.save_inquiry('Q-LV', (select data from public.inquiries where id='Q-LV') ||
  '{"boqItems":[{"id":"a","desc":"Pump","qty":10,"buyCurrency":"SAR","buyUnitCost":100},{"id":"b","desc":"Adj","qty":-9,"buyCurrency":"SAR","buyUnitCost":100}]}')$$,
  'quantity -9 must be more than 0', 'negative-quantity quote line refused');
select pg_temp.expect_error($$select public.save_inquiry('Q-LV', (select data from public.inquiries where id='Q-LV') ||
  '{"boqItems":[{"id":"a","desc":"Pump","qty":0,"buyCurrency":"SAR","buyUnitCost":100}]}')$$, 'must be more than 0', 'zero-quantity quote line refused');
select pg_temp.expect_error($$select public.save_inquiry('Q-LV', (select data from public.inquiries where id='Q-LV') ||
  '{"boqItems":[{"id":"a","desc":"Pump","qty":1,"buyCurrency":"SAR","buyUnitCost":-500}]}')$$, 'buyUnitCost cannot be negative', 'negative cost refused');
select pg_temp.expect_error($$select public.save_inquiry('Q-LV', (select data from public.inquiries where id='Q-LV') || '{"marginPercent":-150}')$$,
  'outside -100 .. 100', 'absurd margin refused');
select pg_temp.expect_error($$select public.save_inquiry('Q-LV', (select data from public.inquiries where id='Q-LV') || jsonb_build_object('boqItems',
  (select jsonb_agg(jsonb_build_object('id','l'||g,'desc','x','qty',1,'buyCurrency','SAR','buyUnitCost',1)) from generate_series(1,2001) g)))$$, 'at most 2000 lines', 'oversized quote refused');
select pg_temp.expect(public.save_inquiry('Q-LV', (select data from public.inquiries where id='Q-LV') || '{"marginPercent":30}') is not null, 'normal edit still works');

-- sales orders: no negative / zero lines on creation, whatever the path
reset role;
select pg_temp.expect_error($$insert into public.sales_orders (id, so_number, client_name, items, subtotal_sar, total_cost_sar)
  values ('so-lv1','SO-LV1','Line Check Trading','[{"id":"a","desc":"Pump","orderedQty":10,"unitCostSar":100,"unitSellSar":133},{"id":"b","desc":"Adj","orderedQty":-9,"unitCostSar":100,"unitSellSar":133}]',133,100)$$,
  'quantity -9 must be more than 0', 'negative SO line refused');
select pg_temp.expect_error($$insert into public.sales_orders (id, so_number, client_name, items, subtotal_sar, total_cost_sar)
  values ('so-lv2','SO-LV2','Line Check Trading','[{"id":"a","desc":"Pump","orderedQty":1,"unitCostSar":100,"unitSellSar":-666}]',-666,100)$$,
  'unitSellSar cannot be negative', 'negative SO price refused');
insert into public.sales_orders (id, so_number, client_name, items, subtotal_sar, total_cost_sar)
  values ('so-lv3','SO-LV3','Line Check Trading','[{"id":"a","desc":"Pump","orderedQty":2,"unitCostSar":100,"unitSellSar":133}]',266,200);
update public.sales_orders set items = '[{"id":"a","desc":"Pump","orderedQty":0,"unitCostSar":100,"unitSellSar":133}]' where id = 'so-lv3';
select pg_temp.expect((select (items->0->>'orderedQty')::numeric = 0 from public.sales_orders where id = 'so-lv3'), 'an existing line can be reduced to 0 (cancelled)');
select pg_temp.expect_error($$update public.sales_orders set items = '[{"id":"a","desc":"Pump","orderedQty":-1,"unitCostSar":100,"unitSellSar":133}]' where id = 'so-lv3'$$,
  'must be 0 or more', 'an existing line cannot go negative');
delete from public.sales_orders where id = 'so-lv3';

select 'LINE VALIDATION OK' as result;
