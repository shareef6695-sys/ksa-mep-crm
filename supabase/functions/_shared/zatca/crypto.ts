// ZATCA cryptography: secp256k1 keys, the onboarding CSR, reading the CSID certificate, ECDSA signatures.
// Uses @noble/curves and @noble/hashes (audited, dependency-free; mapped to npm: specifiers in deno.json).
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import {
  bitString, concat, ctx, decodeInteger, decodeOid, fromBase64, integer, octet, oid, parse, pem, printableString,
  seq, set, toBase64, toHex, utf8, utf8String, type Bytes, type Node,
} from './der.ts';

const OID = {
  ecPublicKey: '1.2.840.10045.2.1',
  secp256k1: '1.3.132.0.10',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  extensionRequest: '1.2.840.113549.1.9.14',
  certTemplateName: '1.3.6.1.4.1.311.20.2',
  subjectAltName: '2.5.29.17',
  C: '2.5.4.6', O: '2.5.4.10', OU: '2.5.4.11', CN: '2.5.4.3', L: '2.5.4.7', ST: '2.5.4.8',
  SN: '2.5.4.4', UID: '0.9.2342.19200300.100.1.1', title: '2.5.4.12', registeredAddress: '2.5.4.26',
  businessCategory: '2.5.4.15', DC: '0.9.2342.19200300.100.1.25', STREET: '2.5.4.9',
};

export type ZatcaEnvironment = 'sandbox' | 'simulation' | 'production';

export const ZATCA_BASE_URL: Record<ZatcaEnvironment, string> = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};

// Certificate template name extension value, as ZATCA expects it per environment
// (PrintableString "PREZATCA-Code-Signing" for the test gateways, UTF8String "ZATCA-Code-Signing" for production).
function templateName(env: ZatcaEnvironment): Bytes {
  return env === 'production' ? utf8String('ZATCA-Code-Signing') : printableString('PREZATCA-Code-Signing');
}

export function newPrivateKey(): Bytes {
  return secp256k1.utils.randomPrivateKey();
}

/** SubjectPublicKeyInfo DER for a secp256k1 private key (uncompressed point). */
export function publicKeyDer(privateKey: Bytes): Bytes {
  const point = secp256k1.getPublicKey(privateKey, false);
  return seq(seq(oid(OID.ecPublicKey), oid(OID.secp256k1)), bitString(point));
}

/** ECDSA-SHA256 over `message`, DER-encoded signature. */
export function signDer(privateKey: Bytes, message: Bytes): Bytes {
  return secp256k1.sign(sha256(message), privateKey).toDERRawBytes();
}

export function verifyDer(publicKeyPoint: Bytes, message: Bytes, derSig: Bytes): boolean {
  return secp256k1.verify(derSig, sha256(message), publicKeyPoint, { format: 'der' });
}

export interface CsrInput {
  environment: ZatcaEnvironment;
  vatNumber: string; // 15 digits, starts and ends with 3
  organizationName: string; // legal name as on the VAT certificate
  organizationUnit?: string; // branch; defaults to the first 10 digits of the VAT number (TIN)
  commonName: string; // unique name of this EGS unit
  serialNumber: string; // "1-<solution>|2-<model/version>|3-<unique serial>"
  invoiceType: string; // 4 digits: 1st = standard (B2B), 2nd = simplified (B2C), e.g. "1100"
  location: string; // branch address
  industry: string; // business category
}

const MAX_CSR_FIELD_BYTES = 64;

export function validateCsrInput(i: CsrInput): string[] {
  const errors: string[] = [];
  if (!/^3\d{13}3$/.test(i.vatNumber || '')) errors.push('VAT number must be 15 digits, starting and ending with 3.');
  if (!/^[01]{4}$/.test(i.invoiceType || '') || i.invoiceType.slice(0, 2) === '00') errors.push('Invoice type must be 4 digits of 0/1, e.g. 1100.');
  if (!/^1-.+\|2-.+\|3-.+$/.test(i.serialNumber || '')) errors.push('EGS serial number must look like 1-Solution|2-Version|3-Serial.');
  const fields: [string, string | undefined][] = [
    ['Organization name', i.organizationName], ['Organization unit', i.organizationUnit], ['Common name', i.commonName],
    ['EGS serial number', i.serialNumber], ['Location', i.location], ['Industry', i.industry],
  ];
  for (const [label, v] of fields) {
    if (label !== 'Organization unit' && !String(v || '').trim()) errors.push(`${label} is required.`);
    if (utf8(String(v || '')).length > MAX_CSR_FIELD_BYTES) errors.push(`${label} must be at most ${MAX_CSR_FIELD_BYTES} bytes (Arabic letters take 2).`);
  }
  return errors;
}

const rdn = (type: string, value: Bytes) => set(seq(oid(type), value));

/** Builds the ZATCA onboarding CSR. Returns the DER, the PEM and the base64-of-PEM string the Compliance API expects. */
export function buildCsr(privateKey: Bytes, i: CsrInput): { der: Bytes; pem: string; apiCsr: string } {
  const errors = validateCsrInput(i);
  if (errors.length) throw new Error(errors.join(' '));
  const subject = seq(
    rdn(OID.C, printableString('SA')),
    rdn(OID.OU, utf8String(i.organizationUnit?.trim() || i.vatNumber.slice(0, 10))),
    rdn(OID.O, utf8String(i.organizationName.trim())),
    rdn(OID.CN, utf8String(i.commonName.trim())),
  );
  const dirName = seq(
    rdn(OID.SN, utf8String(i.serialNumber.trim())),
    rdn(OID.UID, utf8String(i.vatNumber)),
    rdn(OID.title, utf8String(i.invoiceType)),
    rdn(OID.registeredAddress, utf8String(i.location.trim())),
    rdn(OID.businessCategory, utf8String(i.industry.trim())),
  );
  const extensions = seq(
    seq(oid(OID.certTemplateName), octet(templateName(i.environment))),
    seq(oid(OID.subjectAltName), octet(seq(ctx(4, dirName)))),
  );
  const info = seq(integer(0), subject, publicKeyDer(privateKey), ctx(0, seq(oid(OID.extensionRequest), set(extensions))));
  const der = seq(info, seq(oid(OID.ecdsaWithSha256)), bitString(signDer(privateKey, info)));
  const text = pem('CERTIFICATE REQUEST', der);
  return { der, pem: text, apiCsr: toBase64(utf8(text)) };
}

// ---------------- certificate (CSID) ----------------
const SHORT_NAMES: Record<string, string> = {
  [OID.CN]: 'CN', [OID.L]: 'L', [OID.ST]: 'ST', [OID.O]: 'O', [OID.OU]: 'OU', [OID.C]: 'C',
  [OID.STREET]: 'STREET', [OID.DC]: 'DC', [OID.UID]: 'UID',
};

function rfc4514Escape(v: string): string {
  let s = v.replace(/([\\,+"<>;])/g, '\\$1');
  if (s.startsWith('#') || s.startsWith(' ')) s = '\\' + s;
  if (s.endsWith(' ')) s = s.slice(0, -1) + '\\ ';
  return s.replace(/\0/g, '\\00');
}

function nameToString(name: Node): string {
  // RFC 4514 order (last RDN first), joined with ", " — the same text ZATCA's samples put in X509IssuerName.
  return (name.children || [])
    .slice()
    .reverse()
    .map((rdnSet) =>
      (rdnSet.children || [])
        .map((atv) => {
          const [t, v] = atv.children as Node[];
          const type = decodeOid(t.content);
          return `${SHORT_NAMES[type] || type}=${rfc4514Escape(new TextDecoder().decode(v.content))}`;
        })
        .join('+'),
    )
    .join(', ');
}

export interface CertificateInfo {
  base64: string; // DER, base64 — goes into ds:X509Certificate
  issuerName: string;
  serialNumber: string; // decimal
  publicKeyDer: Bytes; // SubjectPublicKeyInfo (QR tag 8)
  publicKeyPoint: Bytes; // raw EC point, for verifying
  signature: Bytes; // the CA's signature over the certificate (QR tag 9)
  notAfter: string | null;
}

function readTime(n: Node): string | null {
  const s = new TextDecoder().decode(n.content);
  if (n.tag === 0x17) {
    const y = Number(s.slice(0, 2));
    return `${y >= 50 ? 1900 + y : 2000 + y}-${s.slice(2, 4)}-${s.slice(4, 6)}T${s.slice(6, 8)}:${s.slice(8, 10)}:${s.slice(10, 12)}Z`;
  }
  if (n.tag === 0x18) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
  return null;
}

/** Reads a certificate given as base64 DER, PEM, or ZATCA's binarySecurityToken (base64 of the base64 DER). */
export function readCertificate(input: string): CertificateInfo {
  let b64 = input.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  let der = fromBase64(b64);
  if (der[0] !== 0x30) {
    // binarySecurityToken: one more base64 layer
    b64 = new TextDecoder().decode(der).replace(/\s+/g, '');
    der = fromBase64(b64);
  }
  const cert = parse(der);
  const [tbs, , sig] = cert.children as Node[];
  const f = tbs.children as Node[];
  const k = f[0].tag === 0xa0 ? 1 : 0;
  const serial = decodeInteger(f[k].content);
  const issuer = f[k + 2];
  const validity = f[k + 3];
  const spki = f[k + 5];
  const point = (spki.children as Node[])[1].content.subarray(1);
  return {
    base64: b64,
    issuerName: nameToString(issuer),
    serialNumber: serial.toString(),
    publicKeyDer: spki.bytes.slice(),
    publicKeyPoint: point.slice(),
    signature: sig.content.subarray(1).slice(),
    notAfter: readTime((validity.children as Node[])[1]),
  };
}

export const sha256Bytes = (b: Bytes): Bytes => sha256(b);
export const sha256Hex = (b: Bytes): string => toHex(sha256(b));
export { concat, toBase64, fromBase64, utf8 };
