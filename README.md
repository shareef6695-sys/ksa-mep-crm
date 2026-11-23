# Horizon ERP

ERP for a Saudi MEP and IT & ELV trading and contracting company: quotes, sales orders, deliveries, ZATCA e-invoicing
(Phase 2), receipts, procurement (PO → GRN → bill → payment), inventory, projects with progress billing, service
contracts, service tickets, general ledger, VAT return and financial statements, in English and Arabic.

React 19 + Vite + Tailwind 4 in the browser; Supabase (Postgres, Auth, Edge Functions) behind it. All money logic,
permissions and posting rules live in the database (`supabase/migrations`); the browser never posts journals itself.

- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Database migrations](#database-migrations)
- [Edge Functions and secrets](#edge-functions-and-secrets)
- [Scheduled jobs](#scheduled-jobs)
- [Notifications (email / WhatsApp)](#notifications-email--whatsapp)
- [Hosting](#hosting)
- [Tests](#tests)
- [Backups and restore](#backups-and-restore)
- [Project layout](#project-layout)

## Setup

Needs Node 22+ and a Supabase project (or a local Supabase stack, see [End-to-end tests](#end-to-end-tests)).

```bash
npm ci
cp .env.example .env        # fill in the two values below
npm run dev                 # http://localhost:5173
```

First sign-in: create the first admin user in the Supabase dashboard (Authentication → Users → Add user), then in the
SQL editor give them a role:

```sql
insert into public.team_profiles (id, email, full_name, role_key, active)
select id, email, 'Admin', 'admin', true from auth.users where email = 'you@company.sa';
insert into public.user_roles (user_id, role, active)
select id, 'admin', true from auth.users where email = 'you@company.sa';
```

After that, create everyone else from **Administration → Team & Salesmen** (needs the `admin-users` function), and turn
**off** "Allow new users to sign up" in Supabase → Authentication → Providers → Email.

Roles: `admin`, `ceo`, `finance`, `manager`, `sales_mep`, `sales_it`, `procurement`. What each can open and do is in
`src/lib/permissions.js` (the screens) and enforced by the database (RLS policies and the posting functions).

## Environment variables

Browser (`.env`, and the same two in your hosting provider):

| Variable | Where to find it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` public key |

Never put the `service_role` key, ZATCA keys or provider API keys in `.env` or anywhere in the browser build. They are
Edge Function secrets (below). `.env` is git-ignored.

## Database migrations

`supabase/migrations/` is the source of truth. Each file is idempotent (safe to re-run) and is never edited after it has
been applied. **Run them on a Supabase branch or a copy of the project first, then on production.**

Order:

```
0001_baseline  0002_roles_rls  0003_audit_lock  0004_posting
0006_credit_receipts  0007_commissions  0008_reporting  0009_vat  0010_zatca_phase2  0011_inventory
0012_procurement  0013_sales_controls  0014_projects_contracts  0015_notifications  0016_billing_completion
0017_vat_view_invoker  0018_customer_import
0005_lock_writes      ← always last: it removes direct table writes once every posting function exists
```

Apply each with the SQL editor (paste and run) or with psql:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0015_notifications.sql
```

(`DATABASE_URL`: Supabase → Project Settings → Database → Connection string, session pooler, with your DB password.)
A new migration that adds a posting function: apply it, then re-run `0005_lock_writes.sql`.

The comments at the top of each migration explain what it changes and anything to check afterwards. `CLAUDE.md` has the
accounting rules (which accounts each document posts to).

## Edge Functions and secrets

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then from the repo root:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase functions deploy admin-users
supabase functions deploy zatca
supabase functions deploy notify
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically. Set the rest
with `supabase secrets set NAME=value` (or Dashboard → Edge Functions → Secrets):

| Function | Secret | Purpose |
|---|---|---|
| `admin-users` | — | creates / disables users, resets passwords (admins only) |
| `zatca` | `ZATCA_ENC_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`); encrypts the EGS private keys and CSIDs |
| `zatca` | `ZATCA_CRON_SECRET` | long random string; lets the schedule process the B2C reporting queue |
| `notify` | `NOTIFY_CRON_SECRET` | long random string; lets the schedule send reminders |
| `notify` | `NOTIFY_EMAIL_PROVIDER` … | see [Notifications](#notifications-email--whatsapp) |

ZATCA onboarding (CSR, OTP from the Fatoora portal, compliance checks, production CSID) is done from
**Administration → ZATCA Phase 2 (Fatoora)**. Start in the sandbox; `CLAUDE.md` → "ZATCA Phase 2" has the details.

## Scheduled jobs

Optional; each file in `supabase/snippets/` is run once in the SQL editor after enabling the `pg_cron` and `pg_net`
extensions (Database → Extensions). Replace the placeholders first.

| Snippet | What it does |
|---|---|
| `zatca_queue_schedule.sql` | reports B2C invoices to ZATCA (retries until reported, within 24 h) |
| `contract_billing_schedule.sql` | makes service-contract billing drafts every morning (Finance still posts them) |
| `notify_schedule.sql` | sends the daily reminders at 09:00 Riyadh |

List them with `select * from cron.job;`, stop one with `select cron.unschedule('<name>');`.

## Notifications (email / WhatsApp)

Payment reminders for overdue invoices go to the customer (email from the customer master, WhatsApp to the customer's
WhatsApp or phone number), optionally copied to the salesman. A daily digest goes to each approver listing what waits for
them (quote and PO approvals, contract invoices to post, contracts to renew).

1. Run migration `0015_notifications.sql` and deploy `notify`.
2. **Administration → Notifications**: choose the reminder days (default 1, 7, 14, 30 days past due, then every 14) and
   press **Preview today's messages**. Nothing is sent until a provider is configured; until then every run is a dry run.
3. Configure the providers you want as `notify` secrets:

   | Channel | `NOTIFY_*_PROVIDER` | Other secrets |
   |---|---|---|
   | Email | `NOTIFY_EMAIL_PROVIDER=resend` | `RESEND_API_KEY`, `NOTIFY_EMAIL_FROM` (a verified sender), optional `NOTIFY_REPLY_TO` |
   | Email | `NOTIFY_EMAIL_PROVIDER=sendgrid` | `SENDGRID_API_KEY`, `NOTIFY_EMAIL_FROM`, optional `NOTIFY_REPLY_TO` |
   | WhatsApp | `NOTIFY_WHATSAPP_PROVIDER=meta` | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_OVERDUE`, `WHATSAPP_TEMPLATE_DIGEST`, `WHATSAPP_TEMPLATE_LANG` (`en` / `ar`) |
   | WhatsApp | `NOTIFY_WHATSAPP_PROVIDER=twilio` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, and (recommended) `TWILIO_CONTENT_SID_OVERDUE` / `TWILIO_CONTENT_SID_DIGEST` |

   WhatsApp messages that the business starts must use an approved template. The function fills the template's body
   variables in this order: overdue reminder `{{1}}` customer, `{{2}}` invoice number, `{{3}}` amount due (SAR),
   `{{4}}` days overdue, `{{5}}` company name; digest `{{1}}` approver name, `{{2}}` number of items, `{{3}}` summary.
4. Turn **Reminders on**, try **Send now** once, check the log on the same screen, then add `notify_schedule.sql`.

## Hosting

`npm run build` writes a static site to `dist/`. Any static host works (Vercel, Netlify, Cloudflare Pages, S3 + CDN, nginx).
Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host's build settings.

Every screen has its own URL (`/fin_gl`, `/sales_quotes`, `/object/invoice/<id>`), so the host must answer every path
with `index.html` (SPA fallback):

- Vercel: `vercel.json` → `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`
- Netlify / Cloudflare Pages: `public/_redirects` → `/*  /index.html  200`
- nginx: `location / { try_files $uri /index.html; }`

## Tests

```bash
npm run lint
npm test            # unit tests (Vitest)
npm run test:sql    # every SQL suite, on a throw-away local Postgres
npm run test:e2e    # Playwright, against a seeded local Supabase stack
```

GitHub Actions (`.github/workflows/ci.yml`) runs all four on every push and pull request. It never touches your Supabase
project: the SQL suites run on a Postgres service container and the end-to-end tests on a Supabase stack started inside
the runner.

### Unit tests

Quote pricing, aging buckets, permissions, ZATCA XML / hashing / signing (with an independent Python cross-check in
`supabase/tests/zatca/crosscheck.py`), the reminder texts and senders, a check that every posting function has a SQL test,
and a check that every Arabic finance label exists.

### SQL suites

`supabase/tests/*_check.sql`, one per migration area. `run_sql_tests.sh` creates a database `ksa_test`, adds stand-ins for
Supabase's `auth` schema (`supabase_stub.sql`), applies the migrations and runs every suite at the point of the chain it
needs. Point it at a local Postgres 15+ with the usual variables — **never at a Supabase project**:

```bash
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres npm run test:sql
```

### End-to-end tests

`e2e/quote-to-cash.spec.js` (inquiry → sales order → delivery → ZATCA invoice → receipt) and
`e2e/procure-to-pay.spec.js` (PO → goods receipt → supplier bill → payment) drive the real app as the admin test user.
Locally, with Docker and the Supabase CLI:

```bash
mv supabase/migrations /tmp/migrations && supabase start && mv /tmp/migrations supabase/migrations   # empty stack
supabase status -o env > /tmp/sb.env && source /tmp/sb.env
for m in 0001_baseline 0002_roles_rls 0003_audit_lock 0004_posting 0006_credit_receipts 0007_commissions 0008_reporting \
         0009_vat 0010_zatca_phase2 0011_inventory 0012_procurement 0013_sales_controls 0014_projects_contracts \
         0015_notifications 0016_billing_completion 0005_lock_writes; do psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/migrations/$m.sql; done
SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY node e2e/seed.mjs   # test users, password Test-1234
npx playwright install chromium
VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY npm run test:e2e
```

(Migrations are moved aside during `supabase start` because 0005 must run last, not in file-name order.)
`e2e/seed.mjs` refuses to run against anything but localhost.

## Backups and restore

**What Supabase keeps.** Pro, Team and Enterprise projects get daily backups (the last 7, 14 and up to 30 days
respectively); the Point-in-Time Recovery add-on restores to the second. Dashboard → Database → Backups. Do not rely on
the Free plan for backups, and remember files in Storage are not in the database backups — keep your own copy (below).

**Your own copy (recommended weekly, and before every migration on production):**

```bash
# schema + data of the app (public), and the users (auth)
pg_dump "$DATABASE_URL" --no-owner --no-privileges --schema=public --schema=auth -Fc -f horizon-$(date +%F).dump
```

Store the file encrypted and off the machine (it contains customers, invoices and password hashes). Keep at least 4
weekly and 12 monthly copies. Also keep, separately: the Edge Function secrets (in a password manager — they are **not**
in the database dump; without `ZATCA_ENC_KEY` the stored ZATCA keys cannot be decrypted and you must re-onboard), and the
company logo bucket in Storage if you use one.

**Restore** (into a new, empty project or a branch — never over a running production database):

1. Create the project; in its SQL editor run nothing yet.
2. `pg_restore --no-owner --no-privileges --clean --if-exists -d "$NEW_DATABASE_URL" horizon-YYYY-MM-DD.dump`
   (if `auth` conflicts with the new project's own schema, restore `--schema=public` first and recreate users from
   `auth.users` with the Admin API, or contact Supabase support for a full restore).
3. Re-run `supabase/migrations/0015_notifications.sql` … `0005_lock_writes.sql` (they are idempotent) so grants and
   policies are in place, then deploy the Edge Functions and set the same secrets.
4. Point the app's `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` at the new project and check: sign-in, trial balance
   (General Ledger → Trial Balance is in balance), AR aging totals, the last invoice numbers.

**Test the restore** every quarter on a branch: a backup you have never restored is not a backup.

## Project layout

```
src/
  main.jsx              router
  App.jsx               shell: sign-in gate, navigation, lazy-loaded feature bundles
  app/                  store (state, data loading, navigation), context, constants, login page
  features/             sales | purchase | finance (+ suite/) | inventory | projects | admin | objects
                        each: <X>Screens.jsx, <X>Modals.jsx, use<X>Actions.js
  erp/                  larger shared views (GL, statements, aging, VAT, ZATCA, inventory, procurement, projects …)
  lib/                  supabase client, permissions, pure maths (quoteMath, aging), ZATCA helpers
  ui/                   shell components, i18n (navigation) and financeI18n / financeAr (Arabic finance screens)
supabase/
  migrations/           database, in order (see above)
  functions/            admin-users, zatca, notify (+ _shared)
  snippets/             optional cron jobs
  tests/                SQL suites, run_sql_tests.sh, ZATCA and notify unit tests
e2e/                    Playwright tests and the local seed
CLAUDE.md               working rules, accounting rules and module notes for developers (and Claude Code)
```
