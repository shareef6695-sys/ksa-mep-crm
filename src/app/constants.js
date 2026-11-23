// App-wide constants (moved from App.jsx).

export const CURRENCIES = ['SAR', 'USD', 'EUR', 'GBP', 'AED'];
export const DEFAULT_FX = { SAR: 1, USD: 3.75, EUR: 4.08, GBP: 4.78, AED: 1.021 };
export const DEFAULT_COMPANY = {
  nameEn: 'Horizon Business Solutions Est.',
  nameAr: 'مؤسسة حلول الأفق للأعمال',
  vatNumber: '300000000000003',
    logoUrl: '',
  crNumber: '4030000000',
  city: 'Jeddah',
  addressEn: 'Jeddah, Kingdom of Saudi Arabia',
  addressAr: 'جدة، المملكة العربية السعودية',
  phone: '+966 12 000 0000',
  email: 'info@horizon-ksa.com',
};
export const ROLE_OPTIONS = [
  { key: 'sales_mep', label: 'Sales Executive (MEP)', isSalesman: true },
  { key: 'sales_it', label: 'Sales Executive (IT & ELV)', isSalesman: true },
  { key: 'manager', label: 'Sales Manager', isSalesman: true },
  { key: 'ceo', label: 'CEO / General Manager', isSalesman: false },
  { key: 'procurement', label: 'Procurement & Logistics Officer', isSalesman: false },
  { key: 'finance', label: 'Finance & ZATCA Accountant', isSalesman: false },
  { key: 'admin', label: 'System Administrator', isSalesman: false },
];
