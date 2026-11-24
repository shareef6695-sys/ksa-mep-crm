#!/usr/bin/env node
// Apply supabase/migrations to a Postgres database in the documented order (README, "Database migrations").
// Each file runs in its own transaction (the files have their own begin/commit). Stops at the first error;
// a failed file is rolled back, files before it stay applied. Every file is idempotent, so re-running is safe.
//
// Usage (PowerShell):
//   $env:DATABASE_URL = "<Supabase -> Connect -> Session pooler connection string, with your DB password>"
//   node scripts/apply-migrations.mjs --project <project-ref>
//   Remove-Item Env:DATABASE_URL
//
// TLS: remote connections always use TLS. To also verify the server certificate (protects against an impostor
// server), download it from Supabase -> Database -> Settings -> SSL Configuration -> Download certificate and set
//   $env:DATABASE_CA_CERT = "C:\\path\\to\\prod-ca-2021.crt"
// Without it the connection is still encrypted, and the script says the certificate was not checked.
//
// --project <ref> is required and must appear in DATABASE_URL, so the script can't run against the wrong project.
// --only 0015,0016,0005 applies just those (still in documented order).
// --from 0009 resumes at that file after a failed run (re-running earlier files after later ones is not supported:
//   e.g. 0008 cannot re-create a function whose return type a later migration changed).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ORDER = [
  '0001_baseline', '0002_roles_rls', '0003_audit_lock', '0004_posting',
  '0006_credit_receipts', '0007_commissions', '0008_reporting', '0009_vat', '0010_zatca_phase2', '0011_inventory',
  '0012_procurement', '0013_sales_controls', '0014_projects_contracts', '0015_notifications', '0016_billing_completion', '0017_vat_view_invoker', '0018_customer_import', '0019_vendor_item_import', '0020_personal_data', '0021_rate_limits',
  '0005_lock_writes', // always last
];

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const url = process.env.DATABASE_URL;
const project = arg('--project');
const only = arg('--only')?.split(',').map((s) => s.trim());
const from = arg('--from');

if (!url) { console.error('Set DATABASE_URL first (see the comment at the top of this file).'); process.exit(2); }
if (!project) { console.error('Pass --project <project ref>, e.g. --project <project-ref>'); process.exit(2); }
const isLocal = /@(localhost|127\.0\.0\.1)|host=\/|^postgres(ql)?:\/\/[^@]*$/.test(url);
if (!isLocal && !url.includes(project)) { console.error(`DATABASE_URL is not for project ${project}. Stopping.`); process.exit(2); }

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
let files = ORDER.filter((m) => !only || only.some((o) => m.startsWith(o)));
if (from) {
  const i = files.findIndex((m) => m.startsWith(from));
  if (i < 0) { console.error(`--from ${from}: no such migration`); process.exit(2); }
  files = files.slice(i);
}

if (!isLocal && /sslmode=disable/i.test(url)) { console.error('DATABASE_URL has sslmode=disable: remote connections must use TLS. Stopping.'); process.exit(2); }
const host = (url.match(/@([^:/?]+)/) || [])[1] || 'local socket';
console.log(`Connecting to ${host} ...`);
if (/^db\.[a-z0-9]+\.supabase\.co$/.test(host)) {
  console.log('  note: this is the Direct connection (IPv6 only). If it hangs, use Connect -> Session pooler instead.');
}
const caFile = process.env.DATABASE_CA_CERT;
const tls = caFile ? { ca: readFileSync(caFile, 'utf8'), rejectUnauthorized: true } : { rejectUnauthorized: false };
if (!isLocal) console.log(caFile ? '  TLS: on, server certificate verified.' : '  TLS: on (certificate not verified: set DATABASE_CA_CERT to verify it).');
const client = new pg.Client({
  connectionString: url, ssl: isLocal ? false : tls, connectionTimeoutMillis: 20000,
});
try {
  await client.connect();
} catch (e) {
  console.error(`Could not connect: ${e.message}`);
  if (/password/i.test(e.message)) console.error('  -> wrong database password (Project Settings -> Database -> Reset password).');
  else if (/timeout|ENOTFOUND|ENETUNREACH|EHOSTUNREACH/i.test(e.message)) console.error('  -> use the Session pooler string (host ends in pooler.supabase.com), not Direct connection.');
  process.exit(1);
}
const { rows: [info] } = await client.query('select current_database() db, version() v');
console.log(`Connected: ${info.db} — ${info.v.split(' on ')[0]}`);

for (const m of files) {
  const sql = readFileSync(join(dir, `${m}.sql`), 'utf8');
  process.stdout.write(`  ${m} ... `);
  try {
    await client.query(sql);
    console.log('ok');
  } catch (e) {
    try { await client.query('rollback'); } catch { /* not in a transaction */ }
    console.log('FAILED');
    console.error(`\n${m}: ${e.message}${e.where ? `\n  where: ${e.where}` : ''}${e.position ? `\n  at character ${e.position}` : ''}`);
    console.error(`\nStopped. ${m} was rolled back; earlier files stay applied. After the fix, resume with: --from ${m.slice(0, 4)}`);
    await client.end();
    process.exit(1);
  }
}

const { rows: [c] } = await client.query(`select
  (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') tables,
  (select count(*) from information_schema.views where table_schema='public') views,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') functions`);
console.log(`\nAll ${files.length} migrations applied. public: ${c.tables} tables, ${c.views} views, ${c.functions} functions.`);
await client.end();
