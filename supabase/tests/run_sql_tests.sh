#!/usr/bin/env bash
# Runs every SQL test suite against a throw-away Postgres database (never a Supabase project).
# Uses the standard PG* environment variables (PGHOST, PGPORT, PGUSER, PGPASSWORD). Needs Postgres 15+.
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres bash supabase/tests/run_sql_tests.sh
# Some suites must run at a particular point of the migration chain (they test data conversions); this mirrors that.
set -uo pipefail
cd "$(dirname "$0")/../.."
DB=${TEST_DB:-ksa_test}
export PGOPTIONS='-c client_min_messages=warning'
P="psql -v ON_ERROR_STOP=1 -q -X -d $DB"
FAIL=0
fresh() {
  psql -q -X -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
  $P -f supabase/tests/supabase_stub.sql >/dev/null 2>&1
  $P -f supabase/migrations/0001_baseline.sql >/dev/null
  $P -v part=seed -f supabase/tests/rls_check.sql >/dev/null
}
mig() { for m in "$@"; do $P -f "supabase/migrations/$m.sql" >/dev/null || { echo "MIGRATION FAILED: $m"; FAIL=1; }; done; }
check() { # check <label> <psql args...>
  local label=$1; shift
  local out; out=$($P "$@" 2>&1)
  if echo "$out" | grep -q ' OK'; then echo "  ok   $label"; else echo "  FAIL $label"; echo "$out" | grep -E 'ERROR|CHECK' | head -3; FAIL=1; fi
}
ALL="0002_roles_rls 0003_audit_lock 0004_posting 0006_credit_receipts 0007_commissions 0008_reporting 0009_vat 0010_zatca_phase2 0011_inventory 0012_procurement 0013_sales_controls 0014_projects_contracts 0015_notifications 0016_billing_completion 0017_vat_view_invoker 0018_customer_import 0019_vendor_item_import 0020_personal_data 0021_rate_limits 0022_authz_hardening 0023_line_validation"

echo "Suites on the full chain:"
for t in rls_check audit_lock_check posting_check reporting_check; do
  fresh; mig $ALL
  if [ $t = rls_check ]; then check $t -v part=check -f supabase/tests/$t.sql; else check $t -f supabase/tests/$t.sql; fi
done

echo "Commission suite (data before 0007):"
fresh; mig 0002_roles_rls 0003_audit_lock 0004_posting 0006_credit_receipts
$P -v part=pre -f supabase/tests/commission_check.sql >/dev/null 2>&1
mig 0007_commissions 0008_reporting 0009_vat 0010_zatca_phase2 0011_inventory 0012_procurement 0013_sales_controls 0014_projects_contracts 0015_notifications 0016_billing_completion 0017_vat_view_invoker 0018_customer_import 0019_vendor_item_import 0020_personal_data 0021_rate_limits 0022_authz_hardening 0023_line_validation
check commission_check -v part=check -f supabase/tests/commission_check.sql

echo "Suites in their slot of the chain:"
fresh; mig 0002_roles_rls 0003_audit_lock 0004_posting
check posting_check -f supabase/tests/posting_check.sql
mig 0006_credit_receipts; check credit_check -f supabase/tests/credit_check.sql
mig 0007_commissions 0008_reporting 0009_vat 0010_zatca_phase2 0011_inventory; check inventory_check -f supabase/tests/inventory_check.sql
mig 0012_procurement; check procurement_check -f supabase/tests/procurement_check.sql
mig 0013_sales_controls; check sales_check -f supabase/tests/sales_check.sql
mig 0014_projects_contracts; check projects_check -f supabase/tests/projects_check.sql
mig 0015_notifications; check notifications_check -f supabase/tests/notifications_check.sql
mig 0016_billing_completion; check billing_check -f supabase/tests/billing_check.sql
mig 0017_vat_view_invoker
mig 0018_customer_import; check customer_import_check -f supabase/tests/customer_import_check.sql
mig 0019_vendor_item_import; check vendor_item_import_check -f supabase/tests/vendor_item_import_check.sql
mig 0020_personal_data; check personal_data_check -f supabase/tests/personal_data_check.sql
mig 0021_rate_limits; check rate_limit_check -f supabase/tests/rate_limit_check.sql
mig 0022_authz_hardening; check authz_check -f supabase/tests/authz_check.sql
mig 0023_line_validation; check line_validation_check -f supabase/tests/line_validation_check.sql
mig 0014_projects_contracts 0015_notifications 0016_billing_completion; echo "  ok   0014-0016 re-run"

echo "VAT / ZATCA suites (posting + credit data only):"
fresh; mig 0002_roles_rls 0003_audit_lock 0004_posting
$P -f supabase/tests/posting_check.sql >/dev/null 2>&1; mig 0006_credit_receipts; $P -f supabase/tests/credit_check.sql >/dev/null 2>&1
mig 0007_commissions 0008_reporting 0009_vat 0010_zatca_phase2 0011_inventory 0012_procurement 0013_sales_controls 0014_projects_contracts 0015_notifications 0016_billing_completion
check vat_check -f supabase/tests/vat_check.sql
check zatca_check -f supabase/tests/zatca_check.sql
check "projects_check after vat / zatca" -f supabase/tests/projects_check.sql
mig 0005_lock_writes; echo "  ok   0005_lock_writes applies last"

psql -q -X -d postgres -c "drop database if exists $DB" >/dev/null
[ $FAIL = 0 ] && echo "ALL SQL SUITES OK" || { echo "SQL TESTS FAILED"; exit 1; }
