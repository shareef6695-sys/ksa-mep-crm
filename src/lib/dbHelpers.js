// Supabase read helpers (moved from App.jsx).
import { supabase } from './supabase';

// True when PostgREST says a table/view/function doesn't exist (migration not applied yet)
export const isMissingObject = (error) =>
  !!error && (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code) || /does not exist|Could not find the (table|function)/i.test(error.message || ''));
// Read from the role-aware view (0002_roles_rls.sql); fall back to the table if the view isn't there yet
export const selectWithFallback = async (view, table, build) => {
  const res = await build(supabase.from(view));
  if (res.error && isMissingObject(res.error)) return build(supabase.from(table));
  return res;
};
