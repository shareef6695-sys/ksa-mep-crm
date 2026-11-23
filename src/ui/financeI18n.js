// Arabic for the finance screens (GL, statements, Finance Suite, VAT return, aging) — Prompt 15.
// tr('English text') returns the Arabic when the interface language is Arabic and a translation exists, else the text.
// The language is set by App on every render (setFinanceLang), so every screen re-renders with the right one.
import { FINANCE_AR } from './financeAr';

let current = 'en';
export const setFinanceLang = (lang) => { current = lang === 'ar' ? 'ar' : 'en'; };
export const financeLang = () => current;
export const tr = (text) => (current === 'ar' && FINANCE_AR[text]) || text;
