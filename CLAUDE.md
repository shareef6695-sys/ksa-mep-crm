# Horizon ERP (KSA) — notes for Claude Code

ERP for a Saudi MEP and IT/ELV trading company: sales, procurement, finance, ZATCA e-invoicing.
Bilingual EN/AR (RTL). Currency SAR.

## Stack
- React 19 + Vite 6 + Tailwind 4, plain JSX (no TypeScript), lucide-react icons.
- Supabase (Postgres, Auth, Realtime). Client in `src/lib/supabase.js`, configured from `.env`
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; see `.env.example`). Hosting must set the same two variables.
- Scripts: `npm run dev`, `npm run build`, `npm run lint`, `npm test` (Vitest), `npm run test:sql` (all SQL suites, needs
  a local Postgres via PG* variables), `npm run test:e2e` (Playwright; needs a seeded local Supabase, see README).

## Folder map (Prompt 15)
- `src/main.jsx` — React Router (`BrowserRouter`). Each screen is a URL: `/<screen id>` (ids = navTree / `MODULE_ACCESS` keys),
  documents are `/object/<invoice|so|po>/<id>`. Hosting must serve `index.html` for every path (README: SPA fallback).
- `src/App.jsx` — shell only: sign-in gate, header, side navigation, launchpad, lazy-loaded feature bundles.
- `src/app/useErpStore.js` — application state: data tables (`DATA_TABLES`, `refreshAllErpData`, realtime), settings,
  navigation (from the URL), derived values. `src/app/ErpContext.js` shares it (`useErp()`); `constants.js`, `LoginLandingPage.jsx`.
- `src/features/<sales|purchase|finance|inventory|projects|admin|objects>/` — `*Screens.jsx` (the screens of that module,
  loaded on first use), `*Modals.jsx` (its dialogs), `use*Actions.js` (its handlers; get the store as `s`).
  `features/finance/suite/` = the Finance Suite screens (bank, expenses, fixed assets, budget, cash flow, statements, period close).
  To add a screen: navTree entry in useErpStore, `MODULE_ACCESS` in permissions.js, `SCREEN_FEATURE` in App.jsx, block in the feature's Screens file.
- `src/erp/` — larger shared views (master data, credit notes, GL, statements, aging, VAT, ZATCA, inventory, procurement, projects).
- `src/lib/` — supabase client, permissions, fetchAll, zatca helpers, `quoteMath.js`, `aging.js` (pure, unit-tested).
- `src/ui/` — Fiori-style shell, SmartFilterBar, i18n (`t()`), `financeI18n.js` + `financeAr.js` (Arabic finance screens: `tr()`).
- `supabase/migrations/` — the source of truth for the database. `0001_baseline.sql` = schema as of 2026-11-22.
  The old hand-run scripts (`schema_existing.sql`, `schema_finance.sql`) were removed: they created allow-all RLS policies.
  Never add a `using (true)` policy for `authenticated`: policies are OR-ed, so one such policy undoes every role rule.
- `supabase/functions/` — Edge Functions `admin-users`, `zatca`, `notify` (+ `_shared/zatca`, `_shared/notify`).
- `supabase/tests/` — SQL suites (`run_sql_tests.sh` runs them all in the right order on a throw-away Postgres;
  `supabase_stub.sql` stands in for Supabase's `auth` schema), Vitest tests for the Edge Function code.
- `e2e/` — Playwright end-to-end tests (`seed.mjs` seeds a local Supabase stack). CI: `.github/workflows/ci.yml`.

## Business flow
- Sales: Inquiry/Quote (BOQ, FX cost, margin) → Sales Order → Delivery Note (full/partial) → ZATCA Invoice (from DN)
  → Customer Receipt. Credit Note against an invoice.
- Purchase: Purchase Order → GRN → Supplier Bill (with landed cost) → Supplier Payment (realised FX).
- Commission: accrued on invoice as % of net profit, unlocked in proportion to collections, clawed back by credit notes.
- Document numbers come from `next_doc_number(doc_type)` (server-side, row-locked).

## Chart of accounts used by auto-postings
1010 Cash · 1020/1030 Bank · 1040 Petty cash · 1100 AR · 1150 Input VAT · 1200 Inventory · 1300 Prepaid ·
1500/1510 Fixed assets · 1590 Accumulated depreciation · 2010 AP · 2100 Output VAT · 2200 Accrued · 2300 Commission payable ·
3010 Capital · 3020 Retained earnings · 4010 Revenue MEP · 4020 Revenue IT & ELV · 4090 Sales returns · 4900 Other income ·
5010 COGS · 5100–5290 Opex (5130 bank charges & FX, 5140 commission expense, 5270 depreciation; 5280 retired in 0007) ·
2050 Customer advances & refunds due · 5990 Rounding differences.
Rule in reports: assets < 1400 are current; 50xx = COGS; other 5xxx = opex.
Do not add or rename accounts without saying so in your summary — the accountant reviews CoA changes.

## Money rules
- SAR amounts `numeric(18,2)`, FX amounts/prices `numeric(18,4)`, FX rates `numeric(18,6)`. Round to 2 dp per line.
- VAT 15% standard (being moved to per-line VAT categories S/Z/E/O). Every journal must balance exactly.

## Working rules
- Every DB change is a new numbered, idempotent file in `supabase/migrations/` (`0002_...sql`). Never edit an old one.
  Test it on local Postgres with `supabase/tests/supabase_stub.sql` first; the user runs it on a Supabase branch, then production.
- Business writes that touch more than one table go through ONE Postgres function in one transaction, not several client calls.
- Never trust the client for roles, totals, VAT, document numbers or the period lock; enforce them in SQL.
- Posted documents are not edited; corrections are reversing documents.
- Check and show every Supabase `error`; never swallow it.
- Keep EN and AR strings together when adding UI text.
- Run `npm run build`, `npm run lint` (0 errors) and `npm test` before saying a task is done.
- Ask before deleting data, dropping columns or changing what an existing column means.

## Roles and access (migration 0002)
- Roles live in `user_roles` (admin, ceo, finance, manager, sales_mep, sales_it, procurement). The Team screen still
  edits `team_profiles.role_key`; a trigger syncs it into `user_roles`. No active role = no access.
- Sales roles see only their own records and never see cost, landed cost, margin or net profit. They read sales
  documents through the views `inquiries_v`, `sales_orders_v`, `delivery_notes_v`, `invoices_v`, `credit_notes_v`,
  `commission_ledger_v`, `items_v` (the app reads these for every role). Quotes are written only via
  `rpc('save_inquiry')`, which keeps costs, margin, approval and the 'won' stage out of sales' hands.
- Managers price quotes and convert them to SOs; Procurement & Logistics records delivery notes; Finance issues
  invoices, credit notes and receipts and owns the GL.
- UI helpers in `src/lib/permissions.js` must match the SQL. The database is the real gate.
- Access tests: `supabase/tests/rls_check.sql` (see its header for the run order).

## User management (Edge Function `admin-users`)
- Logins are created, re-roled, deactivated and password-reset ONLY by `supabase/functions/admin-users`
  (caller must be an active admin). Never call `auth.signUp` from the browser.
- App calls it with `supabase.functions.invoke('admin-users', { body: { action, ... } })` — see `callAdminUsers` in App.jsx.
- Deploy: `supabase functions deploy admin-users --project-ref <ref>` (or Dashboard → Edge Functions → Deploy new
  function → name `admin-users`, paste index.ts, keep "Verify JWT" on). The service-role key is injected by Supabase.
- After deploying: Dashboard → Authentication → Sign In / Providers → turn OFF "Allow new users to sign up".
- Deactivate = `team_profiles.active=false` (syncs to `user_roles`) + an Auth ban, which also ends open sessions.

## Audit, locked documents, period lock (migration 0003)
- Every write to a business table is recorded in `audit_log` (Team & Administration → Audit Log). Rows carry
  `created_by_uid` / `updated_by_uid`. Nobody can edit or delete the log.
- Posted documents can't be edited or deleted: journals, receipts, supplier payments, credit notes; invoices only
  change paid amount / status (and total downwards for credit notes, until Prompt 6); expenses only posted → void;
  invoiced delivery notes can't be deleted. Correct mistakes with reversing documents.
- Period lock lives in `gl_period_locks` (history; newest row wins), set via `rpc('set_period_lock')`. The database
  rejects any journal or document dated on/before it. The `app_settings` 'gl_period_lock' value is a mirror for the UI.
- SQL Editor / service-role sessions (no signed-in user) bypass these guards for maintenance, but are still audited.
- Tests: `supabase/tests/audit_lock_check.sql`.

## Posting (migrations 0004 + 0005)
- Every business event is ONE database function; the app calls it with `supabase.rpc(...)` and shows `error.message`:
  `post_sales_order`, `post_delivery_note`, `post_invoice`, `post_customer_receipt`, `post_credit_note`,
  `post_purchase_order`, `post_goods_receipt`, `post_supplier_bill`, `post_supplier_payment`, `post_expense_voucher`,
  `void_expense_voucher`, `post_journal` (MANUAL / BANK_TRANSFER / BANK_CHARGE / YEAR_END_CLOSE), `post_fixed_asset`,
  `post_depreciation_run`, `dispose_fixed_asset`. Quotes still save through `save_inquiry`.
- Functions compute totals, VAT, document numbers and the ZATCA QR themselves and post the journal via the internal
  `_gl_post` (balance to the halala; drift ≤ SAR 0.05 → 5990). Never compute postings in the browser again.
- `gl_journal_lines` holds one row per debit/credit (FK to `gl_accounts`), filled by a trigger from
  `gl_journal_entries.lines`; reports should move to it (Prompt 8). `gl_backfill_issues` / `orphan_references` list old data problems.
- After 0005 the browser has no INSERT/UPDATE/DELETE on posting tables; add a function instead of a direct write.
- New ids are server-generated uuids. Supplier bills use their own BILL range. Supplier payments choose the pay-from 10xx account.
- Tests: `supabase/tests/posting_check.sql` (full sales + purchase + finance cycle with exact balances).

## Credit notes, receipts, customer credit (migration 0006)
- Invoices never change after issue. Open balance = `grand_total_sar - paid_amount_sar - credited_amount_sar`
  (`invoiceOpenSar()` in erpEngine.js, view `invoice_balances`). Never compute it as grand − paid.
- Credit notes: `post_credit_note(p_invoice_id, p_return_qtys, p_reason, p_reason_code)` caps each line at invoiced minus
  already credited (`rpc('invoice_credited_qty')`). On a paid invoice the excess goes to 2050 and the customer-credit ledger.
- Receipts: `post_receipt(client, amount, method, ref, date, allocations[])` pays several invoices; the remainder is held
  on account (2050). `post_customer_receipt` (one invoice) still works. Allocations live in `receipt_allocations`.
- Customer credit: `customer_credit_ledger` / `customer_credit_balances`; use with `apply_customer_credit` or
  `post_customer_refund`. UI: AR Customer Receipts → CustomerReceiptsPanel.
- Data checks: `legacy_overpaid_invoices`, `invoice_payment_mismatches`. Tests: `supabase/tests/credit_check.sql`.

## Commission (migration 0007)
- Commission unlocks as the customer pays (unchanged rule). Each change in the unlocked amount is posted
  Dr 5140 / Cr 2300 (reversed on clawback) by `_commission_accrue`, called from `_invoice_sync`;
  `commission_ledger.expensed_sar` = what is in the GL. Never post commission any other way.
- Payout: `post_commission_payout(salesman_id, commission_ids[], pay_from 10xx|2200, reference, date)` →
  Dr 2300 / Cr pay-from; history in `commission_payouts` + `commission_payout_lines` (immutable).
- Statuses: awaiting_collection, partially_unlocked, ready_for_payout, paid, overpaid (clawed back after payout:
  2300 shows a debit owed by the salesperson), reversed_by_credit_note.
- `commission_statement` view: per salesperson eligible / unlocked / paid / payable / overpaid (sales see only their own).
- UI: Sales Profit Share → CommissionPayoutPanel. Dashboard takes commission from GL 5140.
- Tests: `supabase/tests/commission_check.sql`.

## Data loading and reports (migration 0008)
- Supabase returns at most 1,000 rows per request. Never load a list with a bare `select()`: add it to
  `DATA_TABLES` in App.jsx (read via `fetchAllRows` from `src/lib/fetchAll.js`, ordered by a unique key last).
- Realtime reloads only the changed table (`queueTableReload`, 400 ms debounce). Tables a role can't read are skipped (`gate`).
- Reports run in SQL over `gl_journal_lines`: `gl_account_activity(from,to)`, `trial_balance(as_of)`,
  `profit_and_loss(from,to)`, `balance_sheet(as_of)`, `ar_aging(as_of)`, `ap_aging(as_of)`, `gl_integrity_issues()`.
  Financial Statements and the GL trial balance use `gl_account_activity`, with the in-browser sum only as a fallback.
- Still to move server-side (Prompt 15 refactor): per-screen paging/filtering, cash flow, budget vs actual,
  party statements, dashboard. Tests: `supabase/tests/reporting_check.sql` (22k lines; reports ≈0.1 s locally).

## VAT (migration 0009)
- VAT is per line: each quote/SO/invoice line carries `vatCategory` (S/Z/E/O, from the item's `zatca_vat_type`) and,
  for Z/E/O, an `exemptionReason` VATEX code (`vat_exemption_reasons`). Use `_line_rate` / `_line_vat_fields` in SQL and
  the `erpEngine` VAT helpers in JS — never assume 15% on the document total. Invoices store `vat_breakdown` per category.
- Input VAT (1150) is claimed only from POSTED supplier bills, expenses and customs declarations (`post_import_vat`),
  never from a PO. Foreign supplier: no VAT on the PO; services → reverse charge (2100 and 1150) when the bill posts;
  goods → VAT paid at customs, recorded from Supplier Bills.
- Invoices snapshot `seller_address` / `buyer_address` and set `zatca_warnings` (e.g. B2B buyer without a valid VAT
  or national address). Customers carry building_no/street/district/postal_code/additional_no; VAT format
  `^3\d{13}3$` is enforced (`is_valid_ksa_vat`; legacy bad rows listed in view `invalid_vat_numbers`).
- `vat_return(from,to)` returns ZATCA boxes 1–10, 12, 13, 16 plus GL-2100 / GL-1150 and GL-DIFF-OUT / GL-DIFF-IN
  (return minus ledger; should be 0). Screen: `src/erp/VatReturnView.jsx` (falls back to the old in-browser view).
  Not tracked yet: boxes 11, 14, 15. Tests: `supabase/tests/vat_check.sql` (run after credit_check, see its header).
- ZATCA Phase 2 waves: Wave 24 (>SAR 375k taxable revenue in 2022–2024) by 30 Jun 2026; Wave 25 (>SAR 187.5k in
  2022–2025) by 1 Feb 2027. Company profile stores `taxableRevenueByYear` for the advice banner.

## ZATCA Phase 2 (migration 0010 + Edge Function `zatca`)
- Built in-house. All cryptography is in `supabase/functions/_shared/zatca/` (pure TS, shared by the Edge Function and
  Vitest): `der.ts` (ASN.1), `crypto.ts` (secp256k1 key, CSR, certificate reading), `ubl.ts` (UBL 2.1 XML, invoice hash,
  XAdES stamp, QR tags 1-9), `mapping.ts` (DB payload -> XML model, compliance sample set), `api.ts` (Fatoora gateway).
- Never hand-edit XML layout: the invoice hash and the signed-properties digest depend on the serializer's exact
  4-space layout. After any change run `npm test` AND `python3 supabase/tests/zatca/crosscheck.py` (independent check
  with Python cryptography + lxml, the same method as Odoo's l10n_sa_edi).
- Rounding (0010): line net = round(qty x price, 2); VAT per category = round(sum of line nets x rate, 2). The SQL
  (`_vat_breakdown`, post_invoice / post_credit_note / post_debit_note) and `computeTotals` in ubl.ts must agree;
  the Edge Function refuses to submit when XML totals differ from the row (`totalsMismatch`).
- Keys / CSIDs live in `zatca_egs`, AES-GCM encrypted with the `ZATCA_ENC_KEY` function secret; no grants to
  anon/authenticated; the UI reads `zatca_egs_status`. Chain: `zatca_begin` (lease) -> sign -> `zatca_commit`
  (ICV/PIH advance) -> send -> `zatca_record_result`. All service-role only.
- Document states (`zatca_status`): phase1_qr_ready (issued before Phase 2), pending, submitting, retrying, rejected,
  cleared (B2B), reported (B2C). A Phase 2 B2B document cannot be printed or shared until cleared (`blocksSharing`
  in src/lib/zatca.js). Rejected documents are re-signed with a new UUID and the next ICV after the data is fixed.
- Debit notes: `debit_notes` table, `post_debit_note`; open balance = grand + debited - paid - credited everywhere
  (`invoiceOpenSar`, `invoice_balances`, `_invoice_sync`, receipts, `ar_aging`).
- Schedule the queue (B2C within 24 h): `supabase/snippets/zatca_queue_schedule.sql`. Tests: `supabase/tests/zatca_check.sql`
  (after vat_check), `supabase/tests/zatca/zatca.test.ts`.
- Not done yet: CSID renewal (PATCH production/csids with a new OTP) — re-onboard a new EGS before the certificate
  expires; export invoices (KSA-2 export flag); third-party / nominal / summary / self-billed invoice flags.

## Inventory (migration 0011)
- Only items with `is_stocked_item` are tracked. Stock lives in `item_stock` (qty, value, moving-average cost per item and
  warehouse); `stock_moves` is the immutable ledger; `stock_documents` holds opening / adjustment / count / transfer docs.
  Every change goes through `_stock_move` inside a posting function — never write these tables from the app.
- Postings: GRN Dr 1200 / Cr 2150 (stocked lines at PO cost incl. landed cost) · bill Dr 2150 (= GRN value) + Dr 5010
  (non-stock lines, differences) / Cr 2010 · delivery note Dr 5010 / Cr 1200 at average cost · invoice: no stock lines
  (only for deliveries from before 0011) · credit note: stocked lines back in at their delivery cost · adjustments and
  counts vs 5020 · transfers move value between warehouses.
- Negative stock is allowed (business decision): the delivery warns, takes cost at the last known average, and the next
  receipt re-prices those units (difference to 5010). Invariant: stock ledger value = GL 1200 — see
  `inventory_reconciliation()`; keep it at 0 difference.
- Go-live: count each warehouse and post `post_opening_stock`. GL 1200 is set to the stock value; the first opening also moves
  POs received under the old rules and not billed to 2150, and the rest of the old 1200 balance to 3020 Retained earnings.
- Serialised items (`is_serialized`) need one serial per unit on GRN, opening and transfer, and on delivery when serials are in stock.
- Line flow: quote `itemId` -> SO line -> DN line (`stockIssued`, `warehouse`, actual `unitCostSar`, `cogsSar`) -> invoice / credit note.
  `redact_costs` hides `avg_cost_sar`, `cogsSar`, `estUnitCostSar` from sales roles; `item_stock_v` shows them qty only.
- Tests: `supabase/tests/inventory_check.sql` (run right after 0011, before any other stock movement).
- Not yet: multi-line POs and partial receipts (Prompt 12), per-line drop-ship flag on a stocked item, serial selection on customer returns.

## Procurement (migration 0012)
- PO lines (`purchase_orders.items`): `line`, itemId, desc, qty, uom, unitCostFx, vatCategory, is_stocked_item, soId/soLineId,
  and running `receivedQty`, `receivedValue` (GRNI), `billedQty`, `billedSar`, `grniCleared`, `closedQty`. Never edit them
  from the app: `post_goods_receipt`, `post_supplier_bill`, `close_purchase_order` maintain them.
- Status comes from the lines (`_po_status`): pending_approval -> po_issued -> partially_received -> grn_completed (all
  received) -> partially_billed -> billed -> paid; closed (short-closed) / cancelled. Use `openToReceive` / `openToBill`
  (src/erp/ProcurementPanels.jsx) in the UI instead of comparing statuses.
- Approval: totals above `procurement_settings.managerApprovalAboveSar` need a manager/CEO, above `ceoApprovalAboveSar`
  the CEO (admin can always). The raiser can't approve their own PO. Settings are edited in Company settings.
- Documents: `goods_receipts` (GRN-), `supplier_bills` (BILL-, supplier invoice no. unique per supplier, due date from
  terms), `purchase_requisitions` (PR-, `create_requisition_from_so`). Bills: billed qty <= received - billed (3-way
  match), price variance > `priceTolerancePct` is a warning, landed cost on the bill allocated by value or qty, GRNI cleared
  pro rata, differences to 5010. POs billed before 0012 got one `legacy` bill each.
- Supplier payments stay per PO (advances allowed). `ap_aging()` and the AP aging screen age each bill by due date,
  applying PO payments to its bills oldest first. The VAT return reads `supplier_bills` by bill date.
- Tests: `supabase/tests/procurement_check.sql` (after inventory_check and 0012).

## Sales controls (migration 0013)
- `app_settings.sales_settings`: minMarginPct, approvalAboveSar (excl. VAT), overdueBlockDays — edited in Company settings.
- Quote approval lives in `data.approval` (status, by, at, fingerprint). `approve_quote` sets it; the fingerprint covers
  margin + lines + costs, so any pricing change voids it. A BEFORE INSERT trigger on sales_orders refuses an SO from a
  quote that needs approval and doesn't have a current one — every path is covered. `save_inquiry` never accepts
  approval / stage / revision / lost fields from the client, and refuses edits to won quotes.
- Stages: new_inquiry, quoted, negotiation, lost (`set_quote_stage`, lost needs a reason code), won (only via SO).
  Revisions: `revise_quote` snapshots into `quote_revisions` and moves A -> B -> C; `validUntil` defaults to +30 days.
  `sales_pipeline()` / Sales Pipeline screen. Sales never see margin figures (`inquiry_public_data`, `quote_approvals`).
- Credit control: BEFORE INSERT triggers on sales_orders and invoices check `_customer_exposure` (open AR + open orders +
  new amount vs `customers.credit_limit_sar`, and invoices > overdueBlockDays past due). Invoicing an SO only counts what
  goes beyond the SO's open value. Finance unblocks one document with `grant_credit_override` (SO: quote id,
  INVOICE: delivery note id, SO_AMEND: SO id).
- Invoices carry `payment_terms` and `due_date` (SO / customer terms); `ar_aging()` and the aging screens age by days past due.
- `amend_sales_order` (qty not below delivered, price only before any delivery) and `cancel_sales_order` (undelivered
  qty), logged in `sales_order_changes`.
- Tests: `supabase/tests/sales_check.sql` (after 0013). vat_check / zatca_check set minMarginPct to 0 (quotes at cost).

## Projects, contracts, service tickets (migration 0014)
- `projects` (billing_method delivery | percent | boq, retention_pct, advance_pct, budget, boq). SOs link with
  `link_sales_order_to_project`; POs (`project_id`, `cost_type` material | subcontract, default from the SO's project) and
  expense vouchers (`project_id`) carry a project too. Sales roles cannot read projects (budgets / costs).
- `gl_journal_lines.project_id`: posting functions call `_project_ctx(project)` before `_gl_post`, which stamps every line
  that has no `project_id` of its own and then clears the context. Manual journal lines may set `project_id` directly.
  `project_job_cost()`: revenue = Revenue accounts, material 5010/5020, labour 5200/5310, subcontract 5300, other Expense.
- Billing (all Finance only, all through `_insert_billing_invoice`, all go through the normal ZATCA chain / submission):
  * `post_advance_invoice` — ZATCA type 386 (`invoice_kind = 'advance'`): Dr 1100 / Cr 2060 / Cr 2100.
  * `post_progress_invoice` — cumulative % or cumulative BOQ quantities. Lines are priced net of retention; retention goes
    to 1110 as revenue already earned; the advance is deducted pro rata (all of it on the final claim) as ZATCA prepayment
    adjustment lines (`invoices.prepayments`, `prepaid_sar`, PrepaidAmount in the XML). `grand_total_sar` is the PAYABLE
    amount (lines + VAT - advance deducted incl. VAT); `vat_sar` is the full VAT of the lines (as in the XML);
    `vat_breakdown` has a negative prepayment row so the VAT return nets the advance VAT already declared.
    Dr 1100 payable, Dr 2060, Dr 1110 / Cr 4010|4020 work done, Cr 2100 VAT less advance VAT.
  * `post_retention_release` — VAT charged when retention is invoiced: Dr 1100 / Cr 1110 / Cr 2100.
  * `post_invoice` refuses delivery notes of a project billed by claims. Credit notes: refused on progress claims
    (correct in the next cumulative claim); on an advance only up to the part not yet deducted (Dr 2060); on retention Dr 1110.
  * Credit control: a project's SOs count as open for what the project has not invoiced yet; overrides for project /
    contract invoices use `grant_credit_override('INVOICE', <project id | contract id>, reason)`.
- Service contracts: lines priced per unit per MONTH; `generate_contract_drafts()` makes `contract_billing_periods`
  drafts (advance: on the period start, arrears: on the end; a short last period is pro-rated); Finance edits / skips /
  posts them (`post_contract_invoice`). `deferred_revenue` contracts credit 2400 and spread the net by days over the
  calendar months (`deferred_revenue_schedule`); `recognize_deferred_revenue(through)` posts Dr 2400 / Cr revenue.
  `contract_renewals_due()`, `renew_contract(id, {upliftPct})` (new draft for the next term). Running contracts can only
  change the service side (SLA, covered serials, notice days, notes). Optional cron: `supabase/snippets/contract_billing_schedule.sql`.
- Service tickets: `serial_coverage(serial)` -> warranty (item_serials.warranty_end) | amc (active contract covering the
  serial or all the customer's assets) | chargeable. SLA from the contract, else priority (4 / 8 / 24 / 72 h).
- Completed by 0016: commission on progress claims (main SO's commission % x work done x the project's expected margin,
  `_project_margin`: budget, else the main SO) and on contract invoices (`service_contracts.commission_pct`, set with
  `set_contract_commission` by manager / finance; % of the invoice net); none on advances or retention releases.
  `invoice_service_ticket` invoices a resolved chargeable ticket (kind 'service'). Retention VAT stays on release.
  Tests: `supabase/tests/billing_check.sql`.
- Tests: `supabase/tests/projects_check.sql` (after 0014). ZATCA prepayment XML: zatca.test.ts + crosscheck.py "claim".

## Notifications (migration 0015 + Edge Function `notify`)
- `app_settings.notification_settings` (Settings -> Notifications): enabled, email / whatsapp, overdueDays [1,7,14,30],
  repeatEveryDays, copySalesman, approvalDigest. Off by default.
- `notification_queue()` (service role only) = what goes out today: overdue-invoice reminders to the customer
  (customers.email / whatsapp or phone, E.164 via `_e164`) and one digest per approver (quote / PO approvals,
  contract drafts, renewals). Nothing repeats on the same day unless it failed. `record_notification()` logs to `notification_log`.
- The function sends through `NOTIFY_EMAIL_PROVIDER` (resend | sendgrid) and `NOTIFY_WHATSAPP_PROVIDER` (meta | twilio);
  with neither set every run is a dry run. Schedule: `supabase/snippets/notify_schedule.sql`.
- Tests: `supabase/tests/notifications_check.sql`, `supabase/tests/notify/notify.test.ts`.

## Testing (Prompt 15)
- `npm test`: unit tests (quote maths, aging, permissions, ZATCA XML/signing, reminder senders), a check that every
  posting function has a SQL test, and a check that every finance text passed to `tr()` has Arabic.
- `npm run test:sql`: every SQL suite in the order they need (some test data conversions, so they run in their slot).
- `npm run test:e2e`: quote -> SO -> DN -> invoice -> receipt and PO -> GRN -> bill -> payment through the real UI.

## Known gaps
See the "KSA-APP (Horizon ERP) — Gap Analysis" doc (IDs S1–S9, A1–A12, Z1–Z12, F1–F18, T1–T13) and its
"Claude Code prompts" tab for the planned fix order.

## Migration rule: views over row types
The role-redacted `*_v` views use `jsonb_populate_record(null::public.<table>, ...)`, so they hold the table's row type.
PostgreSQL 16.16 / 17.x and later refuse `ALTER TABLE ... ADD/ALTER/DROP COLUMN` on such a table while the view exists.
In any migration that alters one of these tables: `drop view if exists public.<table>_v;` before the first ALTER,
re-create the view after, then re-grant (`revoke all ... from anon, public; grant select ... to authenticated`).
`supabase/tests/migration_rules.test.ts` enforces this. Edit the .sql files directly.
