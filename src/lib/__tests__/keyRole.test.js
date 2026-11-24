import { describe, expect, it } from 'vitest';
import { keyRole } from '../keyRole.js';

const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.fake-signature`;

describe('keyRole', () => {
  it('reads the role of a legacy JWT key', () => {
    expect(keyRole(jwt({ role: 'anon' }))).toBe('anon');
    expect(keyRole(jwt({ role: 'service_role' }))).toBe('service_role');
  });
  it('recognises the new key formats', () => {
    expect(keyRole('sb_publishable_abc123')).toBe('anon');
    expect(keyRole('sb_secret_abc123')).toBe('service_role');
  });
  it('does not throw on junk', () => {
    expect(keyRole('not-a-key')).toBe('unknown');
    expect(keyRole('')).toBe('unknown');
  });
});
