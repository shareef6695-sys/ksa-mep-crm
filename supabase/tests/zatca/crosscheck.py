"""
Independent cross-check of the TypeScript ZATCA signer (supabase/functions/_shared/zatca/*.ts).

Uses Python's `cryptography` and `lxml` (not our code) to:
  1. issue a throw-away secp256k1 test CA + EGS certificate,
  2. ask the TypeScript signer to sign the sample documents and build a CSR,
  3. recompute, ZATCA's way, the invoice hash (pre-hash XSL + C14N), the ECDSA signature, the
     certificate digest, the XAdES signed-properties digest and the QR, and compare,
  4. parse the CSR and check its signature, subject and ZATCA extensions.

Run from the repo root:  python3 supabase/tests/zatca/crosscheck.py
Needs: node >= 22.6, pip install cryptography lxml
"""
import base64, datetime, hashlib, json, os, subprocess, sys
from lxml import etree
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

HERE = os.path.dirname(os.path.abspath(__file__))
fails = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        fails.append(msg)


# ---------- 1. test CA + EGS certificate (secp256k1, ECDSA-SHA256), issuer shaped like ZATCA's ----------
ca_key = ec.generate_private_key(ec.SECP256K1())
egs_key = ec.generate_private_key(ec.SECP256K1())
issuer = x509.Name([
    x509.NameAttribute(NameOID.DOMAIN_COMPONENT, "local"),
    x509.NameAttribute(NameOID.DOMAIN_COMPONENT, "gov"),
    x509.NameAttribute(NameOID.DOMAIN_COMPONENT, "extgazt"),
    x509.NameAttribute(NameOID.COMMON_NAME, "TSZEINVOICE-SubCA-1"),
])
now = datetime.datetime.now(datetime.timezone.utc)
cert = (x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COUNTRY_NAME, "SA"), x509.NameAttribute(NameOID.COMMON_NAME, "HORIZON-EGS-1")]))
        .issuer_name(issuer).public_key(egs_key.public_key())
        .serial_number(379112742831380471835263969587287663520528387)
        .not_valid_before(now).not_valid_after(now + datetime.timedelta(days=365))
        .sign(ca_key, hashes.SHA256()))
cert_der = cert.public_bytes(serialization.Encoding.DER)
cert_b64 = base64.b64encode(cert_der).decode()
token = base64.b64encode(cert_b64.encode()).decode()  # ZATCA binarySecurityToken shape
key_hex = egs_key.private_numbers().private_value.to_bytes(32, "big").hex()

# ---------- 2. sign with the TypeScript code ----------
res = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", os.path.join(HERE, "sign_sample.ts"), key_hex, token],
                     capture_output=True, text=True, cwd=HERE)
if res.returncode:
    print(res.stderr)
    sys.exit(1)
out = json.loads(res.stdout)

NS = {
    "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    "ext": "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
    "ds": "http://www.w3.org/2000/09/xmldsig#",
    "xades": "http://uri.etsi.org/01903/v1.3.2#",
}
# ZATCA's pre-hash transform (same three removals as the ds:Transforms in the stamp)
PRE_HASH_XSL = etree.XML(b"""<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <xsl:output omit-xml-declaration="yes" indent="no"/>
  <xsl:template match="node() | @*"><xsl:copy><xsl:apply-templates select="node() | @*"/></xsl:copy></xsl:template>
  <xsl:template match="//*[local-name()='Invoice']//*[local-name()='UBLExtensions']"/>
  <xsl:template match="//*[local-name()='AdditionalDocumentReference'][cbc:ID[normalize-space(text()) = 'QR']]"/>
  <xsl:template match="//*[local-name()='Invoice']//*[local-name()='Signature']"/>
</xsl:stylesheet>""")
transform = etree.XSLT(PRE_HASH_XSL)


def odoo_signed_properties_digest(issuer_name, serial, signing_time, cert_digest):
    tpl = f"""<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
<xades:SignedSignatureProperties><xades:SigningTime>{signing_time}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest>
<ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
<ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">{cert_digest}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial>
<ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">{issuer_name}</ds:X509IssuerName>
<ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">{serial}</ds:X509SerialNumber>
</xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties></xades:SignedProperties>"""
    sp = etree.fromstring(tpl)
    etree.indent(sp, space="    ")
    lines = etree.tostring(sp).decode().split("\n")
    final = "\n".join([lines[0]] + [" " * 36 + l for l in lines[1:]])
    final = etree.tostring(etree.fromstring(final))
    return base64.b64encode(hashlib.sha256(final).hexdigest().encode()).decode(), final.decode()


def tlv(b):
    d, i = {}, 0
    while i < len(b):
        d[b[i]] = b[i + 2:i + 2 + b[i + 1]]
        i += 2 + b[i + 1]
    return d


issuer_name = ", ".join(r.rfc4514_string() for r in cert.issuer.rdns[::-1])
expected_cert_digest = base64.b64encode(hashlib.sha256(cert_b64.encode()).hexdigest().encode()).decode()

for label in ("standard", "simplified", "claim"):
    s = out[label]
    print(f"\n{label} document")
    root = etree.fromstring(s["xml"].encode())
    canon = etree.tostring(transform(root), method="c14n")
    h = base64.b64encode(hashlib.sha256(canon).digest()).decode()
    check(h == s["invoiceHash"], "invoice hash = SHA-256 of pre-hash-transformed C14N document")
    check(root.xpath("//ds:Reference[@Id='invoiceSignedData']/ds:DigestValue/text()", namespaces=NS)[0] == h, "hash written in ds:DigestValue")
    hexhash = hashlib.sha256(canon).hexdigest().encode()
    sig = base64.b64decode(root.xpath("//ds:SignatureValue/text()", namespaces=NS)[0])
    try:
        egs_key.public_key().verify(sig, hexhash, ec.ECDSA(hashes.SHA256()))
        check(True, "ECDSA secp256k1 signature verifies with the certificate's public key")
    except Exception:
        check(False, "ECDSA secp256k1 signature verifies with the certificate's public key")
    check(root.xpath("//ds:X509Certificate/text()", namespaces=NS)[0] == cert_b64, "certificate embedded (base64 DER)")
    check(root.xpath("//xades:CertDigest/ds:DigestValue/text()", namespaces=NS)[0] == expected_cert_digest, "certificate digest")
    check(root.xpath("//ds:X509IssuerName/text()", namespaces=NS)[0] == issuer_name, f"issuer name ({issuer_name})")
    check(root.xpath("//ds:X509SerialNumber/text()", namespaces=NS)[0] == str(cert.serial_number), "serial number")
    st = root.xpath("//xades:SigningTime/text()", namespaces=NS)[0]
    want, final_text = odoo_signed_properties_digest(issuer_name, cert.serial_number, st, expected_cert_digest)
    got = root.xpath("//ds:Reference[@URI='#xadesSignedProperties']/ds:DigestValue/text()", namespaces=NS)[0]
    check(got == want, "signed-properties digest (ZATCA / Odoo method)")
    check(final_text in s["xml"], "signed properties appear in the document exactly as hashed")
    check(s["xml"].startswith('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns='), "XML declaration and root")
    pay = root.xpath("//cac:LegalMonetaryTotal/cbc:PayableAmount/text()", namespaces=NS)[0]
    vat = root.xpath("/*/cac:TaxTotal[1]/cbc:TaxAmount/text()", namespaces=NS)[0]
    lines_net = sum(float(x) for x in root.xpath("//cac:InvoiceLine/cbc:LineExtensionAmount/text()", namespaces=NS))
    check(abs(lines_net - float(root.xpath("//cbc:LineExtensionAmount/text()", namespaces=NS)[0])) < 0.001, "sum of line nets = LineExtensionAmount")
    if label == "simplified":
        qr = root.xpath("//cac:AdditionalDocumentReference[cbc:ID='QR']//cbc:EmbeddedDocumentBinaryObject/text()", namespaces=NS)[0]
        t = tlv(base64.b64decode(qr))
        check(t[1].decode() == "Horizon MEP & IT Trading Co." and t[2].decode() == "399999999900003", "QR tags 1-2 seller")
        check(t[4].decode() == pay and t[5].decode() == vat, f"QR tags 4-5 totals ({pay} / {vat})")
        check(t[6].decode() == h, "QR tag 6 = invoice hash")
        check(t[7] == root.xpath("//ds:SignatureValue/text()", namespaces=NS)[0].encode(), "QR tag 7 = signature")
        check(t[8] == egs_key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo), "QR tag 8 = public key")
        check(t[9] == cert.signature, "QR tag 9 = certificate signature")
        check(root.xpath("//cbc:InvoiceTypeCode/@name", namespaces=NS)[0] == "0200000" and root.xpath("//cbc:InvoiceTypeCode/text()", namespaces=NS)[0] == "381", "simplified credit note type 381 / 0200000")
        check(root.xpath("//cac:BillingReference//cbc:ID/text()", namespaces=NS)[0] == "INV-2026-00011", "billing reference")
    else:
        check(not root.xpath("//cac:AdditionalDocumentReference[cbc:ID='QR']", namespaces=NS), "standard invoice carries no own QR (ZATCA adds it on clearance)")
        check(root.xpath("//cbc:InvoiceTypeCode/@name", namespaces=NS)[0] == "0100000", "standard invoice type 388 / 0100000")
    if label == "claim":
        inc = float(root.xpath("//cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount/text()", namespaces=NS)[0])
        pre = float(root.xpath("//cac:LegalMonetaryTotal/cbc:PrepaidAmount/text()", namespaces=NS)[0])
        k31 = sum(float(x) for x in root.xpath("//cac:InvoiceLine[cac:DocumentReference]/cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount/text()", namespaces=NS))
        k32 = sum(float(x) for x in root.xpath("//cac:InvoiceLine[cac:DocumentReference]/cac:TaxTotal/cac:TaxSubtotal/cbc:TaxAmount/text()", namespaces=NS))
        check(abs(pre - (k31 + k32)) < 0.001, "BT-113 PrepaidAmount = KSA-31 + KSA-32 (BR-KSA-80)")
        check(abs(float(pay) - (inc - pre)) < 0.001, "BR-CO-16 PayableAmount = TaxInclusiveAmount - PrepaidAmount")
        check(root.xpath("//cac:InvoiceLine/cac:DocumentReference/cbc:DocumentTypeCode/text()", namespaces=NS) == ["386"], "prepayment line references a 386 invoice")
        adj = root.xpath("//cac:InvoiceLine[cac:DocumentReference]", namespaces=NS)[0]
        check(all(float(x) == 0 for x in adj.xpath("cbc:LineExtensionAmount/text()|cac:TaxTotal/cbc:TaxAmount/text()|cac:TaxTotal/cbc:RoundingAmount/text()|cac:Price/cbc:PriceAmount/text()", namespaces=NS)), "adjustment line amounts are zero")

# ---------- CSR ----------
print("\nCSR")
csr = x509.load_pem_x509_csr(base64.b64decode(out["csr"]))
check(csr.is_signature_valid, "CSR signature valid")
check(isinstance(csr.public_key().curve, ec.SECP256K1), "secp256k1 key")
subj = {a.oid.dotted_string: a.value for a in csr.subject}
check(subj.get("2.5.4.6") == "SA" and subj.get("2.5.4.11") == "3999999999" and subj.get("2.5.4.3") == "HORIZON-EGS-1", f"subject {csr.subject.rfc4514_string()}")
tmpl = csr.extensions.get_extension_for_oid(x509.ObjectIdentifier("1.3.6.1.4.1.311.20.2")).value.value
check(tmpl == b"\x13\x15PREZATCA-Code-Signing", "certificate template name (sandbox)")
san = csr.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
dn = {a.oid.dotted_string: a.value for a in san.get_values_for_type(x509.DirectoryName)[0]}
check(dn == {"2.5.4.4": "1-Horizon ERP|2-1.0|3-9f1c2a7e-0001", "0.9.2342.19200300.100.1.1": "399999999900003",
             "2.5.4.12": "1100", "2.5.4.26": "Jeddah Head Office", "2.5.4.15": "MEP & IT Trading"}, "SAN directory name (SN, UID, title, registeredAddress, businessCategory)")
with open("/tmp/zatca_csr.pem", "wb") as f:
    f.write(base64.b64decode(out["csr"]))
v = subprocess.run(["openssl", "req", "-in", "/tmp/zatca_csr.pem", "-noout", "-verify"], capture_output=True, text=True)
check("verify OK" in (v.stdout + v.stderr), "openssl req -verify")

print("\n" + ("ZATCA CROSSCHECK OK" if not fails else f"{len(fails)} FAILED"))
sys.exit(1 if fails else 0)
