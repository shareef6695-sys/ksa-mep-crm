-- =====================================================================
-- KSA ERP — Extended Finance Module tables
-- Run AFTER schema_existing.sql (Supabase Dashboard → SQL Editor).
-- Idempotent: safe to re-run.
-- Tables: expense_vouchers, fixed_assets, gl_budgets, bank_reconciliations
-- (Period lock is stored in app_settings key = 'gl_period_lock'.)
-- =====================================================================

-- ---------- Expense Vouchers ----------
create table if not exists public.expense_vouchers (
  id                     text primary key,
  voucher_number         text,
  expense_date           date not null default current_date,
  payee                  text not null default '',
  vendor_id              text,
  expense_account_code   text not null,
  description            text default '',
  division               text default 'Shared',          -- 'MEP' | 'IT & ELV' | 'Shared'
  amount_sar             numeric(18,2) not null default 0, -- net of VAT
  vat_sar                numeric(18,2) not null default 0,
  total_sar              numeric(18,2) not null default 0,
  vat_recoverable        boolean not null default true,
  paid_from_account_code text not null default '1020',    -- 1010/1020/1030/1040 or 2010 (on credit)
  payment_reference      text default '',
  status                 text not null default 'posted',  -- 'posted' | 'void'
  journal_voucher_number text,
  posted_by              text,
  created_at             timestamptz not null default now()
);
create index if not exists idx_expense_vouchers_date    on public.expense_vouchers (expense_date);
create index if not exists idx_expense_vouchers_account on public.expense_vouchers (expense_account_code);

-- ---------- Fixed Assets ----------
create table if not exists public.fixed_assets (
  id                           text primary key,
  asset_code                   text,
  name                         text not null,
  category_account_code        text not null default '1500', -- 1500 | 1510
  acquisition_date             date not null default current_date,
  cost_sar                     numeric(18,2) not null default 0,
  salvage_value_sar            numeric(18,2) not null default 0,
  useful_life_months           integer not null default 60,
  depreciation_method          text not null default 'straight_line',
  accumulated_depreciation_sar numeric(18,2) not null default 0,
  last_depreciation_period     text,                           -- 'YYYY-MM'
  paid_from_account_code       text,
  status                       text not null default 'active', -- 'active' | 'disposed' | 'fully_depreciated'
  disposal_date                date,
  disposal_proceeds_sar        numeric(18,2),
  created_at                   timestamptz not null default now()
);
create index if not exists idx_fixed_assets_acq      on public.fixed_assets (acquisition_date);
create index if not exists idx_fixed_assets_category on public.fixed_assets (category_account_code);
create index if not exists idx_fixed_assets_status   on public.fixed_assets (status);

-- ---------- GL Budgets ----------
create table if not exists public.gl_budgets (
  id                text primary key,                  -- 'bud-<year>-<code>'
  fiscal_year       integer not null,
  account_code      text not null,
  annual_amount_sar numeric(18,2) not null default 0,
  monthly_amounts   jsonb not null default '[0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb,
  notes             text default '',
  updated_at        timestamptz not null default now(),
  constraint gl_budgets_year_account_key unique (fiscal_year, account_code)
);
create index if not exists idx_gl_budgets_account on public.gl_budgets (account_code);

-- ---------- Bank Reconciliations ----------
create table if not exists public.bank_reconciliations (
  id                text primary key,
  account_code      text not null,
  statement_date    date not null,
  statement_balance numeric(18,2) not null default 0,
  cleared_keys      jsonb not null default '[]'::jsonb, -- ['<gl_entry_id>:<line_idx>', ...]
  book_balance      numeric(18,2) not null default 0,
  difference        numeric(18,2) not null default 0,
  status            text not null default 'draft',      -- 'draft' | 'completed'
  reconciled_by     text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_bank_recon_account on public.bank_reconciliations (account_code, statement_date);

-- ---------- Row Level Security: authenticated users have full access ----------
do $$
declare t text;
begin
  foreach t in array array['expense_vouchers', 'fixed_assets', 'gl_budgets', 'bank_reconciliations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
  end loop;
end $$;

-- ---------- Realtime (app refreshes on postgres_changes) ----------
do $$
declare t text;
begin
  foreach t in array array['expense_vouchers', 'fixed_assets', 'gl_budgets', 'bank_reconciliations'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
