// Quote -> Sales Order -> Delivery Note -> ZATCA invoice -> customer receipt, as the admin user.
import { test, expect } from '@playwright/test';
import { login, open, stamp } from './helpers';

test('quote to cash', async ({ page }) => {
  const client = `E2E Client ${stamp()}`;
  await login(page, 'admin@test');

  // 1. inquiry with one costed line (SAR 800 cost, 20% margin -> SAR 1,000 + VAT)
  await open(page, 'sales_quotes');
  await page.getByRole('button', { name: 'New Inquiry' }).click();
  const form = page.locator('div.fixed.inset-0', { hasText: 'New Client Inquiry' });
  await page.getByPlaceholder('Client Company Name *').fill(client);
  await page.getByPlaceholder('Contact Person *').fill('Ali Test');
  await page.getByPlaceholder('Phone / WhatsApp *').fill('0500000000');
  await page.getByRole('button', { name: 'Search or create salesman...' }).click();
  await form.getByText('Sami Sales').first().click();
  await page.getByPlaceholder('Primary Item / Scope Description *').fill('Fire pump set');
  await page.getByRole('button', { name: 'Save Inquiry' }).click();

  const drawer = page.locator('div.fixed.inset-0', { hasText: 'BOQ MULTI-CURRENCY COSTING' });
  await expect(drawer).toBeVisible();
  await drawer.locator('select:has(option[value="AED"])').first().selectOption('SAR');
  await drawer.getByPlaceholder('Unit Cost').fill('800');
  await expect(drawer.getByText('SAR 1,150.00').first()).toBeVisible(); // total incl. VAT
  await page.waitForTimeout(1500); // the drawer saves edits after a short pause
  await drawer.getByRole('button', { name: /Convert Quote to Sales Order/ }).click();

  // 2. sales order -> delivery
  await expect(page).toHaveURL(/sales_orders/);
  const so = page.locator('div.rounded-2xl', { hasText: client }).filter({ has: page.getByRole('button', { name: /Record Delivery/ }) }).first();
  await expect(so).toBeVisible();
  await so.getByRole('button', { name: /Record Delivery/ }).click();
  await page.getByRole('button', { name: 'Confirm & Issue Delivery Note' }).click();

  // 3. delivery -> ZATCA invoice
  await expect(page).toHaveURL(/sales_deliveries/);
  const dn = page.locator('div.rounded-2xl', { hasText: client }).filter({ has: page.getByRole('button', { name: /Issue ZATCA Tax Invoice/ }) }).first();
  await dn.getByRole('button', { name: /Issue ZATCA Tax Invoice/ }).click();
  await expect(page).toHaveURL(/sales_invoices/);
  // the printable invoice opens (ZATCA Phase 1 here; with Phase 2 a B2B invoice opens only once cleared)
  const preview = page.locator('div.fixed.inset-0', { hasText: 'Print / PDF' });
  await expect(preview).toBeVisible();
  await expect(preview.getByText('SAR 1,150.00').first()).toBeVisible();
  await preview.locator('button:has(svg.lucide-x)').first().click();
  await expect(preview).toHaveCount(0);

  // 4. receipt for the full amount
  const inv = page.locator('div.rounded-2xl', { hasText: client }).filter({ has: page.getByRole('button', { name: /Receive Payment/ }) }).first();
  await expect(inv).toContainText('1,150.00');
  await inv.getByRole('button', { name: /Receive Payment/ }).click();
  await page.getByRole('button', { name: /Post Receipt/ }).click();
  await expect(page.locator('div.rounded-2xl', { hasText: client }).getByRole('button', { name: /Receive Payment/ })).toHaveCount(0);
});
