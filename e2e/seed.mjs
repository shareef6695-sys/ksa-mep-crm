// Seeds a LOCAL / CI Supabase stack for the end-to-end tests: test users with roles and a company profile.
// Refuses to run against anything but localhost. Usage:
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... node e2e/seed.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.E2E_PASSWORD || 'Test-1234';
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) throw new Error(`Refusing to seed ${url}: local stacks only.`);

const sb = createClient(url, key, { auth: { persistSession: false } });
const USERS = [
  { email: 'admin@test', name: 'Admin', role: 'admin' },
  { email: 'finance@test', name: 'Fatima Finance', role: 'finance' },
  { email: 'manager@test', name: 'Majid Manager', role: 'manager', division: 'MEP', salesman: true, pct: 5 },
  { email: 'sales1@test', name: 'Sami Sales', role: 'sales_mep', division: 'MEP', salesman: true, pct: 10 },
  { email: 'sales2@test', name: 'Sara Sales', role: 'sales_it', division: 'IT & ELV', salesman: true, pct: 10 },
  { email: 'proc@test', name: 'Pete Procurement', role: 'procurement' },
];

const fail = (what, error) => { if (error) throw new Error(`${what}: ${error.message}`); };
const { data: list, error: le } = await sb.auth.admin.listUsers({ perPage: 1000 });
fail('list users', le);
for (const u of USERS) {
  let user = list.users.find((x) => x.email === u.email);
  if (!user) {
    const { data, error } = await sb.auth.admin.createUser({ email: u.email, password, email_confirm: true });
    fail(`create ${u.email}`, error);
    user = data.user;
  }
  fail(`profile ${u.email}`, (await sb.from('team_profiles').upsert({
    id: user.id, email: u.email, full_name: u.name, role_key: u.role, division: u.division || null,
    is_salesman: !!u.salesman, commission_pct: u.pct || 0, active: true,
  })).error);
  fail(`role ${u.email}`, (await sb.from('user_roles').upsert({ user_id: user.id, role: u.role, division: u.division || null, active: true })).error);
}
fail('company profile', (await sb.from('app_settings').upsert({
  key: 'company_profile',
  value: { nameEn: 'Horizon Business Solutions Est.', vatNumber: '300000000000003', crNumber: '4030000000', buildingNo: '7788',
           street: 'Tahlia St', district: 'Al Andalus', city: 'Jeddah', postalCode: '23326' },
})).error);
console.log(`Seeded ${USERS.length} users (password ${password === 'Test-1234' ? 'Test-1234' : 'from E2E_PASSWORD'}).`);
