// Purchase order -> goods receipt (GRN) -> supplier bill (3-way match) -> supplier payment, as the admin user.
import { test, expect } from '@playwright/test';
import { login, open, stamp } from './helpers';

test('procure to pay', async ({ page }) => {
  const supplier = `E2E Supplier ${stamp()}`;
  await login(page, 'admin@test');

  // 1. PO: 10 x SAR 100 + 15% VAT (below the approval threshold)
  await open(page, 'pur_orders');
  await page.getByRole('button', { name: 'New Purchase Order' }).click();
  const poForm = page.locator('div.fixed.inset-0', { hasText: 'Create Purchase Order (PO)' });
  await poForm.getByPlaceholder('Supplier Name *').fill(supplier);
  await poForm.getByPlaceholder('Supplier VAT No (if KSA)').fill('300999999900003');
  await poForm.getByPlaceholder('Description *').fill('Copper pipe 22mm');
  const line = poForm.getByPlaceholder('Description *').locator('xpath=..');
  await line.locator('input[type=number]').first().fill('10');
  await poForm.getByPlaceholder('0.00').first().fill('100');
  await poForm.getByRole('button', { name: 'Issue Purchase Order' }).click();
  await expect(poForm).toHaveCount(0);

  const po = () => page.locator('div.rounded-2xl', { hasText: supplier }).filter({ has: page.locator('button') }).first();
  await expect(po()).toBeVisible();

  // 2. goods receipt, everything ordered
  await po().getByRole('button', { name: /Record GRN/ }).click();
  await page.getByRole('button', { name: 'Post Goods Receipt' }).click();
  await expect(page.getByRole('button', { name: 'Post Goods Receipt' })).toHaveCount(0);

  // 3. supplier bill matched to the receipt
  await open(page, 'pur_bills');
  await page.locator('div.rounded-2xl', { hasText: supplier }).getByRole('button', { name: 'Post Supplier Bill' }).first().click();
  const bill = page.locator('div.fixed.inset-0', { has: page.getByPlaceholder(/Supplier invoice no/) });
  await bill.getByPlaceholder(/Supplier invoice no/).fill(`SINV-${stamp()}`);
  await bill.getByRole('button', { name: 'Post Supplier Bill' }).click();
  await expect(bill).toHaveCount(0);

  // 4. pay the supplier in full
  await open(page, 'fin_supplier_payments');
  await page.getByRole('button', { name: /Record Supplier Payment/ }).click();
  const pay = page.locator('div.fixed.inset-0', { hasText: 'Select Open Purchase Order' });
  const select = pay.locator('select').first();
  const value = await select.locator('option', { hasText: supplier }).getAttribute('value');
  await select.selectOption(value);
  await expect(pay.locator('option', { hasText: supplier })).toContainText('1,150.00');
  await pay.locator('input[type=number]').first().fill('1150');
  await pay.getByRole('button', { name: 'Post Supplier Payment Voucher' }).click();
  await expect(pay).toHaveCount(0);

  await open(page, 'pur_orders');
  await expect(page.locator('div.rounded-2xl', { hasText: supplier }).getByRole('button', { name: /Pay Supplier/ })).toHaveCount(0);
});
