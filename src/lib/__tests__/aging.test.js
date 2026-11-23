import { describe, it, expect } from 'vitest';
import { getBucket, daysOld, daysPastDue } from '../aging';

const NOW = new Date('2026-11-22T12:00:00+03:00').getTime();

describe('aging', () => {
  it('buckets', () => {
    expect([0, 30, 31, 60, 61, 90, 91, 400].map(getBucket)).toEqual(['0-30', '0-30', '31-60', '31-60', '61-90', '61-90', '90+', '90+']);
  });
  it('days past due use the due date at Riyadh midnight', () => {
    expect(daysPastDue({ due_date: '2026-11-22' }, NOW)).toBe(0);
    expect(daysPastDue({ due_date: '2026-10-23' }, NOW)).toBe(30);
    expect(daysPastDue({ due_date: '2026-12-22' }, NOW)).toBe(-30);
  });
  it('without a due date: issue date + 30 days', () => {
    expect(daysPastDue({ issued_at: '2026-09-23T12:00:00+03:00' }, NOW)).toBe(30);
    expect(daysPastDue({ issued_at: '2026-11-20T12:00:00+03:00' }, NOW)).toBe(-28);
  });
  it('days old never negative', () => {
    expect(daysOld('2026-12-01', NOW)).toBe(0);
    expect(daysOld(null, NOW)).toBe(0);
  });
});
