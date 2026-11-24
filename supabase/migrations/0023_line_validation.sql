-- =====================================================================
-- 0023_line_validation.sql — quote and sales-order lines must have sensible quantities and prices (security check 5)
-- ---------------------------------------------------------------------
-- Found by attacking the business logic: a quote could carry a negative-quantity line ("Pump x 10" plus "Adj x -9")
-- or a negative unit cost, and post_sales_order turned it into a sales order worth SAR 133 instead of 1,333, or a
-- negative SAR -666. That understates the order for credit-limit and approval checks, and an invoice made from it
-- would be a credit note that skipped Finance's credit-note controls (ZATCA also rejects negative invoice lines).
-- Discounts and returns have their own controlled documents (pricing / approval, credit notes).
--
-- The rules are enforced by triggers, so every path (app, RPC, import, future code) is covered:
--   quotes (inquiries.data->boqItems): quantity > 0, buyUnitCost >= 0, marginPercent between -100 and 100 (exclusive),
--                                      at most 2000 lines (a quote cannot be used to fill the database)
--   new sales orders (items):          orderedQty > 0, unitSellSar >= 0, unitCostSar >= 0
--   sales-order changes:               orderedQty >= 0 (0 = line cancelled), prices >= 0
-- Existing rows are not touched; they are checked the next time they are written.
-- Idempotent.
-- =====================================================================
begin;

-- first offending line, or null when every line is fine
create or replace function public._bad_line(p_items jsonb, p_qty_key text, p_min_qty numeric, p_money_keys text[])
returns text
language sql immutable set search_path = public as $$
  select format('line %s "%s": %s', o, coalesce(nullif(e->>'desc', ''), '?'),
           case when public._num(e->p_qty_key) < p_min_qty or (p_min_qty > 0 and public._num(e->p_qty_key) <= 0)
                then format('quantity %s must be %s', coalesce(e->>p_qty_key, 'empty'), case when p_min_qty > 0 then 'more than 0' else '0 or more' end)
                else format('%s cannot be negative', (select k from unnest(p_money_keys) k where public._num(e->k) < 0 limit 1)) end)
  from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) with ordinality as x(e, o)
  where public._num(e->p_qty_key) < p_min_qty
     or (p_min_qty > 0 and public._num(e->p_qty_key) <= 0)
     or exists (select 1 from unnest(p_money_keys) k where public._num(e->k) < 0)
  order by o
  limit 1
$$;

create or replace function public._check_quote_lines() returns trigger
language plpgsql set search_path = public as $$
declare v_bad text; v_margin numeric;
begin
  if new.data is distinct from coalesce(old.data, 'null'::jsonb) then
    if jsonb_typeof(new.data->'boqItems') = 'array' and jsonb_array_length(new.data->'boqItems') > 2000 then
      raise exception 'Quote %: at most 2000 lines.', new.id using errcode = '22023';
    end if;
    v_bad := public._bad_line(new.data->'boqItems', 'qty', 1e-9, array['buyUnitCost']);
    if v_bad is not null then
      raise exception 'Quote %: % (use a credit note or a lower price, not a negative line).', new.id, v_bad using errcode = '22023';
    end if;
    v_margin := public._num(new.data->'marginPercent');
    if v_margin <= -100 or v_margin >= 100 then
      raise exception 'Quote %: margin % %% is outside -100 .. 100.', new.id, v_margin using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_check_quote_lines on public.inquiries;
create trigger trg_check_quote_lines before insert or update of data on public.inquiries
  for each row execute function public._check_quote_lines();

create or replace function public._check_so_lines() returns trigger
language plpgsql set search_path = public as $$
declare v_bad text;
begin
  if tg_op = 'INSERT' or new.items is distinct from old.items then
    v_bad := public._bad_line(new.items, 'orderedQty', case when tg_op = 'INSERT' then 1e-9 else 0 end,
                              array['unitSellSar', 'unitCostSar']);
    if v_bad is not null then
      raise exception 'Sales order %: %.', coalesce(new.so_number, new.id), v_bad using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_check_so_lines on public.sales_orders;
create trigger trg_check_so_lines before insert or update of items on public.sales_orders
  for each row execute function public._check_so_lines();

revoke execute on function public._check_quote_lines() from public, anon, authenticated;
revoke execute on function public._check_so_lines() from public, anon, authenticated;

commit;
