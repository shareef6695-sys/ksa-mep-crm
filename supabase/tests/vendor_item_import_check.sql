-- =====================================================================
-- vendor_item_import_check.sql — proves 0019. LOCAL TEST DATABASE ONLY. Invented data.
-- Order: any full chain up to 0019 (run_sql_tests.sh runs it after customer_import_check). Prints "VENDOR ITEM IMPORT OK".
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

set role authenticated;
-- sales cannot import
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect_error($$select public.import_vendors('[{"name_en":"X"}]')$$, 'Only Admin', 'sales blocked from vendors');
select pg_temp.expect_error($$select public.import_items('[{"name_en":"X"}]')$$, 'Only Admin', 'sales blocked from items');

-- procurement can
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
create temp table v_rows as select $j$[
  {"row": 2, "name_en": "Sample Pipes Factory", "vendor_origin": "KSA", "vat_number": "300000000000023", "city": "Jeddah", "payment_terms": "Advance / Cash"},
  {"row": 3, "name_en": "Sample Pipes Factory - Khobar", "vendor_origin": "KSA", "vat_number": "300000000000023"},
  {"row": 4, "name_en": "Example Software Ltd", "vendor_origin": "International", "vat_number": "GB123456789", "default_currency": "gbp", "country": "United Kingdom"},
  {"row": 5, "name_en": "Bad VAT Trading", "vendor_origin": "KSA", "vat_number": "12345"},
  {"row": 6, "name_en": "", "vendor_origin": "KSA"},
  {"row": 7, "name_en": "Local Driver", "vendor_origin": "KSA"}
]$j$::jsonb as j;
grant select on v_rows to authenticated;
select pg_temp.expect((select (public.import_vendors(j, true)->>'inserted')::int = 0 from v_rows), 'vendor dry run inserts nothing');
create temp table v_res as select public.import_vendors(j) r from v_rows;
grant select on v_res to authenticated;
select pg_temp.expect((select (r->>'inserted')::int = 3 and (r->>'skipped')::int = 1 and (r->>'rejected')::int = 2 from v_res),
  'vendors: 3 in, 1 skipped (same VAT), 2 rejected (bad KSA VAT, no name)');

reset role;
select pg_temp.expect((select vendor_code like 'VEND-%' and payment_terms = 'Advance / Cash' and is_ksa_vat_registered
                       from public.vendors where name_en = 'Sample Pipes Factory'), 'KSA vendor numbered, VAT-registered');
select pg_temp.expect((select vendor_origin = 'International' and default_currency = 'GBP' and vat_number = 'GB123456789' and not is_ksa_vat_registered
                       from public.vendors where name_en = 'Example Software Ltd'), 'foreign VAT id kept, currency upper-cased');
select pg_temp.expect((select country = 'Saudi Arabia' and vat_number is null and not is_ksa_vat_registered
                       from public.vendors where name_en = 'Local Driver'), 'KSA vendor without VAT');
set role authenticated;

create temp table i_rows as select $j$[
  {"row": 2, "name_en": "Sample PVC Pipe 110mm", "item_type": "Goods", "category": "MEP", "uom": "MTR", "sales_price_sar": "25.5", "purchase_price": "18", "preferred_vendor": "sample pipes factory"},
  {"row": 3, "name_en": "Sample Cloud Licence", "item_type": "Service", "category": "IT & ELV", "uom": "YR", "uom_label": "Year", "sales_price_sar": "1200"},
  {"row": 4, "name_en": "sample pvc pipe 110MM", "item_type": "Goods"},
  {"row": 5, "name_en": "Export Crate", "zatca_vat_type": "Z"},
  {"row": 6, "name_en": "Export Crate 2", "zatca_vat_type": "Z", "zatca_exemption_reason": "VATEX-SA-32"},
  {"row": 7, "name_en": "Negative Thing", "sales_price_sar": "-1"},
  {"row": 8, "name_en": "Odd Category", "zatca_vat_type": "X"},
  {"row": 9, "name_en": "Unknown Supplier Part", "preferred_vendor": "Nobody Co"}
]$j$::jsonb as j;
grant select on i_rows to authenticated;
select pg_temp.expect((select (public.import_items(j, true)->>'inserted')::int = 0 from i_rows), 'item dry run inserts nothing');
select pg_temp.expect((select count(*) = 0 from public.custom_uoms where code = 'YR'), 'dry run creates no unit');
create temp table i_res as select public.import_items(j) r from i_rows;
grant select on i_res to authenticated;
select pg_temp.expect((select (r->>'inserted')::int = 4 and (r->>'skipped')::int = 1 and (r->>'rejected')::int = 3 from i_res),
  'items: 4 in, 1 duplicate name, 3 rejected (Z without reason, negative price, unknown category)');
select pg_temp.expect((select x->>'reason' from i_res, jsonb_array_elements(r->'results') x where (x->>'row')::int = 9) ilike '%Nobody Co%not found%',
  'unknown preferred vendor reported');

reset role;
select pg_temp.expect((select item_code like 'ITM-%' and uom = 'MTR' and sales_price_sar = 25.5 and link_to_supplier
                       and preferred_vendor_id = (select id from public.vendors where name_en = 'Sample Pipes Factory')
                       from public.items where name_en = 'Sample PVC Pipe 110mm'), 'goods item with code, unit, prices, preferred vendor');
select pg_temp.expect((select item_code like 'SRV-%' and uom = 'YR' and not is_stocked_item from public.items where name_en = 'Sample Cloud Licence'),
  'service item numbered SRV');
select pg_temp.expect((select label = 'YR — Year' from public.custom_uoms where code = 'YR'), 'new unit added');
select pg_temp.expect((select zatca_vat_type = 'Z' and zatca_exemption_reason = 'VATEX-SA-32' from public.items where name_en = 'Export Crate 2'), 'zero-rated item keeps its reason');
set role authenticated;

-- re-import adds nothing
select pg_temp.expect((select (public.import_vendors(j)->>'inserted')::int = 0 from v_rows), 'vendor re-import is a no-op');
select pg_temp.expect((select (public.import_items(j)->>'inserted')::int = 0 from i_rows), 'item re-import is a no-op');

select pg_temp.as_user(null);
reset role;
select 'VENDOR ITEM IMPORT OK';
