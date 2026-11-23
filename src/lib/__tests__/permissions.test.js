import { describe, it, expect } from 'vitest';
import {
  ROLES, MODULE_ACCESS, ACTION_ACCESS,
  can, canOpen, filterNavTree,
  canViewCost, canEditQuotes, canPriceQuotes, canManageNumberRanges, isSalesRole,
} from '../permissions';

const p = (role_key) => ({ role_key });
const opens = (role) => Object.keys(MODULE_ACCESS).filter((m) => canOpen(p(role), m)).sort();

describe('module access (must match 0002_roles_rls.sql)', () => {
  it('admin and ceo open everything', () => {
    for (const r of ['admin', 'ceo']) expect(opens(r)).toEqual(Object.keys(MODULE_ACCESS).sort());
  });

  it('sales open only sales-facing screens', () => {
    expect(opens('sales_mep')).toEqual(
      ['cat_items', 'comm_ledger', 'fin_collections', 'inv_stock', 'proj_contracts', 'proj_tickets', 'sales_credit_notes', 'sales_customers', 'sales_deliveries', 'sales_invoices', 'sales_orders', 'sales_pipeline', 'sales_quotes'].sort()
    );
    expect(opens('sales_it')).toEqual(opens('sales_mep'));
  });

  it('no finance books for sales, manager or procurement', () => {
    const books = ['fin_gl', 'fin_statements', 'fin_bank_cash', 'fin_expenses', 'fin_fixed_assets', 'fin_vat_return', 'fin_period_close', 'fin_dashboard', 'fin_budget', 'fin_cash_flow'];
    for (const r of ['sales_mep', 'sales_it', 'manager', 'procurement']) {
      for (const m of books) expect(canOpen(p(r), m), `${r} -> ${m}`).toBe(false);
    }
    for (const m of books) expect(canOpen(p('finance'), m)).toBe(true);
  });

  it('procurement sees purchasing but not invoices', () => {
    expect(canOpen(p('procurement'), 'pur_grn')).toBe(true);
    expect(canOpen(p('procurement'), 'fin_supplier_payments')).toBe(true);
    expect(canOpen(p('procurement'), 'sales_invoices')).toBe(false);
  });

  it('only admin/ceo see the team screen', () => {
    expect(ROLES.filter((r) => canOpen(p(r), 'set_salesmen'))).toEqual(['admin', 'ceo']);
  });

  it('no role = nothing, not even home', () => {
    expect(canOpen(null, 'home')).toBe(false);
    expect(canOpen(p('unknown'), 'sales_orders')).toBe(false);
    expect(canOpen(p('sales_mep'), 'home')).toBe(true);
  });

  it('every module id in the map is known to some role', () => {
    for (const [m, roles] of Object.entries(MODULE_ACCESS)) {
      expect(roles.length, m).toBeGreaterThan(0);
      for (const r of roles) expect(ROLES, `${m}: ${r}`).toContain(r);
    }
  });
});

describe('actions', () => {
  it('matches who may write each table', () => {
    expect(ROLES.filter((r) => can(p(r), 'delivery.create'))).toEqual(['admin', 'ceo', 'procurement']);
    expect(ROLES.filter((r) => can(p(r), 'invoice.create'))).toEqual(['admin', 'ceo', 'finance']);
    expect(ROLES.filter((r) => can(p(r), 'po.bill'))).toEqual(['admin', 'ceo', 'finance']);
    expect(ROLES.filter((r) => can(p(r), 'po.create'))).toEqual(['admin', 'ceo', 'procurement']);
    expect(ROLES.filter((r) => can(p(r), 'user.manage'))).toEqual(['admin']);
  });
  it('denies unknown actions', () => {
    expect(can(p('admin'), 'nuke.everything')).toBe(false);
  });
  it('action map uses only known roles', () => {
    for (const [a, roles] of Object.entries(ACTION_ACCESS)) for (const r of roles) expect(ROLES, `${a}: ${r}`).toContain(r);
  });
  it('helpers', () => {
    expect(canViewCost(p('sales_mep'))).toBe(false);
    expect(canViewCost(p('procurement'))).toBe(true);
    expect(canEditQuotes(p('sales_it'))).toBe(true);
    expect(canPriceQuotes(p('sales_it'))).toBe(false);
    expect(canPriceQuotes(p('manager'))).toBe(true);
    expect(canManageNumberRanges(p('manager'))).toBe(false);
    expect(isSalesRole(p('sales_it'))).toBe(true);
  });
});

describe('filterNavTree', () => {
  const tree = [
    { id: 'sales', subModules: [{ id: 'sales_orders' }, { id: 'sales_invoices' }] },
    { id: 'finance', subModules: [{ id: 'fin_gl' }] },
  ];
  it('drops screens and empty groups', () => {
    expect(filterNavTree(p('procurement'), tree)).toEqual([{ id: 'sales', subModules: [{ id: 'sales_orders' }] }]);
    expect(filterNavTree(p('finance'), tree)).toEqual(tree);
    expect(filterNavTree(null, tree)).toEqual([]);
  });
});

describe('inventory actions (0011)', () => {
  const p = (role) => ({ role_key: role });
  it('only finance can write stock off or post opening stock; the warehouse can count and transfer', () => {
    expect(can(p('procurement'), 'stock.count')).toBe(true);
    expect(can(p('procurement'), 'stock.transfer')).toBe(true);
    expect(can(p('procurement'), 'stock.adjust')).toBe(false);
    expect(can(p('procurement'), 'stock.opening')).toBe(false);
    expect(can(p('finance'), 'stock.adjust')).toBe(true);
    expect(can(p('sales_mep'), 'stock.count')).toBe(false);
  });
});

describe('procurement actions (0012)', () => {
  const p = (role) => ({ role_key: role });
  it('procurement raises and closes POs, managers approve, finance bills', () => {
    expect(can(p('procurement'), 'po.create')).toBe(true);
    expect(can(p('procurement'), 'po.approve')).toBe(false);
    expect(can(p('manager'), 'po.approve')).toBe(true);
    expect(can(p('procurement'), 'po.close')).toBe(true);
    expect(can(p('finance'), 'po.bill')).toBe(true);
    expect(can(p('procurement'), 'po.bill')).toBe(false);
    expect(can(p('sales_it'), 'pr.create')).toBe(false);
    expect(canOpen(p('sales_mep'), 'pur_requisitions')).toBe(false);
  });
});

describe('sales controls (0013)', () => {
  const p = (role) => ({ role_key: role });
  it('managers approve pricing and amend orders, finance grants credit overrides', () => {
    expect(can(p('manager'), 'quote.approve')).toBe(true);
    expect(can(p('sales_mep'), 'quote.approve')).toBe(false);
    expect(can(p('manager'), 'so.amend')).toBe(true);
    expect(can(p('procurement'), 'so.amend')).toBe(false);
    expect(can(p('finance'), 'credit.override')).toBe(true);
    expect(can(p('manager'), 'credit.override')).toBe(false);
    expect(canOpen(p('sales_it'), 'sales_pipeline')).toBe(true);
  });
});

describe('projects and contracts (0014)', () => {
  it('projects and job cost: no sales roles (budgets, costs)', () => {
    for (const r of ['sales_mep', 'sales_it']) {
      expect(canOpen(p(r), 'proj_projects')).toBe(false);
      expect(canOpen(p(r), 'proj_job_cost')).toBe(false);
      expect(can(p(r), 'project.view')).toBe(false);
    }
    expect(canOpen(p('procurement'), 'proj_projects')).toBe(true);
  });
  it('only finance roles bill projects and contracts, or recognise revenue', () => {
    for (const a of ['project.bill', 'contract.bill', 'revenue.recognize']) {
      expect(ROLES.filter((r) => can(p(r), a))).toEqual(['admin', 'ceo', 'finance']);
    }
  });
  it('sales draft contracts but cannot activate them', () => {
    expect(can(p('sales_it'), 'contract.manage')).toBe(true);
    expect(can(p('sales_it'), 'contract.activate')).toBe(false);
    expect(can(p('manager'), 'contract.activate')).toBe(true);
  });
  it('everyone can raise service tickets', () => {
    expect(ROLES.every((r) => canOpen(p(r), 'proj_tickets'))).toBe(true);
  });
});
