// Spreadsheet-safe CSV cells. Excel and Google Sheets run a cell that starts with = + - @ (or a tab / CR) as a
// formula, so a customer named '=HYPERLINK(...)' could act when finance opens an export. Such text is prefixed with
// an apostrophe; plain numbers (-25, +3.5) are left alone.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

export function csvSafe(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return FORMULA_START.test(str) && !PLAIN_NUMBER.test(str) ? `'${str}` : str;
}

/** One CSV cell: formula-safe, quoted when it holds a comma, quote or line break. */
export function csvCell(value) {
  const str = csvSafe(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
