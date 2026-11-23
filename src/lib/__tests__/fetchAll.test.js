import { describe, it, expect } from 'vitest';
import { fetchAllRows } from '../fetchAll';

// Fake PostgREST builder over an in-memory table that, like Supabase, caps every response at 1,000 rows
const fakeTable = (n, failAtPage = -1) => {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  let page = 0;
  return () => ({
    range: async (from, to) => {
      if (page++ === failAtPage) return { data: null, error: { message: 'boom' } };
      return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
    },
  });
};

describe('fetchAllRows', () => {
  it('returns every row past the 1,000-row cap', async () => {
    const { data, error } = await fetchAllRows(fakeTable(5432));
    expect(error).toBeNull();
    expect(data).toHaveLength(5432);
    expect(new Set(data.map((r) => r.id)).size).toBe(5432);
  });
  it('handles exact multiples and empty tables', async () => {
    expect((await fetchAllRows(fakeTable(2000))).data).toHaveLength(2000);
    expect((await fetchAllRows(fakeTable(0))).data).toEqual([]);
  });
  it('reports an error instead of a partial list', async () => {
    const res = await fetchAllRows(fakeTable(3000, 1));
    expect(res.data).toBeNull();
    expect(res.error.message).toBe('boom');
  });
});
