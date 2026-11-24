// Shared steps for the end-to-end tests.
import { expect } from '@playwright/test';

// Throwaway password for the local / CI test users; never a real one. CI generates a random value per run.
export const PASSWORD = process.env.E2E_PASSWORD;
if (!PASSWORD) throw new Error('Set E2E_PASSWORD (any throwaway value; the same one used for e2e/seed.mjs).');
export const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(2, 14);

export async function login(page, email) {
  page.on('dialog', (d) => d.accept()); // confirmations and posting messages
  await page.goto('/');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Today at a glance')).toBeVisible();
}

/** Opens a screen by its URL (each screen has one since Prompt 15). */
export async function open(page, screen) {
  await page.goto(`/${screen}`);
  await expect(page.locator('main, body').first()).toBeVisible();
}

/** The card / row in a list that mentions `text`. */
export const card = (page, text) => page.locator('div.rounded-2xl', { hasText: text }).last();
