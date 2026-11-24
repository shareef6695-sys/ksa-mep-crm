// =====================================================================
// zatca — ZATCA Phase 2 for Horizon ERP (gaps Z1-Z4, Z8, Z9)
// ---------------------------------------------------------------------
// Everything cryptographic runs here; keys and CSIDs never reach the browser. They are stored in
// public.zatca_egs, AES-GCM encrypted with the ZATCA_ENC_KEY secret, in a table only the service role can read.
//
// POST { action, ... } with the caller's session (supabase.functions.invoke):
//   "status"                                       admin / ceo / finance   EGS state, queue, overdue B2C
//   "onboard"   { environment, otp, csr: {...} }   admin                   CSR -> Compliance CSID -> compliance checks -> Production CSID
//   "compliance_checks" { egs_id }                 admin                   re-run checks for an EGS stuck after step 1
//   "activate"  { egs_id }                         admin                   request the Production CSID and switch to this EGS
//   "submit"    { doc_type, doc_id }               admin / ceo / finance   sign + clear (B2B) / report (B2C) one document
//   "process_queue" { limit? }                     admin / finance, or the x-zatca-cron header = ZATCA_CRON_SECRET
//
// Secrets:  ZATCA_ENC_KEY  = 32 random bytes, base64   (openssl rand -base64 32)
//           ZATCA_CRON_SECRET = any long random string (for the scheduled queue run)
// Deploy:   supabase functions deploy zatca
// =====================================================================
import { publicError, redact, safeEqual } from '../_shared/safe.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { buildCsr, newPrivateKey, readCertificate, validateCsrInput, type CsrInput, type ZatcaEnvironment } from '../_shared/zatca/crypto.ts';
import { fromBase64, fromHex, toBase64, toHex, utf8 } from '../_shared/zatca/der.ts';
import { INITIAL_PIH, qrFromXml, signDocument } from '../_shared/zatca/ubl.ts';
import { complianceDocuments, payloadToDocument, sellerFromCompany, totalsMismatch, type DocPayload } from '../_shared/zatca/mapping.ts';
import { complianceCheck, messagesOf, requestComplianceCsid, requestProductionCsid, submitDocument, type Csid } from '../_shared/zatca/api.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-zatca-cron',
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
const ENVIRONMENTS: ZatcaEnvironment[] = ['sandbox', 'simulation', 'production'];
const DOC_TYPES = ['invoice', 'credit_note', 'debit_note'];

// ---------------------------------------------------------------- secrets at rest
async function encKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('ZATCA_ENC_KEY');
  if (!raw) throw new HttpError(500, 'Set the ZATCA_ENC_KEY function secret first (openssl rand -base64 32).');
  const bytes = fromBase64(raw);
  if (bytes.length !== 32) throw new HttpError(500, 'ZATCA_ENC_KEY must be 32 bytes, base64 encoded.');
  return crypto.subtle.importKey('raw', bytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encKey(), utf8(plain) as BufferSource));
  return `v1:${toBase64(iv)}:${toBase64(ct)}`;
}
async function open(sealed: string | null): Promise<string> {
  if (!sealed) throw new HttpError(409, 'Missing ZATCA credential; complete onboarding.');
  const [v, iv, ct] = sealed.split(':');
  if (v !== 'v1') throw new HttpError(500, 'Unknown secret format.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) as BufferSource }, await encKey(), fromBase64(ct) as BufferSource);
  return new TextDecoder().decode(pt);
}

// ---------------------------------------------------------------- callers
async function callerRole(admin: SupabaseClient, authHeader: string | null): Promise<{ uid: string; role: string }> {
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Not signed in.');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Session expired. Sign in again.');
  const { data: r } = await admin.from('user_roles').select('role, active').eq('user_id', data.user.id).maybeSingle();
  if (!r?.active) throw new HttpError(403, 'Your account has no active role.');
  return { uid: data.user.id, role: r.role };
}
const need = (role: string, allowed: string[]) => {
  if (!allowed.includes(role)) throw new HttpError(403, `Your role (${role}) cannot do this. Allowed: ${allowed.join(', ')}.`);
};

const rpc = async <T = unknown>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new HttpError(400, error.message);
  return data as T;
};

// ---------------------------------------------------------------- onboarding
async function company(db: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await db.from('app_settings').select('value').eq('key', 'company_profile').maybeSingle();
  return (data?.value || {}) as Record<string, string>;
}

function csidFrom(body: Record<string, unknown>): Csid {
  const binarySecurityToken = str(body.binarySecurityToken, 20000);
  const secret = str(body.secret, 500);
  if (!binarySecurityToken || !secret) throw new HttpError(502, `ZATCA did not return a CSID: ${JSON.stringify(redact(body)).slice(0, 400)}`);
  return { binarySecurityToken, secret, requestID: body.requestID as string };
}

async function onboard(db: SupabaseClient, body: Record<string, unknown>) {
  const environment = str(body.environment, 20) as ZatcaEnvironment;
  if (!ENVIRONMENTS.includes(environment)) throw new HttpError(400, 'Environment must be sandbox, simulation or production.');
  const otp = str(body.otp, 20);
  if (!/^\d{6}$/.test(otp)) throw new HttpError(400, 'Enter the 6-digit OTP from the Fatoora portal.');
  const c = await company(db);
  const raw = (body.csr || {}) as Record<string, string>;
  const input: CsrInput = {
    environment,
    vatNumber: str(c.vatNumber, 15),
    organizationName: str(raw.organizationName || c.nameEn, 64),
    organizationUnit: str(raw.organizationUnit, 64) || undefined,
    commonName: str(raw.commonName, 64),
    serialNumber: str(raw.serialNumber, 64),
    invoiceType: str(raw.invoiceType || '1100', 4),
    location: str(raw.location || [c.buildingNo, c.street, c.city].filter(Boolean).join(' '), 64),
    industry: str(raw.industry || 'Trading', 64),
  };
  const problems = validateCsrInput(input);
  if (problems.length) throw new HttpError(400, problems.join(' '));

  const key = newPrivateKey();
  const csr = buildCsr(key, input);
  const res = await requestComplianceCsid(environment, csr.apiCsr, otp);
  if (res.status !== 200) {
    throw new HttpError(502, `ZATCA refused the CSR / OTP (HTTP ${res.status}): ${JSON.stringify(res.body).slice(0, 500)}`);
  }
  const ccsid = csidFrom(res.body);
  const { data: egs, error } = await db.from('zatca_egs').insert({
    environment, status: 'compliance', csr_input: input, csr_pem: csr.pem,
    private_key_enc: await seal(toHex(key)), ccsid_token_enc: await seal(ccsid.binarySecurityToken),
    ccsid_secret_enc: await seal(ccsid.secret), ccsid_request_id: String(ccsid.requestID ?? ''),
  }).select('id').single();
  if (error) throw new HttpError(500, error.message);
  const checks = await runComplianceChecks(db, egs.id);
  if (!checks.passed) return { egs_id: egs.id, step: 'compliance_checks', ...checks };
  return { egs_id: egs.id, ...checks, ...(await activate(db, egs.id)) };
}

async function loadEgs(db: SupabaseClient, id: string) {
  const { data, error } = await db.from('zatca_egs').select('*').eq('id', id).maybeSingle();
  if (error || !data) throw new HttpError(404, 'EGS unit not found.');
  return data;
}

async function runComplianceChecks(db: SupabaseClient, egsId: string) {
  const egs = await loadEgs(db, egsId);
  const key = fromHex(await open(egs.private_key_enc));
  const ccsid: Csid = { binarySecurityToken: await open(egs.ccsid_token_enc), secret: await open(egs.ccsid_secret_enc), requestID: egs.ccsid_request_id };
  const seller = sellerFromCompany(await company(db));
  const results: Record<string, unknown>[] = [];
  let pih = INITIAL_PIH;
  for (const d of complianceDocuments(seller, egs.csr_input.invoiceType || '1100')) {
    const label = `${d.profile} ${d.kind}`;
    try {
      const signed = signDocument({ ...d, pih }, key, ccsid.binarySecurityToken);
      pih = signed.invoiceHash;
      const r = await complianceCheck(egs.environment, ccsid, signed.xml, signed.invoiceHash, signed.uuid);
      const vr = (r.body.validationResults || {}) as Record<string, string>;
      const state = String(r.body.clearanceStatus || r.body.reportingStatus || '');
      const ok = (r.status === 200 || r.status === 202) && ['PASS', 'WARNING'].includes(String(vr.status)) && ['CLEARED', 'REPORTED'].includes(state);
      results.push({ document: label, ok, http: r.status, status: vr.status || null, result: state || null, ...messagesOf(r.body) });
    } catch (e) {
      results.push({ document: label, ok: false, http: null, errors: [e instanceof Error ? e.message : String(e)], warnings: [] });
    }
  }
  const passed = results.every((r) => r.ok);
  await db.from('zatca_egs').update({
    compliance_results: results, status: passed ? 'compliance_passed' : 'compliance', updated_at: new Date().toISOString(),
    last_error: passed ? null : 'Compliance checks did not all pass; see the results.',
  }).eq('id', egsId);
  return { passed, results };
}

async function activate(db: SupabaseClient, egsId: string) {
  const egs = await loadEgs(db, egsId);
  if (egs.status !== 'compliance_passed') throw new HttpError(409, 'Run the compliance checks successfully first.');
  const ccsid: Csid = { binarySecurityToken: await open(egs.ccsid_token_enc), secret: await open(egs.ccsid_secret_enc), requestID: egs.ccsid_request_id };
  const res = await requestProductionCsid(egs.environment, ccsid);
  if (res.status !== 200) throw new HttpError(502, `ZATCA refused the Production CSID request (HTTP ${res.status}): ${JSON.stringify(res.body).slice(0, 500)}`);
  const pcsid = csidFrom(res.body);
  const cert = readCertificate(pcsid.binarySecurityToken);
  // one active EGS at a time: retire the old one, then switch (its chain stays in zatca_submissions)
  await db.from('zatca_egs').update({ is_active: false, status: 'retired', updated_at: new Date().toISOString() }).eq('is_active', true).neq('id', egsId);
  const { error } = await db.from('zatca_egs').update({
    pcsid_token_enc: await seal(pcsid.binarySecurityToken), pcsid_secret_enc: await seal(pcsid.secret),
    pcsid_request_id: String(pcsid.requestID ?? ''), certificate_expires_at: cert.notAfter, status: 'active', is_active: true,
    activated_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null,
  }).eq('id', egsId);
  if (error) throw new HttpError(500, error.message);
  return { activated: true, environment: egs.environment, certificate_expires_at: cert.notAfter };
}

// ---------------------------------------------------------------- submission
type Begin =
  | { mode: 'sign'; lease: string; egs_id: string; environment: ZatcaEnvironment; icv: number; pih: string; uuid: string; payload: DocPayload }
  | { mode: 'resend' | 'done'; environment: ZatcaEnvironment; submission: Record<string, unknown> };

async function credentials(db: SupabaseClient) {
  const { data: egs } = await db.from('zatca_egs').select('*').eq('is_active', true).maybeSingle();
  if (!egs) throw new HttpError(409, 'ZATCA Phase 2 is not set up: no active EGS unit.');
  return {
    egs,
    key: fromHex(await open(egs.private_key_enc)),
    pcsid: { binarySecurityToken: await open(egs.pcsid_token_enc), secret: await open(egs.pcsid_secret_enc) } as Csid,
  };
}

async function send(db: SupabaseClient, env: ZatcaEnvironment, pcsid: Csid, sub: { id: number; api: 'clearance' | 'reporting'; signed_xml: string; invoice_hash: string; uuid: string; qr?: string | null }) {
  const r = await submitDocument(env, pcsid, sub.api, sub.signed_xml, sub.invoice_hash, sub.uuid);
  let clearedXml: string | null = null;
  let qr: string | null = null;
  if (sub.api === 'clearance' && typeof r.body.clearedInvoice === 'string') {
    clearedXml = new TextDecoder().decode(fromBase64(r.body.clearedInvoice as string));
    qr = qrFromXml(clearedXml);
  }
  return rpc<Record<string, unknown>>(db, 'zatca_record_result', {
    p_submission_id: sub.id, p_http_status: r.status, p_response: r.body, p_cleared_xml: clearedXml, p_cleared_qr: qr,
  });
}

async function processDocument(db: SupabaseClient, docType: string, docId: string) {
  if (!DOC_TYPES.includes(docType)) throw new HttpError(400, 'doc_type must be invoice, credit_note or debit_note.');
  const begin = await rpc<Begin>(db, 'zatca_begin', { p_doc_type: docType, p_doc_id: docId });
  if (begin.mode === 'done') return { status: begin.submission.status, submission_id: begin.submission.id };
  const { pcsid, key, egs } = await credentials(db);
  if (begin.mode === 'resend') {
    const s = begin.submission as { id: number; api: 'clearance' | 'reporting'; signed_xml: string; invoice_hash: string; uuid: string };
    return send(db, begin.environment, pcsid, s);
  }
  const b = begin as Extract<Begin, { mode: 'sign' }>;
  let committed = false;
  try {
    const doc = payloadToDocument(b.payload, { icv: Number(b.icv), pih: b.pih, uuid: b.uuid });
    const mismatch = totalsMismatch(doc, b.payload);
    if (mismatch) throw new HttpError(422, mismatch);
    const signed = signDocument(doc, key, pcsid.binarySecurityToken);
    const id = await rpc<number>(db, 'zatca_commit', {
      p_lease: b.lease, p_doc_type: docType, p_doc_id: docId, p_doc_number: b.payload.number, p_profile: doc.profile,
      p_icv: doc.icv, p_uuid: doc.uuid, p_pih: doc.pih, p_hash: signed.invoiceHash, p_xml: signed.xml, p_qr: signed.qr,
    });
    committed = true;
    return send(db, egs.environment, pcsid, {
      id, api: doc.profile === 'standard' ? 'clearance' : 'reporting', signed_xml: signed.xml, invoice_hash: signed.invoiceHash, uuid: doc.uuid,
    });
  } finally {
    if (!committed) await db.rpc('zatca_release', { p_lease: b.lease });
  }
}

async function processQueue(db: SupabaseClient, limit: number) {
  const { data: queue, error } = await db.rpc('zatca_queue', { p_limit: limit });
  if (error) throw new HttpError(400, error.message);
  const done: Record<string, unknown>[] = [];
  for (const q of (queue || []) as { doc_type: string; doc_id: string; doc_number: string }[]) {
    try {
      done.push({ doc: q.doc_number, ...(await processDocument(db, q.doc_type, q.doc_id)) });
    } catch (e) {
      done.push({ doc: q.doc_number, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { processed: done.length, results: done };
}

async function status(db: SupabaseClient) {
  const { data: units } = await db.from('zatca_egs')
    .select('id, environment, status, csr_input, certificate_expires_at, compliance_results, last_icv, is_active, last_error, created_at, activated_at')
    .order('created_at', { ascending: false }).limit(10);
  const { data: queue } = await db.rpc('zatca_queue', { p_limit: 200 });
  const { data: overdue } = await db.from('zatca_overdue_reporting').select('*');
  return { units: units || [], queued: (queue || []).length, overdue_b2c: overdue || [] };
}

// ---------------------------------------------------------------- entry
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = str(body.action, 40);
    const cron = Deno.env.get('ZATCA_CRON_SECRET');
    if (action === 'process_queue' && cron && safeEqual(req.headers.get('x-zatca-cron'), cron)) {
      return json(200, await processQueue(db, Math.min(100, Number(body.limit) || 25)));
    }
    const me = await callerRole(db, req.headers.get('Authorization'));
    switch (action) {
      case 'status':
        need(me.role, ['admin', 'ceo', 'finance']);
        return json(200, await status(db));
      case 'onboard':
        need(me.role, ['admin']);
        return json(200, await onboard(db, body));
      case 'compliance_checks':
        need(me.role, ['admin']);
        return json(200, await runComplianceChecks(db, str(body.egs_id, 64)));
      case 'activate':
        need(me.role, ['admin']);
        return json(200, await activate(db, str(body.egs_id, 64)));
      case 'submit':
        need(me.role, ['admin', 'ceo', 'finance']);
        return json(200, await processDocument(db, str(body.doc_type, 20), str(body.doc_id, 80)));
      case 'process_queue':
        need(me.role, ['admin', 'finance']);
        return json(200, await processQueue(db, Math.min(100, Number(body.limit) || 25)));
      default:
        throw new HttpError(400, `Unknown action "${action}".`);
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json(status, { error: publicError('zatca', e, e instanceof HttpError) });
  }
});
