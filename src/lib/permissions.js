// Mirrors supabase/migrations/0002_roles_rls.sql. The database is the real gate;
// these helpers only decide what the UI shows. Keep both in step.
export const ROLES = ['admin', 'ceo', 'finance', 'manager', 'sales_mep', 'sales_it', 'procurement'];

const ALL = ROLES;
const SALES = ['sales_mep', 'sales_it'];
const FIN = ['admin', 'ceo', 'finance'];

// Sub-module ids (navTree in App.jsx) -> roles that may open them
export const MODULE_ACCESS = {
  // 1. Sales & Fulfillment
  sales_customers: ALL,
  sales_quotes: ['admin', 'ceo', 'manager', 'finance', 'procurement', ...SALES],
  sales_pipeline: ['admin', 'ceo', 'manager', 'finance', ...SALES],
  sales_orders: ALL,
  sales_deliveries: ALL,
  sales_invoices: ['admin', 'ceo', 'finance', 'manager', ...SALES],
  sales_credit_notes: ['admin', 'ceo', 'finance', 'manager', ...SALES],
  // 1b. Projects, contracts & service (0014). Projects carry budgets and costs: no sales roles.
  proj_projects: ['admin', 'ceo', 'finance', 'manager', 'procurement'],
  proj_job_cost: ['admin', 'ceo', 'finance', 'manager', 'procurement'],
  proj_contracts: ['admin', 'ceo', 'finance', 'manager', ...SALES],
  proj_tickets: ALL,
  // 2. Finance & Collections
  fin_dashboard: ['admin', 'ceo', 'finance'],
  fin_collections: ['admin', 'ceo', 'finance', 'manager', ...SALES],
  fin_supplier_payments: ['admin', 'ceo', 'finance', 'procurement'],
  fin_aging: FIN,
  fin_statements_of_account: FIN,
  fin_bank_cash: FIN,
  fin_expenses: FIN,
  fin_fixed_assets: FIN,
  fin_gl: FIN,
  fin_statements: FIN,
  fin_cash_flow: FIN,
  fin_budget: FIN,
  fin_vat_return: FIN,
  fin_profitability: ['admin', 'ceo', 'finance', 'manager'],
  fin_period_close: FIN,
  fin_zatca_advisor: FIN,
  // 3. Purchase
  pur_vendors: ['admin', 'ceo', 'finance', 'manager', 'procurement'],
  pur_requisitions: ['admin', 'ceo', 'finance', 'manager', 'procurement'],
  pur_orders: ['admin', 'ceo', 'finance', 'manager', 'procurement'],
  pur_grn: ['admin', 'ceo', 'finance', 'procurement'],
  pur_bills: ['admin', 'ceo', 'finance', 'procurement'],
  // 4. Catalogue
  cat_items: ALL,
  inv_stock: ALL, // quantities for everyone; cost and value only with cost.view (enforced in SQL)
  // 5. Profit share
  comm_ledger: ['admin', 'ceo', 'finance', 'manager', ...SALES],
  // 6. Administration
  set_salesmen: ['admin', 'ceo'],
  set_company: FIN,
  set_zatca_phase2: FIN,
  set_num_ranges: FIN,
  set_audit_log: FIN,
  set_notifications: FIN,
};

// Actions -> roles allowed to perform them (buttons are hidden for everyone else)
export const ACTION_ACCESS = {
  'cost.view': ['admin', 'ceo', 'finance', 'manager', 'procurement'],
  'customer.create': ['admin', 'ceo', 'manager', 'finance', ...SALES],
  'customer.import': ['admin', 'ceo', 'manager', 'finance'], // bulk CSV import (import_customers, 0018)
  'master.import': ['admin', 'ceo', 'manager', 'finance', 'procurement'], // vendor / item CSV import (0019)
  'privacy.erase': ['admin'], // erase a customer's / vendor's / team member's personal data (0020)
  'quote.create': ['admin', 'ceo', 'manager', ...SALES],
  'quote.price': ['admin', 'ceo', 'manager'], // set cost / margin, approve, convert to SO
  'quote.approve': ['admin', 'ceo', 'manager'], // margin floor / value threshold (0013); not your own quote
  'so.amend': ['admin', 'ceo', 'manager'],
  'credit.view': ['admin', 'ceo', 'finance', 'manager'],
  'credit.override': FIN,
  'delivery.create': ['admin', 'ceo', 'procurement'],
  'delivery.reverse': ['admin', 'ceo', 'manager'], // undo a delivery note before it is invoiced (0024)
  'invoice.create': FIN,
  'receipt.create': FIN,
  'credit_note.create': FIN,
  'debit_note.create': FIN,
  'zatca.submit': FIN, // sign and send a document to ZATCA (the Edge Function checks the same roles)
  'zatca.onboard': ['admin'],
  'vendor.manage': ['admin', 'ceo', 'finance', 'procurement'],
  'item.manage': ['admin', 'ceo', 'finance', 'manager', 'procurement'],
  'po.create': ['admin', 'ceo', 'procurement'],
  'po.approve': ['admin', 'ceo', 'manager'], // CEO-level POs: admin / ceo only (checked in SQL and in App)
  'po.close': ['admin', 'ceo', 'procurement'],
  'pr.create': ['admin', 'ceo', 'manager', 'procurement'],
  'po.grn': ['admin', 'ceo', 'procurement'],
  'project.view': ['admin', 'ceo', 'finance', 'manager', 'procurement'],
  'project.manage': ['admin', 'ceo', 'manager', 'finance'],
  'project.bill': FIN, // advance / progress / retention invoices
  'contract.manage': ['admin', 'ceo', 'manager', 'finance', ...SALES], // sales: own drafts and renewals
  'contract.activate': ['admin', 'ceo', 'manager', 'finance'], // activate, cancel, generate / edit / skip billing drafts
  'contract.bill': FIN,
  'revenue.recognize': FIN,
  'ticket.manage': ALL,
  'ticket.bill': FIN, // invoice a chargeable ticket (0016)
  'notify.send': FIN, // reminders: preview / send now (the Edge Function checks the same roles)
  'po.bill': FIN,
  'stock.opening': FIN,
  'stock.adjust': FIN,
  'stock.count': [...FIN, 'procurement'],
  'stock.transfer': [...FIN, 'procurement'],
  'warehouse.manage': [...FIN, 'procurement'],
  'supplier_payment.create': FIN,
  'commission.pay': FIN,
  'finance.post': FIN, // GL, bank, expenses, assets, budgets, period lock
  'settings.edit': FIN,
  'number_ranges.edit': FIN,
  'user.manage': ['admin'],
  'user.create_salesman': ['admin'],
};

const roleOf = (profile) => String(profile?.role_key || '').toLowerCase();

/** May this user open the given sub-module? 'home' is always allowed for a user with a role. */
export const canOpen = (profile, moduleId) => {
  const role = roleOf(profile);
  if (!ROLES.includes(role)) return false;
  if (moduleId === 'home') return true;
  return (MODULE_ACCESS[moduleId] || []).includes(role);
};

/** May this user perform the given action? Unknown actions are denied. */
export const can = (profile, action) => (ACTION_ACCESS[action] || []).includes(roleOf(profile));

/** navTree filtered to what this user may open; empty groups are removed. */
export const filterNavTree = (profile, navTree) =>
  navTree
    .map((mod) => ({ ...mod, subModules: mod.subModules.filter((s) => canOpen(profile, s.id)) }))
    .filter((mod) => mod.subModules.length > 0);

export const isSalesRole = (profile) => SALES.includes(roleOf(profile));
export const canViewCost = (profile) => can(profile, 'cost.view');
export const canEditQuotes = (profile) => can(profile, 'quote.create');
/** Set costs, margin, approve and convert a quote to a Sales Order */
export const canPriceQuotes = (profile) => can(profile, 'quote.price');
export const canManageNumberRanges = (profile) => can(profile, 'number_ranges.edit');
