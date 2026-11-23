// Static checks on the migrations (Prompt 15).
// PostgreSQL 16.16 / 17.x (Nov 2026, CVE-2026-116306) refuse ALTER TABLE ... ADD COLUMN on a table whose row type is held by a
// view (our *_v views use jsonb_populate_record(null::<table>, ...)). Local Postgres may be older and not catch it, so this
// test does: every ALTER TABLE on such a table must come after a DROP VIEW of its *_v view in the same migration, and the
// view must be re-created after it.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname, '..', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

describe('migrations', () => {
  it('never alter a table while its row-type view exists', () => {
    const problems: string[] = [];
    const viewExists: Record<string, boolean> = {};
    for (const f of files) {
      const s = readFileSync(join(dir, f), 'utf8').replace(/--[^\n]*/g, '');
      const events: { at: number; kind: 'create' | 'drop' | 'alter'; table: string }[] = [];
      for (const m of s.matchAll(/create or replace view public\.(\w+)_v\b[^;]*?jsonb_populate_record\(null::public\.(\w+)/g)) {
        if (m[1] === m[2]) events.push({ at: m.index!, kind: 'create', table: m[2] });
      }
      for (const m of s.matchAll(/drop view if exists public\.(\w+)_v\b/g)) events.push({ at: m.index!, kind: 'drop', table: m[1] });
      for (const m of s.matchAll(/alter table (?:if exists )?public\.(\w+)\s+(?:add|alter|drop) column/g)) events.push({ at: m.index!, kind: 'alter', table: m[1] });
      events.sort((a, b) => a.at - b.at);
      for (const e of events) {
        if (e.kind === 'create') viewExists[e.table] = true;
        else if (e.kind === 'drop') viewExists[e.table] = false;
        else if (viewExists[e.table]) problems.push(`${f}: ALTER TABLE ${e.table} while ${e.table}_v exists`);
      }
      for (const [t, exists] of Object.entries(viewExists)) {
        if (!exists && events.some((e) => e.table === t && e.kind === 'drop')) problems.push(`${f}: drops ${t}_v without re-creating it`);
      }
    }
    expect(problems).toEqual([]);
  });
});
