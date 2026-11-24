import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const csp = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;

describe('vercel.json security headers', () => {
  it('allows exactly the inline script in index.html (update the hash in vercel.json when that script changes)', () => {
    const html = readFileSync('index.html', 'utf8');
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const s of inline) {
      const hash = `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
      expect(csp).toContain(hash);
    }
  });
  it('loads nothing from third parties except the Supabase API', () => {
    const hosts = csp.match(/https?:\/\/[^\s;]+|wss:\/\/[^\s;]+/g);
    expect(hosts.every((h) => /\.supabase\.co$/.test(h))).toBe(true);
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/https?:\/\//);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
  });
});
