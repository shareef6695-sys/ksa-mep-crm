import { describe, expect, it, vi } from 'vitest';
import { publicError, redact, safeEqual } from '../functions/_shared/safe.ts';

describe('edge function safety helpers', () => {
  it('safeEqual compares exactly and rejects empty values', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
    expect(safeEqual(null, undefined)).toBe(false);
  });
  it('redact hides secret fields at any depth', () => {
    expect(redact({ binarySecurityToken: 'T', secret: 'S', errors: [{ password: 'p', code: 'X' }], requestID: 1 }))
      .toEqual({ binarySecurityToken: '[redacted]', secret: '[redacted]', errors: [{ password: '[redacted]', code: 'X' }], requestID: 1 });
  });
  it('publicError keeps our own messages and hides unexpected ones', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(publicError('fn', new Error('Only admins.'), true)).toBe('Only admins.');
    const msg = publicError('fn', { message: 'relation secret_table does not exist' }, false);
    expect(msg).toMatch(/^Unexpected server error \(ref [0-9a-f]{8}\)/);
    expect(msg).not.toContain('secret_table');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
