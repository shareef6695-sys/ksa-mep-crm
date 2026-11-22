# Horizon ERP (KSA) — notes for Claude Code

ERP for a Saudi MEP and IT/ELV trading company: sales, procurement, finance, ZATCA e-invoicing.
Bilingual EN/AR (RTL). Currency SAR.

## Stack
- React 19 + Vite 6 + Tailwind 4, plain JSX (no TypeScript), lucide-react icons.
- Supabase (Postgres, Auth, Realtime). Client in `src/lib/supabase.js`, configured from `.env`
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; see `.env.example`). Hosting must set the same two variables.
- Scripts: `npm run dev`, `npm run build`, `npm run lint`, `npm test`.

## Folder map
- `src/App.jsx` — shell, auth, data loading (`refreshAllErpData`), nav tree, most sales/purchase screens and handlers.
- `src/erp/` — feature views: master data, credit notes, GL, financial statements, payments & aging,
  VAT return & profitability, Finance Suite (bank, expenses, fixed assets, budget, cash flow, statements, period close),
  object pages, document previews, `erpEngine.js` (ZATCA QR, wave advice, SAR format), `glEngine.js` (`postAutoJournal`).
- `src/ui/` — Fiori-style shell, SmartFilterBar, i18n (`t()`), theme.
- `supabase/migrations/` — the source of truth for the database. `0001_baseline.sql` = schema as of 2026-11-22.
  `supabase/schema_existing.sql` and `schema_finance.sql` are the old hand-run scripts, kept for reference only.
- `supabase/tests/` — SQL test scripts. `supabase/tests/supabase_stub.sql` creates stand-ins for Supabase's
  `auth` schema and roles so migrations can be tested on plain Postgres.

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
5010 COGS · 5100–5290 Opex (5130 bank charges & FX, 5140 commission expense, 5270 depreciation; 5280 duplicates 5140).
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

## Known gaps
See the "KSA-APP (Horizon ERP) — Gap Analysis" doc (IDs S1–S9, A1–A12, Z1–Z12, F1–F18, T1–T13) and its
"Claude Code prompts" tab for the planned fix order.
