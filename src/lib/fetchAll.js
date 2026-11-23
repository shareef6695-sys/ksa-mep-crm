// Supabase (PostgREST) returns at most 1,000 rows per request by default. Reading a table with one
// plain select() silently drops everything after row 1,000, so every list load goes through here.
//
// build: () => a NEW query builder each call, already filtered and ordered by a UNIQUE key
//        (e.g. .order('issued_at', { ascending: false }).order('id')) so pages never overlap.
// Returns { data, error } like supabase-js. On an error part-way through, returns the error.
export const PAGE_SIZE = 1000;
export const MAX_ROWS = 250000; // safety stop

export async function fetchAllRows(build, pageSize = PAGE_SIZE) {
  const rows = [];
  for (let from = 0; from < MAX_ROWS; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return { data: rows, error: null };
  }
  return { data: rows, error: null, truncated: true };
}
