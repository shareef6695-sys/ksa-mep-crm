// End-to-end tests (Prompt 15). They drive the real app against a Supabase stack seeded by e2e/seed.sql.
// CI: .github/workflows/ci.yml starts Supabase (supabase start), applies the migrations and the seed, builds the app
// and runs these tests. Locally: see README "End-to-end tests".
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4173',
    channel: process.env.PW_CHANNEL || undefined, // e.g. "chrome" to use an installed Chrome
    viewport: { width: 1400, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
