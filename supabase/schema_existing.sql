-- =====================================================================
-- Horizon ERP (KSA) - Supabase schema for the tables the React app expects
-- ---------------------------------------------------------------------
-- Run once in Supabase Dashboard -> SQL Editor. Safe to re-run
-- (idempotent: create ... if not exists, on conflict do nothing,
--  drop policy if exists, create or replace function).
--
-- Does NOT recreate the existing tables: inquiries, app_settings,
-- team_profiles (only optional, commented add-column lines below).
--
-- Conventions:
--   * ids are client-generated text (e.g. 'so-1732190000000') -> text PK
--   * SAR money totals -> numeric(18,2); FX amounts / rates / prices -> numeric(18,4)
--   * line items (items / lines) -> jsonb default '[]'
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Optional: columns the code writes to the 3 EXISTING tables.
--    Uncomment only if your live tables are missing them.
-- ---------------------------------------------------------------------
-- alter table public.team_profiles add column if not exists phone          text;
-- alter table public.team_profiles add column if not exists division       text;
-- alter table public.team_profiles add column if not exists is_salesman    boolean default false;
-- alter table public.team_profiles add column if not exists commission_pct numeric(7,4) default 0;
-- alter table public.team_profiles add column if not exists active         boolean default true;
-- alter table public.team_profiles add column if not exists role           text;   -- read as profile.role (Admin/CEO/Finance gate)
-- alter table public.inquiries     add column if not exists updated_by     text;
-- alter table public.inquiries     add column if not exists updated_at     timestamptz default now();
-- alter table public.app_settings  add column if not exists updated_at     timestamptz default now();


-- =====================================================================
-- 1. MASTER DATA
-- =====================================================================

create table if not exists public.customers (
  id                    text primary key,
  customer_code         text unique,
  name_en               text not null,
  name_ar               text,
  customer_type         text default 'B2B',          -- B2B | B2C
  vat_number            text,
  cr_number             text,
  contact_person        text,
  phone                 text,
  whatsapp              text,
  email                 text,
  city                  text default 'Jeddah',
  address               text,
  address_en            text,
  address_ar            text,
  credit_limit_sar      numeric(18,2) default 0,
  payment_terms         text default 'Net 30',
  assigned_salesman_id  text,                         -- team_profiles.id (auth user id)
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create table if not exists public.vendors (
  id                text primary key,
  vendor_code       text unique,
  name_en           text not null,
  name_ar           text,
  vendor_origin     text default 'KSA',               -- KSA | International
  vat_number        text,
  tax_id            text,
  cr_number         text,
  contact_person    text,
  phone             text,
  whatsapp          text,
  email             text,
  country           text default 'Saudi Arabia',
  city              text default 'Jeddah',
  address           text,
  default_currency  text default 'SAR',
  payment_terms     text default 'Net 30',
  iban              text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists public.custom_uoms (
  code        text primary key,
  label       text,
  created_at  timestamptz default now()
);

create table if not exists public.items (
  id                      text primary key,
  item_code               text unique,
  item_type               text default 'Goods',       -- Goods | Service
  name_en                 text not null,
  name_ar                 text,
  category                text default 'MEP',
  uom                     text default 'PCS',
  sales_price_sar         numeric(18,4) default 0,
  purchase_price          numeric(18,4) default 0,
  purchase_currency       text default 'SAR',
  zatca_vat_type          text default 'S',
  zatca_exemption_reason  text,
  link_to_supplier        boolean default false,
  preferred_vendor_id     text,
  link_to_customer        boolean default false,
  preferred_customer_id   text,
  is_stocked_item         boolean default false,
  stock_on_hand           numeric(18,4) default 0,
  avg_cost_sar            numeric(18,4),
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);


-- =====================================================================
-- 2. SALES CYCLE
-- =====================================================================

create table if not exists public.sales_orders (
  id                text primary key,
  so_number         text,
  division          text default 'MEP',
  inquiry_id        text,
  quote_number      text,
  customer_po       text,
  client_name       text,
  client_vat        text,
  contact_person    text,
  phone             text,
  email             text,
  payment_terms     text,
  salesman_id       text,
  salesman_name     text,
  commission_pct    numeric(7,4) default 0,
  status            text default 'open',              -- open | partially_delivered | delivered
  items             jsonb default '[]'::jsonb,
  subtotal_sar      numeric(18,2) default 0,
  vat_sar           numeric(18,2) default 0,
  grand_total_sar   numeric(18,2) default 0,
  total_cost_sar    numeric(18,2) default 0,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists public.delivery_notes (
  id                text primary key,
  dn_number         text,
  division          text default 'MEP',
  so_id             text,
  so_number         text,
  client_name       text,
  delivery_type     text default 'partial',           -- full | partial
  items             jsonb default '[]'::jsonb,
  delivered_by      text,
  driver_name       text,
  delivery_address  text,
  notes             text,
  dispatched_at     timestamptz,
  delivered_at      timestamptz default now(),        -- refreshAllErpData orders by this
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists public.invoices (
  id                text primary key,
  invoice_number    text,
  division          text default 'MEP',
  invoice_type      text default 'standard',          -- standard | simplified
  so_id             text,
  so_number         text,
  dn_id             text,
  client_name       text,
  client_vat        text,
  salesman_id       text,
  salesman_name     text,
  commission_pct    numeric(7,4) default 0,
  items             jsonb default '[]'::jsonb,
  subtotal_sar      numeric(18,2) default 0,
  vat_sar           numeric(18,2) default 0,
  grand_total_sar   numeric(18,2) default 0,
  landed_cost_sar   numeric(18,2) default 0,
  paid_amount_sar   numeric(18,2) default 0,
  payment_status    text default 'unpaid',            -- unpaid | partial | paid
  zatca_status      text default 'phase1_qr_ready',   -- phase1_qr_ready | cleared
  zatca_uuid        uuid default gen_random_uuid(),
  qr_base64         text,
  locked            boolean default true,
  issued_at         timestamptz default now(),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists public.customer_receipts (
  id              text primary key,
  receipt_number  text,
  invoice_id      text,
  invoice_number  text,
  client_name     text,
  amount_sar      numeric(18,2) default 0,
  payment_method  text,
  reference_no    text,
  recorded_by     text,
  received_at     timestamptz default now(),
  created_at      timestamptz default now()
);

create table if not exists public.credit_notes (
  id                        text primary key,
  credit_note_number        text,
  original_invoice_id       text,
  original_invoice_number   text,
  client_name               text,
  client_vat                text,
  reason                    text,
  items                     jsonb default '[]'::jsonb,
  subtotal_sar              numeric(18,2) default 0,
  vat_sar                   numeric(18,2) default 0,
  grand_total_sar           numeric(18,2) default 0,
  landed_cost_reversed_sar  numeric(18,2) default 0,
  qr_base64                 text,
  issued_by                 text,
  issued_at                 timestamptz default now(),
  created_at                timestamptz default now()
);

create table if not exists public.commission_ledger (
  id                              text primary key,
  invoice_id                      text,
  invoice_number                  text,
  division                        text default 'MEP',
  client_name                     text,
  salesman_id                     text,
  salesman_name                   text,
  commission_pct                  numeric(7,4) default 0,
  net_profit_sar                  numeric(18,2) default 0,
  total_eligible_commission_sar   numeric(18,2) default 0,
  unlocked_commission_sar         numeric(18,2) default 0,
  paid_out_sar                    numeric(18,2) default 0,
  status                          text default 'awaiting_collection',
      -- awaiting_collection | partially_unlocked | ready_for_payout | reversed_by_credit_note
  created_at                      timestamptz default now(),
  updated_at                      timestamptz default now()
);


-- =====================================================================
-- 3. PURCHASE CYCLE
-- =====================================================================

create table if not exists public.purchase_orders (
  id                      text primary key,
  po_number               text,
  so_id                   text,
  so_number               text,
  supplier_name           text,
  supplier_vat            text,
  supplier_email          text,
  supplier_phone          text,
  payment_terms           text,
  currency                text default 'SAR',
  fx_rate                 numeric(18,6) default 1,
  status                  text default 'po_issued',   -- po_issued | grn_completed | billed | paid
  items                   jsonb default '[]'::jsonb,
  goods_total_fx          numeric(18,4) default 0,
  goods_total_sar         numeric(18,2) default 0,
  landed_cost_sar         numeric(18,2) default 0,
  supplier_vat_sar        numeric(18,2) default 0,
  total_amount_fx         numeric(18,4),              -- auto-filled by trigger if null
  total_landed_sar        numeric(18,2),              -- auto-filled by trigger if null
  input_vat_sar           numeric(18,2),              -- auto-filled by trigger if null (nullable: preview uses ??)
  is_ksa_vat_recoverable  boolean default true,
  bill_status             text default 'unbilled',    -- unbilled | posted | paid
  paid_sar                numeric(18,2) default 0,
  paid_amount_fx          numeric(18,4) default 0,
  paid_amount_sar         numeric(18,2) default 0,
  payment_status          text default 'unpaid',      -- unpaid | partial | paid
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- App.jsx never writes total_amount_fx / total_landed_sar / input_vat_sar,
-- but Payments, Aging, VAT and Dashboard views read them. Fill when null.
create or replace function public.po_fill_derived_totals()
returns trigger language plpgsql set search_path = public as $$
begin
  new.total_amount_fx  := coalesce(new.total_amount_fx,  coalesce(new.goods_total_fx, 0));
  new.total_landed_sar := coalesce(new.total_landed_sar, coalesce(new.goods_total_sar, 0) + coalesce(new.landed_cost_sar, 0));
  new.input_vat_sar    := coalesce(new.input_vat_sar,    new.supplier_vat_sar);
  return new;
end $$;

drop trigger if exists trg_po_fill_derived_totals on public.purchase_orders;
create trigger trg_po_fill_derived_totals
  before insert or update on public.purchase_orders
  for each row execute function public.po_fill_derived_totals();

create table if not exists public.supplier_payments (
  id                  text primary key,
  voucher_number      text,
  po_id               text,
  po_number           text,
  supplier_name       text,
  currency            text default 'SAR',
  amount_fx           numeric(18,4) default 0,
  booked_fx_rate      numeric(18,6) default 1,
  settlement_fx_rate  numeric(18,6) default 1,
  amount_sar          numeric(18,2) default 0,
  fx_variance_sar     numeric(18,2) default 0,
  payment_method      text,
  bank_reference      text,
  payment_date        date default current_date,
  notes               text,
  recorded_by         text,
  created_at          timestamptz default now()
);


-- =====================================================================
-- 4. GENERAL LEDGER
-- =====================================================================

create table if not exists public.gl_accounts (
  account_code     text primary key,
  account_name_en  text not null,
  account_name_ar  text,
  account_type     text not null check (account_type in ('Asset','Liability','Equity','Revenue','Expense')),
  normal_balance   text not null check (normal_balance in ('Debit','Credit')),
  is_system        boolean default false,
  is_active        boolean default true,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create table if not exists public.gl_journal_entries (
  id                 text primary key,
  voucher_number     text,
  entry_date         date default current_date,
  reference          text,
  description        text,
  lines              jsonb default '[]'::jsonb,   -- [{account_code, account_name, debit, credit, memo}]
  total_debit_sar    numeric(18,2) default 0,
  total_credit_sar   numeric(18,2) default 0,
  source_module      text,                        -- CREDIT_NOTE | SUPPLIER_PAY | null (manual)
  source_doc_number  text,
  status             text default 'posted',
  posted_by          text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);


-- =====================================================================
-- 5. DOCUMENT NUMBER RANGES + next_doc_number()
--    Format (matches NumberRangesView.formatPreview):
--      include_year = true  -> PREFIX-YYYY-00001
--      include_year = false -> PREFIX-00001
--    Prefix is stored WITHOUT the trailing '-'; the dash is added here.
-- =====================================================================

create table if not exists public.document_number_ranges (
  doc_type         text primary key,
  label            text,
  prefix           text not null default 'DOC',
  include_year     boolean default false,
  padding          integer default 5,
  next_number      bigint default 1,
  reset_annually   boolean default false,
  last_reset_year  integer,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create or replace function public.next_doc_number(p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type   text := upper(trim(p_doc_type));
  v_year   integer := extract(year from now())::integer;
  r        public.document_number_ranges%rowtype;
  v_num    bigint;
  v_prefix text;
begin
  if v_type is null or v_type = '' then
    raise exception 'next_doc_number: p_doc_type is required';
  end if;

  -- auto-create a default range for unknown doc types
  insert into public.document_number_ranges (doc_type, label, prefix, include_year, padding, next_number)
  values (v_type,
          initcap(replace(lower(v_type), '_', ' ')),
          left(regexp_replace(v_type, '[^A-Z0-9]', '', 'g'), 4),
          false, 5, 1)
  on conflict (doc_type) do nothing;

  -- row lock => concurrent callers are serialized, no duplicate numbers
  select * into r from public.document_number_ranges where doc_type = v_type for update;

  if coalesce(r.reset_annually, false) and r.last_reset_year is not null and r.last_reset_year <> v_year then
    v_num := 1;
  else
    v_num := greatest(coalesce(r.next_number, 1), 1);
  end if;

  update public.document_number_ranges
     set next_number = v_num + 1,
         last_reset_year = v_year,
         updated_at = now()
   where doc_type = v_type;

  v_prefix := rtrim(coalesce(nullif(trim(r.prefix), ''), v_type), '-');

  return v_prefix || '-'
         || case when coalesce(r.include_year, false) then v_year::text || '-' else '' end
         || lpad(v_num::text, greatest(coalesce(r.padding, 5), length(v_num::text)), '0');
end;
$$;

revoke all on function public.next_doc_number(text) from public;
grant execute on function public.next_doc_number(text) to authenticated;

insert into public.document_number_ranges (doc_type, label, prefix, include_year, padding, next_number, reset_annually) values
  ('CUSTOMER',     'Customer Master',            'CUST', false, 5, 1, false),
  ('VENDOR',       'Vendor / Supplier Master',   'VEND', false, 5, 1, false),
  ('ITEM_GOODS',   'Item Master - Goods',        'ITM',  false, 5, 1, false),
  ('ITEM_SERVICE', 'Item Master - Services',     'SRV',  false, 5, 1, false),
  ('INQUIRY',      'Sales Inquiry / Quotation',  'INQ',  true,  5, 1, true),
  ('SO',           'Sales Order',                'SO',   true,  5, 1, true),
  ('DN',           'Delivery Note',              'DN',   true,  5, 1, true),
  ('INVOICE',      'ZATCA Tax Invoice',          'INV',  true,  5, 1, false),
  ('RECEIPT',      'Customer Receipt',           'RCP',  true,  5, 1, true),
  ('PO',           'Purchase Order',             'PO',   true,  5, 1, true),
  ('CREDIT_NOTE',  'ZATCA Credit Note',          'CN',   true,  5, 1, false),
  ('JOURNAL',      'Journal Voucher',            'JV',   true,  5, 1, true),
  ('SUPPLIER_PAY', 'Supplier Payment Voucher',   'SPV',  true,  5, 1, true),
  ('BANK_TXN',     'Bank Transaction',           'BNK',  true,  5, 1, true),
  ('EXPENSE',      'Expense Voucher',            'EXP',  true,  5, 1, true),
  ('ASSET',        'Fixed Asset Register',       'FA',   false, 5, 1, false),
  ('DEPRECIATION', 'Depreciation Run',           'DEP',  true,  5, 1, true),
  ('BILL',         'Supplier Bill',              'BILL', true,  5, 1, true)
on conflict (doc_type) do nothing;


-- =====================================================================
-- 6. KSA CHART OF ACCOUNTS (seed)
--    Codes follow what the code already posts to:
--      CreditNotesView: 4090, 2100, 1100 (AR), 1200 (Inventory), 5010
--      PaymentsAndAgingView: 2010, 1020, 5130 (Bank charges & FX)
--      FinancialStatements: Asset < '1400' = current, >= '1400' = non-current
--      ExecutiveDashboard: cash = 1010+1020; opex = 51xx excl. 5130/5140
-- =====================================================================

insert into public.gl_accounts (account_code, account_name_en, account_name_ar, account_type, normal_balance, is_system) values
  -- Assets (current < 1400)
  ('1010', 'Cash on Hand',                                   'النقدية في الصندوق',                         'Asset',     'Debit',  true),
  ('1020', 'Bank - Main Current Account (SAR)',              'البنك - الحساب الجاري الرئيسي',              'Asset',     'Debit',  true),
  ('1030', 'Bank - Secondary Account',                       'البنك - الحساب الثانوي',                     'Asset',     'Debit',  true),
  ('1040', 'Petty Cash',                                     'العهدة النقدية (المصروفات النثرية)',         'Asset',     'Debit',  true),
  ('1100', 'Accounts Receivable (Trade Customers)',          'الذمم المدينة (العملاء)',                    'Asset',     'Debit',  true),
  ('1150', 'VAT Input Recoverable (15%)',                    'ضريبة القيمة المضافة على المدخلات القابلة للاسترداد', 'Asset', 'Debit', true),
  ('1200', 'Inventory / Warehouse Stock',                    'المخزون / بضاعة المستودع',                   'Asset',     'Debit',  true),
  ('1300', 'Prepaid Expenses',                               'مصروفات مدفوعة مقدماً',                      'Asset',     'Debit',  true),
  -- Assets (non-current >= 1400)
  ('1500', 'Fixed Assets - Equipment & Vehicles',            'الأصول الثابتة - المعدات والمركبات',          'Asset',     'Debit',  true),
  ('1510', 'Fixed Assets - IT & Office Equipment',           'الأصول الثابتة - أجهزة تقنية ومعدات مكتبية',  'Asset',     'Debit',  true),
  ('1590', 'Accumulated Depreciation',                       'مجمع الإهلاك',                               'Asset',     'Credit', true),
  -- Liabilities
  ('2010', 'Accounts Payable (Trade Suppliers)',             'الذمم الدائنة (الموردون)',                   'Liability', 'Credit', true),
  ('2100', 'VAT Payable / Output VAT (15%)',                 'ضريبة القيمة المضافة المستحقة (المخرجات)',   'Liability', 'Credit', true),
  ('2200', 'Accrued Expenses',                               'مصروفات مستحقة',                             'Liability', 'Credit', true),
  ('2300', 'Commission Payable',                             'عمولات مستحقة الدفع',                        'Liability', 'Credit', true),
  -- Equity
  ('3010', 'Owner''s Capital / Share Capital',               'رأس المال',                                  'Equity',    'Credit', true),
  ('3020', 'Retained Earnings',                              'الأرباح المبقاة',                            'Equity',    'Credit', true),
  -- Revenue
  ('4010', 'Revenue - MEP Division',                         'الإيرادات - قسم الأعمال الكهروميكانيكية',     'Revenue',   'Credit', true),
  ('4020', 'Revenue - IT & ELV Division',                    'الإيرادات - قسم تقنية المعلومات والأنظمة منخفضة الجهد', 'Revenue', 'Credit', true),
  ('4090', 'Sales Returns & Credit Notes',                   'مردودات المبيعات والإشعارات الدائنة',         'Revenue',   'Debit',  true),
  ('4900', 'Other Income',                                   'إيرادات أخرى',                               'Revenue',   'Credit', true),
  -- Expenses (50xx = COGS in FinancialStatements; rest = OPEX)
  ('5010', 'Cost of Goods Sold (Landed COGS)',               'تكلفة البضاعة المباعة',                      'Expense',   'Debit',  true),
  ('5100', 'General Expenses',                               'مصروفات عمومية',                             'Expense',   'Debit',  true),
  ('5130', 'Bank Charges & Realized FX Gain/Loss',           'رسوم بنكية وفروقات صرف العملات المحققة',     'Expense',   'Debit',  true),
  ('5140', 'Salesman Commission Expense (Commission Ledger)', 'مصروف عمولات المبيعات (سجل العمولات)',       'Expense',   'Debit',  true),
  ('5200', 'Salaries & Wages',                               'الرواتب والأجور',                            'Expense',   'Debit',  true),
  ('5210', 'Rent',                                           'الإيجار',                                    'Expense',   'Debit',  true),
  ('5220', 'Utilities & Telecom',                            'المرافق والاتصالات',                         'Expense',   'Debit',  true),
  ('5230', 'Transport & Fuel',                               'النقل والوقود',                              'Expense',   'Debit',  true),
  ('5240', 'Office & Admin',                                 'مصروفات مكتبية وإدارية',                     'Expense',   'Debit',  true),
  ('5250', 'Marketing',                                      'التسويق',                                    'Expense',   'Debit',  true),
  ('5260', 'Bank Charges',                                   'الرسوم البنكية',                             'Expense',   'Debit',  true),
  ('5270', 'Depreciation Expense',                           'مصروف الإهلاك',                              'Expense',   'Debit',  true),
  ('5280', 'Sales Commission Expense',                       'مصروف عمولات المبيعات',                      'Expense',   'Debit',  true),
  ('5290', 'Government Fees (GOSI / Iqama / Municipality)',  'الرسوم الحكومية (التأمينات / الإقامة / البلدية)', 'Expense', 'Debit', true)
on conflict (account_code) do nothing;


-- =====================================================================
-- 7. INDEXES
-- =====================================================================

create index if not exists idx_sales_orders_inquiry_id      on public.sales_orders (inquiry_id);
create index if not exists idx_sales_orders_created_at      on public.sales_orders (created_at desc);
create index if not exists idx_delivery_notes_so_id         on public.delivery_notes (so_id);
create index if not exists idx_delivery_notes_delivered_at  on public.delivery_notes (delivered_at desc);
create index if not exists idx_invoices_so_id               on public.invoices (so_id);
create index if not exists idx_invoices_dn_id               on public.invoices (dn_id);
create index if not exists idx_invoices_issued_at           on public.invoices (issued_at desc);
create index if not exists idx_customer_receipts_invoice_id on public.customer_receipts (invoice_id);
create index if not exists idx_customer_receipts_received   on public.customer_receipts (received_at desc);
create index if not exists idx_credit_notes_orig_invoice    on public.credit_notes (original_invoice_id);
create index if not exists idx_credit_notes_issued_at       on public.credit_notes (issued_at desc);
create index if not exists idx_commission_ledger_invoice_id on public.commission_ledger (invoice_id);
create index if not exists idx_commission_ledger_salesman   on public.commission_ledger (salesman_id);
create index if not exists idx_commission_ledger_updated_at on public.commission_ledger (updated_at desc);
create index if not exists idx_purchase_orders_so_id        on public.purchase_orders (so_id);
create index if not exists idx_purchase_orders_created_at   on public.purchase_orders (created_at desc);
create index if not exists idx_supplier_payments_po_id      on public.supplier_payments (po_id);
create index if not exists idx_gl_je_entry_date             on public.gl_journal_entries (entry_date);
create index if not exists idx_gl_je_source_doc_number      on public.gl_journal_entries (source_doc_number);
create index if not exists idx_gl_je_lines_gin              on public.gl_journal_entries using gin (lines);
create index if not exists idx_customers_name_en            on public.customers (name_en);
create index if not exists idx_vendors_name_en              on public.vendors (name_en);
create index if not exists idx_items_name_en                on public.items (name_en);


-- =====================================================================
-- 8. RLS: authenticated users get full CRUD on every table created here
-- =====================================================================

do $$
declare
  t text;
  tables text[] := array[
    'commission_ledger','credit_notes','custom_uoms','customer_receipts','customers',
    'delivery_notes','document_number_ranges','gl_accounts','gl_journal_entries',
    'invoices','items','purchase_orders','sales_orders','supplier_payments','vendors'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_auth_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_auth_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_auth_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_auth_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_auth_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (true)', t || '_auth_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t || '_auth_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (true)', t || '_auth_delete', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;


-- =====================================================================
-- 9. REALTIME: App.jsx subscribes to postgres_changes on schema public
--    and refreshes on any change. Add new tables to the publication.
-- =====================================================================

do $$
declare
  t text;
  tables text[] := array[
    'commission_ledger','credit_notes','custom_uoms','customer_receipts','customers',
    'delivery_notes','document_number_ranges','gl_accounts','gl_journal_entries',
    'invoices','items','purchase_orders','sales_orders','supplier_payments','vendors'
  ];
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array tables loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;


-- =====================================================================
-- CHECKLIST - columns / choices to double-check
-- ---------------------------------------------------------------------
-- [x] App.jsx now loads gl_accounts, gl_journal_entries, supplier_payments and
--     mounts the GL / Financial Statements / Payments / Dashboard views.
-- [x] App.jsx now writes purchase_orders.total_amount_fx (goods + landed + VAT, in
--     PO currency), total_landed_sar and input_vat_sar on PO creation. The trigger
--     is only a fallback for rows inserted without them.
-- [ ] purchase_orders.paid_sar (App.jsx "mark paid" patch) is separate from
--     paid_amount_sar (PaymentsAndAgingView).
-- [x] salesman_id / assigned_salesman_id are text (works with uuid or text team_profiles.id).
-- [ ] customers.address, whatsapp; vendors.tax_id, whatsapp: only read
--     (preview modals fallbacks), never written.
-- [ ] items.stock_on_hand / avg_cost_sar: read by ExecutiveDashboard, never written.
-- [ ] delivery_notes.driver_name / delivery_address / dispatched_at: read only.
-- [ ] sales_orders.customer_po / quote_number / payment_terms: read only.
-- [ ] invoices.zatca_uuid: read only; defaults to gen_random_uuid().
-- [ ] 5140 meaning is inferred: ExecutiveDashboard leaves 5130 and 5140 out of
--     opex because FX variance and commissions are already subtracted on their own,
--     so 5140 = commission expense. This overlaps with 5280; choose one for postings.
-- [x] ExecutiveDashboard now counts 51xx-59xx as opex (excl. 5130/5140/5280).
-- [x] VAT input = 1150 (current asset), posted by Supplier Bills and Expense Vouchers.
-- [ ] 1400 deliberately not seeded: Inventory is 1200 in code, and codes >= 1400
--     count as non-current.
-- [ ] Number format: prefix is stored without '-'; function returns
--     PREFIX-YYYY-NNNNN or PREFIX-NNNNN, the same as NumberRangesView preview.
-- =====================================================================

-- Refresh the Supabase API schema cache so the app sees the new tables immediately
notify pgrst, 'reload schema';
