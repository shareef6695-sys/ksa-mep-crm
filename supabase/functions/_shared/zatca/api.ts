// ZATCA Fatoora gateway calls (Compliance CSID, compliance checks, Production CSID, clearance, reporting).
import { ZATCA_BASE_URL, type ZatcaEnvironment } from './crypto.ts';
import { toBase64, utf8 } from './der.ts';

export interface Csid {
  binarySecurityToken: string;
  secret: string;
  requestID?: string | number;
}

export interface ApiResult {
  status: number; // HTTP status, 0 = network error / timeout
  body: Record<string, unknown>;
}

const basic = (c: Csid) => `Basic ${btoa(`${c.binarySecurityToken}:${c.secret}`)}`;

async function call(env: ZatcaEnvironment, path: string, method: string, body: unknown, headers: Record<string, string>, timeoutMs = 30000): Promise<ApiResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${ZATCA_BASE_URL[env]}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Language': 'en', 'Accept-Version': 'V2', ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { message: text.slice(0, 500) };
    }
    return { status: res.status, body: parsed };
  } catch (e) {
    return { status: 0, body: { error: e instanceof Error ? e.message : String(e) } };
  } finally {
    clearTimeout(timer);
  }
}

/** Step 1: CSR + OTP from the Fatoora portal -> Compliance CSID. */
export const requestComplianceCsid = (env: ZatcaEnvironment, apiCsr: string, otp: string) =>
  call(env, 'compliance', 'POST', { csr: apiCsr }, { OTP: otp });

/** Step 2: each sample document, signed with the Compliance CSID. */
export const complianceCheck = (env: ZatcaEnvironment, ccsid: Csid, xml: string, invoiceHash: string, uuid: string) =>
  call(env, 'compliance/invoices', 'POST', { invoiceHash, uuid, invoice: toBase64(utf8(xml)) }, { Authorization: basic(ccsid) });

/** Step 3: Production CSID. */
export const requestProductionCsid = (env: ZatcaEnvironment, ccsid: Csid) =>
  call(env, 'production/csids', 'POST', { compliance_request_id: String(ccsid.requestID ?? '') }, { Authorization: basic(ccsid) });

/** B2B: clearance (ZATCA stamps and returns the invoice). B2C: reporting (within 24 h). */
export const submitDocument = (env: ZatcaEnvironment, pcsid: Csid, api: 'clearance' | 'reporting', xml: string, invoiceHash: string, uuid: string) =>
  call(env, `invoices/${api}/single`, 'POST', { invoiceHash, uuid, invoice: toBase64(utf8(xml)) },
    { Authorization: basic(pcsid), 'Clearance-Status': '1' });

export function messagesOf(body: Record<string, unknown>): { errors: string[]; warnings: string[] } {
  const vr = (body.validationResults || {}) as Record<string, unknown>;
  const fmt = (m: unknown) => {
    const x = m as Record<string, string>;
    return `${x.code || ''}: ${x.message || ''}`.trim();
  };
  return {
    errors: ((vr.errorMessages as unknown[]) || []).map(fmt),
    warnings: ((vr.warningMessages as unknown[]) || []).map(fmt),
  };
}
