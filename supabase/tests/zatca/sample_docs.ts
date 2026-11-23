// Sample documents used by the ZATCA unit tests and the Python cross-check (crosscheck.py).
import type { ZatcaDocument } from '../../functions/_shared/zatca/ubl.ts';

export const seller = {
  name: 'Horizon MEP & IT Trading Co.', vatNumber: '399999999900003', crNumber: '4030123456',
  buildingNo: '1234', street: 'Prince Sultan St', district: 'Al Rawdah', city: 'Jeddah', postalCode: '23435', additionalNo: '5678', country: 'SA',
};
export const buyer = {
  name: 'Al-Haramain Contracting & Sons', vatNumber: '300000000000003', crNumber: '4030999999',
  buildingNo: '4321', street: 'King Abdulaziz Rd', district: 'Al Hamra', city: 'Riyadh', postalCode: '12345', country: 'SA',
};

export const standardInvoice: ZatcaDocument = {
  kind: 'invoice', profile: 'standard', number: 'INV-2026-00017', uuid: '3cf5ee18-ee25-44ea-a444-2c37ba7f28be',
  issueDate: '2026-11-22', issueTime: '14:15:00', icv: 17, pih: 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
  seller, buyer,
  lines: [
    { name: 'Copper cable 4mm <armoured> & "fire rated"', qty: 40, unitPrice: 46.875, vatCategory: 'S', vatRate: 0.15 },
    { name: 'كابل نحاسي - توريد', qty: 3, unitPrice: 1234.5678, vatCategory: 'S', vatRate: 0.15 },
    { name: 'Export handling', qty: 1, unitPrice: 100, vatCategory: 'Z', exemptionCode: 'VATEX-SA-32' },
  ],
};

export const simplifiedCredit: ZatcaDocument = {
  kind: 'credit', profile: 'simplified', number: 'CN-2026-00003', uuid: '8e6000cf-1a98-4174-b3e7-b5d5954bc10d',
  issueDate: '2026-11-22', issueTime: '14:20:05', icv: 18, pih: 'tLfEODfOIu7i1ZMc5DnTdRpOD9KEJpYuf7K4HbfX6Hw=',
  billingReference: 'INV-2026-00011', reason: 'Goods returned damaged', paymentMeansCode: '10',
  seller, buyer: { name: 'Walk-in customer' },
  lines: [{ name: 'LED panel 60x60', qty: 2, unitPrice: 85.2173913, vatCategory: 'S', vatRate: 0.15 }],
};

// progress claim deducting an advance (type 386) invoice: prepayment adjustment line + PrepaidAmount (0014)
export const claimInvoice: ZatcaDocument = {
  ...standardInvoice, number: 'INV-2026-00031', uuid: '6b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', icv: 31,
  lines: [{ name: 'Progress claim 1 - 30% complete, less 10% retention', qty: 1, unitPrice: 270000, vatCategory: 'S', vatRate: 0.15 }],
  prepayments: [{ id: 'INV-2026-00030', uuid: '11111111-2222-3333-4444-555555555555', issueDate: '2026-11-01', issueTime: '09:00:00', vatCategory: 'S', vatRate: 0.15, taxable: 30000, vat: 4500 }],
};
