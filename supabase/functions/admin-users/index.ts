// =====================================================================
// admin-users — server-side user management for Horizon ERP (gap S2)
// ---------------------------------------------------------------------
// Replaces the browser-side auth.signUp() call, so public sign-up can be
// turned OFF in Supabase Auth settings.
//
// POST { action, ...payload } with the caller's session token (supabase.functions.invoke does this).
// The caller must be an active admin. The service-role key never leaves this function.
//
//   action "create"          { email, password, full_name, phone?, role_key, division?, is_salesman?, commission_pct? }
//   action "set_role"        { user_id, role_key, division?, is_salesman?, commission_pct? }
//   action "set_status"      { user_id, active }        -> also blocks / unblocks sign-in
//   action "reset_password"  { user_id, password }
//
// Deploy:  supabase functions deploy admin-users
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
// =====================================================================
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const ROLES = ['admin', 'ceo', 'finance', 'manager', 'sales_mep', 'sales_it', 'procurement'] as const;
const ROLE_LABELS: Record<string, string> = {
  admin: 'System Administrator',
  ceo: 'CEO / General Manager',
  finance: 'Finance & ZATCA Accountant',
  manager: 'Sales Manager',
  sales_mep: 'Sales Executive (MEP)',
  sales_it: 'Sales Executive (IT & ELV)',
  procurement: 'Procurement & Logistics Officer',
};
const DIVISIONS = ['MEP', 'IT & ELV', 'Shared'];
const BAN_FOREVER = '876000h'; // ~100 years

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function validRole(role: unknown): string {
  const r = str(role, 40);
  if (!(ROLES as readonly string[]).includes(r)) throw new HttpError(400, `Unknown role "${r}".`);
  return r;
}

function validDivision(d: unknown): string | null {
  const v = str(d, 40);
  if (!v) return null;
  if (!DIVISIONS.includes(v)) throw new HttpError(400, `Unknown division "${v}".`);
  return v;
}

function validPct(v: unknown): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, 'Commission must be between 0 and 100%.');
  return Math.round(n * 10000) / 10000;
}

function validPassword(p: unknown): string {
  const v = typeof p === 'string' ? p : '';
  if (v.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (v.length > 72) throw new HttpError(400, 'Password must be at most 72 characters.');
  return v;
}

function validUuid(v: unknown): string {
  const s = str(v, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw new HttpError(400, 'Invalid user id.');
  return s;
}

// The caller must be an active admin. Uses user_roles (migration 0002); falls back to
// team_profiles.role_key if that migration hasn't been applied yet.
async function requireAdmin(admin: SupabaseClient, authHeader: string | null): Promise<string> {
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Not signed in.');
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) throw new HttpError(401, 'Session expired. Sign in again.');
  const uid = userData.user.id;

  const roleRes = await admin.from('user_roles').select('role, active').eq('user_id', uid).maybeSingle();
  if (!roleRes.error) {
    if (roleRes.data?.role === 'admin' && roleRes.data.active) return uid;
    throw new HttpError(403, 'Only a System Administrator can manage users.');
  }
  const profRes = await admin.from('team_profiles').select('role_key, active').eq('id', uid).maybeSingle();
  if (profRes.data?.role_key === 'admin' && profRes.data.active !== false) return uid;
  throw new HttpError(403, 'Only a System Administrator can manage users.');
}

async function createUser(admin: SupabaseClient, body: Record<string, unknown>) {
  const email = str(body.email, 254).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const password = validPassword(body.password);
  const fullName = str(body.full_name, 120);
  if (!fullName) throw new HttpError(400, 'Full name is required.');
  const role = validRole(body.role_key);
  const division = validDivision(body.division);
  const isSalesman = Boolean(body.is_salesman);
  const commission = isSalesman ? validPct(body.commission_pct) : 0;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createErr || !created?.user) {
    const msg = createErr?.message || 'Could not create the login.';
    throw new HttpError(/already|registered|exists/i.test(msg) ? 409 : 400, msg);
  }

  const { error: profErr } = await admin.from('team_profiles').upsert({
    id: created.user.id,
    email,
    full_name: fullName,
    phone: str(body.phone, 40) || null,
    role_key: role,
    role_label: ROLE_LABELS[role],
    division,
    is_salesman: isSalesman,
    commission_pct: commission,
    active: true,
  });
  if (profErr) {
    // keep things consistent: no login without a profile
    await admin.auth.admin.deleteUser(created.user.id);
    throw new HttpError(500, `Could not save the team profile: ${profErr.message}`);
  }
  return { user_id: created.user.id, email, full_name: fullName, role_key: role };
}

async function setRole(admin: SupabaseClient, body: Record<string, unknown>) {
  const userId = validUuid(body.user_id);
  const role = validRole(body.role_key);
  const patch: Record<string, unknown> = { role_key: role, role_label: ROLE_LABELS[role] };
  if ('division' in body) patch.division = validDivision(body.division);
  if ('is_salesman' in body) patch.is_salesman = Boolean(body.is_salesman);
  if ('commission_pct' in body) patch.commission_pct = validPct(body.commission_pct);
  const { data, error } = await admin.from('team_profiles').update(patch).eq('id', userId).select('id').maybeSingle();
  if (error) throw new HttpError(400, error.message); // e.g. "At least one active administrator is required."
  if (!data) throw new HttpError(404, 'User not found.');
  return { user_id: userId, role_key: role };
}

async function setStatus(admin: SupabaseClient, body: Record<string, unknown>, callerId: string) {
  const userId = validUuid(body.user_id);
  const active = Boolean(body.active);
  if (!active && userId === callerId) throw new HttpError(400, 'You cannot deactivate your own account.');

  const { data, error } = await admin.from('team_profiles').update({ active }).eq('id', userId).select('id').maybeSingle();
  if (error) throw new HttpError(400, error.message);
  if (!data) throw new HttpError(404, 'User not found.');

  // Block or unblock sign-in; a ban also ends the user's current sessions.
  const { error: banErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : BAN_FOREVER });
  if (banErr) {
    await admin.from('team_profiles').update({ active: !active }).eq('id', userId); // roll back
    throw new HttpError(500, `Could not ${active ? 'unblock' : 'block'} sign-in: ${banErr.message}`);
  }
  return { user_id: userId, active };
}

async function resetPassword(admin: SupabaseClient, body: Record<string, unknown>) {
  const userId = validUuid(body.user_id);
  const password = validPassword(body.password);
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) throw new HttpError(400, error.message);
  return { user_id: userId };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) throw new HttpError(500, 'Function is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const callerId = await requireAdmin(admin, req.headers.get('Authorization'));
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    switch (body.action) {
      case 'create':
        return json(200, { ok: true, ...(await createUser(admin, body)) });
      case 'set_role':
        return json(200, { ok: true, ...(await setRole(admin, body)) });
      case 'set_status':
        return json(200, { ok: true, ...(await setStatus(admin, body, callerId)) });
      case 'reset_password':
        return json(200, { ok: true, ...(await resetPassword(admin, body)) });
      default:
        throw new HttpError(400, `Unknown action "${String(body.action ?? '')}".`);
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Unexpected error.';
    if (status >= 500) console.error('admin-users error:', e);
    return json(status, { error: message });
  }
});
