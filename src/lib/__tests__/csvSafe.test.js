import { describe, expect, it } from 'vitest';
import { csvCell, csvSafe } from '../csvSafe.js';
import { toCsv } from '../customerImport.js';

describe('CSV formula injection', () => {
  it('neutralises text that a spreadsheet would run as a formula', () => {
    expect(csvSafe('=HYPERLINK("http://x","click")')).toBe('\'=HYPERLINK("http://x","click")');
    expect(csvSafe('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(csvSafe('-2+3')).toBe("'-2+3");
    expect(csvSafe('@cmd')).toBe("'@cmd");
    expect(csvSafe('\t=1')).toBe("'\t=1");
  });
  it('leaves ordinary values alone, numbers included', () => {
    for (const v of ['Client One', '-25', '+3.5', '1150.00', '', 'شركة']) expect(csvSafe(v)).toBe(v);
    expect(csvSafe(null)).toBe('');
  });
  it('still quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('=1,2')).toBe('"\'=1,2"');
    expect(toCsv(['name'], [['=cmd|calc']])).toBe("name\r\n'=cmd|calc");
  });
});
