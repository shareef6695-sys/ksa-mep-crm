-- =====================================================================
-- 0019_vendor_item_import.sql — bulk vendor and item import (Vendors / Items -> Import CSV)
-- ---------------------------------------------------------------------
-- import_vendors(p_rows jsonb, p_dry_run boolean default false) -> jsonb
--   rows use the vendors column names (name_en required; name_ar, vendor_origin KSA|GCC|International, vat_number,
--   cr_number, tax_id, contact_person, phone, whatsapp, email, country, city, address, default_currency, payment_terms,
--   iban) plus an optional "row" number. Numbered with the VENDOR range (VEND-00001 ...).
--   Skipped: same VAT number or same name as an existing vendor or an earlier row. Rejected: no name; a KSA vendor
--   whose VAT number is not 15 digits 3...3.
-- import_items(p_rows jsonb, p_dry_run boolean default false) -> jsonb
--   rows use the items column names (name_en required; item_type Goods|Service, name_ar, category, uom, uom_label,
--   sales_price_sar, purchase_price, purchase_currency, zatca_vat_type S|Z|E|O, zatca_exemption_reason,
--   preferred_vendor (vendor name or code), is_stocked_item) plus "row". Numbered ITEM_GOODS (ITM-) / ITEM_SERVICE
--   (SRV-). A unit that is neither standard nor already a custom unit is added to custom_uoms.
--   Skipped: same name as an existing item or an earlier row. Rejected: no name; unknown VAT category; Z/E/O without
--   an exemption reason; negative prices.
--   Both: admin, ceo, manager, finance, procurement; one transaction; the result lists every row:
--   { dryRun, inserted, skipped, rejected, results: [{row, name, status, code?, reason?}] }
-- Idempotent.
-- =====================================================================
begin;

create or replace function public._norm_party_name(p text) returns text
language sql immutable as $$
  select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9؀-ۿ]+', '', 'g')
$$;
revoke all on function public._norm_party_name(text) from public, anon;

create or replace function public.import_vendors(p_rows jsonb, p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; i int := 0; v_row int; v_name text; v_vat text; v_origin text; v_code text; v_reason text;
  v_seen_names text[] := '{}'; v_seen_vats text[] := '{}';
  v_results jsonb := '[]'::jsonb; v_ins int := 0; v_skip int := 0; v_rej int := 0;
begin
  if not public.has_role('admin', 'ceo', 'manager', 'finance', 'procurement') then
    raise exception 'Only Admin, CEO, Manager, Finance or Procurement can import vendors.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'import_vendors: p_rows must be a JSON array'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'import_vendors: at most 5000 rows per import'; end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_row := coalesce(nullif(r->>'row', '')::int, i);
    v_name := btrim(coalesce(r->>'name_en', ''));
    v_vat := nullif(regexp_replace(coalesce(r->>'vat_number', ''), '\s', '', 'g'), '');
    v_origin := case lower(coalesce(r->>'vendor_origin', '')) when 'gcc' then 'GCC' when 'international' then 'International'
                     when 'foreign' then 'International' else 'KSA' end;
    v_reason := null;
    if v_name = '' then v_reason := 'Name is missing.';
    elsif v_origin = 'KSA' and v_vat is not null and not public.is_valid_ksa_vat(v_vat) then
      v_reason := format('VAT number %s is not a KSA VAT number (15 digits, starting and ending with 3).', v_vat);
    end if;
    if v_reason is not null then
      v_rej := v_rej + 1;
      v_results := v_results || jsonb_build_object('row', v_row, 'name', v_name, 'status', 'rejected', 'reason', v_reason);
      continue;
    end if;

    if v_vat is not null and (v_vat = any (v_seen_vats) or exists (select 1 from public.vendors x where x.vat_number = v_vat)) then
      v_reason := format('A vendor with VAT %s already exists%s.', v_vat, case when v_vat = any (v_seen_vats) then ' earlier in this file' else ' in the ERP' end);
    elsif public._norm_party_name(v_name) = any (v_seen_names)
       or exists (select 1 from public.vendors x where public._norm_party_name(x.name_en) = public._norm_party_name(v_name)) then
      v_reason := format('A vendor named "%s" already exists%s.', v_name,
                         case when public._norm_party_name(v_name) = any (v_seen_names) then ' earlier in this file' else ' in the ERP' end);
    end if;
    v_seen_names := v_seen_names || public._norm_party_name(v_name);
    if v_vat is not null then v_seen_vats := v_seen_vats || v_vat; end if;
    if v_reason is not null then
      v_skip := v_skip + 1;
      v_results := v_results || jsonb_build_object('row', v_row, 'name', v_name, 'status', 'skipped', 'reason', v_reason);
      continue;
    end if;
    if p_dry_run then
      v_results := v_results || jsonb_build_object('row', v_row, 'name', v_name, 'status', 'ok');
      continue;
    end if;

    v_code := public.next_doc_number('VENDOR');
    insert into public.vendors (id, vendor_code, name_en, name_ar, vendor_origin, vat_number, tax_id, cr_number, contact_person,
                                phone, whatsapp, email, country, city, address, default_currency, payment_terms, iban,
                                is_ksa_vat_registered)
    values ('vend-' || replace(gen_random_uuid()::text, '-', ''), v_code, v_name, nullif(btrim(r->>'name_ar'), ''), v_origin, v_vat,
            nullif(btrim(r->>'tax_id'), ''), nullif(btrim(r->>'cr_number'), ''), nullif(btrim(r->>'contact_person'), ''),
            nullif(btrim(r->>'phone'), ''), nullif(btrim(r->>'whatsapp'), ''), nullif(lower(btrim(r->>'email')), ''),
            coalesce(nullif(btrim(r->>'country'), ''), case when v_origin = 'KSA' then 'Saudi Arabia' end),
            nullif(btrim(r->>'city'), ''), nullif(btrim(r->>'address'), ''),
            coalesce(nullif(upper(btrim(r->>'default_currency')), ''), 'SAR'),
            coalesce(nullif(btrim(r->>'payment_terms'), ''), 'Net 30'), nullif(replace(btrim(r->>'iban'), ' ', ''), ''),
            v_origin = 'KSA' and v_vat is not null);
    v_ins := v_ins + 1;
    v_results := v_results || jsonb_build_object('row', v_row, 'name', v_name, 'status', 'inserted', 'code', v_code);
  end loop;
  return jsonb_build_object('dryRun', p_dry_run, 'inserted', v_ins, 'skipped', v_skip, 'rejected', v_rej, 'results', v_results);
end $$;

create or replace function public.import_items(p_rows jsonb, p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; i int := 0; v_row int; v_name text; v_type text; v_vat text; v_reason_code text; v_uom text; v_code text;
  v_reason text; v_sale numeric; v_buy numeric; v_vendor text; v_pref text;
  v_seen_names text[] := '{}';
  v_results jsonb := '[]'::jsonb; v_ins int := 0; v_skip int := 0; v_rej int := 0;
  -- the units the app offers without a custom unit (MasterDataViews.jsx STANDARD_UOMS)
  c_standard constant text[] := array['PCS','NOS','SET','MTR','ROL','BOX','PKT','KG','TON','LTR','SQM','CBM','HRS','DAY','MTH','LOT'];
begin
  if not public.has_role('admin', 'ceo', 'manager', 'finance', 'procurement') then
    raise exception 'Only Admin, CEO, Manager, Finance or Procurement can import items.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'import_items: p_rows must be a JSON array'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'import_items: at most 5000 rows per import'; end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_row := coalesce(nullif(r->>'row', '')::int, i);
    v_name := btrim(coalesce(r->>'name_en', ''));
    v_type := case when lower(coalesce(r->>'item_type', '')) in ('service', 'services') then 'Service' else 'Goods' end;
    v_vat := upper(coalesce(nullif(btrim(r->>'zatca_vat_type'), ''), 'S'));
    v_reason_code := nullif(btrim(r->>'zatca_exemption_reason'), '');
    v_uom := upper(coalesce(nullif(btrim(r->>'uom'), ''), case when v_type = 'Service' then 'LOT' else 'PCS' end));
    v_sale := coalesce(nullif(r->>'sales_price_sar', '')::numeric, 0);
    v_buy := coalesce(nullif(r->>'purchase_price', '')::numeric, 0);
    v_reason := null;
    if v_name = '' then v_reason := 'Name is missing.';
    elsif v_vat not in ('S', 'Z', 'E', 'O') then v_reason := format('Unknown VAT category "%s" (use S, Z, E or O).', v_vat);
    elsif v_vat <> 'S' and v_reason_code is null then v_reason := format('VAT category %s needs an exemption reason.', v_vat);
    elsif v_sale < 0 or v_buy < 0 then v_reason := 'Prices cannot be negative.';
    end if;
    if v_reason is not null then
      v_rej := v_rej + 1;
      v_results := v_results || jsonb_build_object('row', v_row, 'name', v_name, 'status', 'rejected', 'reason', v_reason);
      continue;
    end if;

    if public._norm_party_name(v_name) = any (v_seen_names)
       or exists (select 1 from public.items x where public._norm_party_name(x.name_en) = public._norm_party_name(v_name)) then
      v_reason := format('An item named "%s" already exists%s.', left(v_name, 80),
                         case when public._norm_party_name(v_name) = any (v_seen_names) then ' earlier in this file' else ' in the ERP' end);
    end if;
    v_seen_names := v_seen_names || public._norm_party_name(v_name);
    if v_reason is not null then
      v_skip := v_skip + 1;
      v_results := v_results || jsonb_build_object('row', v_row, 'name', v_name, 'status', 'skipped', 'reason', v_reason);
      continue;
    end if;

    v_pref := nullif(btrim(r->>'preferred_vendor'), '');
    v_vendor := null;
    if v_pref is not null then
      select x.id into v_vendor from public.vendors x
       where x.vendor_code = v_pref or public._norm_party_name(x.name_en) = public._norm_party_name(v_pref) limit 1;
    end if;

    if p_dry_run then
      v_results := v_results || jsonb_build_object('row', v_row, 'name', v_name, 'status', 'ok',
        'reason', case when v_pref is not null and v_vendor is null then format('Preferred vendor "%s" not found; left blank.', v_pref) end);
      continue;
    end if;

    if not (v_uom = any (c_standard)) and not exists (select 1 from public.custom_uoms u where u.code = v_uom) then
      insert into public.custom_uoms (code, label)
      values (v_uom, v_uom || ' — ' || coalesce(nullif(btrim(r->>'uom_label'), ''), v_uom)) on conflict (code) do nothing;
    end if;

    v_code := public.next_doc_number(case when v_type = 'Service' then 'ITEM_SERVICE' else 'ITEM_GOODS' end);
    insert into public.items (id, item_code, item_type, name_en, name_ar, category, uom, sales_price_sar, purchase_price,
                              purchase_currency, zatca_vat_type, zatca_exemption_reason, link_to_supplier, preferred_vendor_id,
                              is_stocked_item, is_serialized, reorder_level)
    values ('item-' || replace(gen_random_uuid()::text, '-', ''), v_code, v_type, v_name, nullif(btrim(r->>'name_ar'), ''),
            coalesce(nullif(btrim(r->>'category'), ''), 'MEP'), v_uom, round(v_sale, 4), round(v_buy, 4),
            coalesce(nullif(upper(btrim(r->>'purchase_currency')), ''), 'SAR'), v_vat, case when v_vat = 'S' then null else v_reason_code end,
            v_vendor is not null, v_vendor,
            v_type = 'Goods' and lower(coalesce(r->>'is_stocked_item', '')) in ('true', 'yes', '1', 'y'), false, 0);
    v_ins := v_ins + 1;
    v_results := v_results || jsonb_build_object('row', v_row, 'name', v_name, 'status', 'inserted', 'code', v_code,
      'reason', case when v_pref is not null and v_vendor is null then format('Preferred vendor "%s" not found; left blank.', v_pref) end);
  end loop;
  return jsonb_build_object('dryRun', p_dry_run, 'inserted', v_ins, 'skipped', v_skip, 'rejected', v_rej, 'results', v_results);
end $$;

revoke all on function public.import_vendors(jsonb, boolean) from public, anon;
revoke all on function public.import_items(jsonb, boolean) from public, anon;
grant execute on function public.import_vendors(jsonb, boolean) to authenticated;
grant execute on function public.import_items(jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
