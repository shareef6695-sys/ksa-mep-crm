// node --experimental-strip-types sign_sample.ts <keyHex> <certB64>  -> JSON of signed samples + a CSR
import { signDocument } from '../../functions/_shared/zatca/ubl.ts';
import { buildCsr } from '../../functions/_shared/zatca/crypto.ts';
import { fromHex } from '../../functions/_shared/zatca/der.ts';
import { standardInvoice, simplifiedCredit, claimInvoice } from './sample_docs.ts';

const [keyHex, certB64] = process.argv.slice(2);
const key = fromHex(keyHex);
const out = {
  standard: signDocument(standardInvoice, key, certB64, '2026-11-22T14:15:03'),
  simplified: signDocument(simplifiedCredit, key, certB64, '2026-11-22T14:20:07'),
  claim: signDocument(claimInvoice, key, certB64, '2026-11-22T14:25:11'),
  csr: buildCsr(key, {
    environment: 'sandbox', vatNumber: '399999999900003', organizationName: 'Horizon MEP & IT Trading Co.',
    commonName: 'HORIZON-EGS-1', serialNumber: '1-Horizon ERP|2-1.0|3-9f1c2a7e-0001', invoiceType: '1100',
    location: 'Jeddah Head Office', industry: 'MEP & IT Trading',
  }).apiCsr,
};
console.log(JSON.stringify(out));
