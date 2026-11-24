/** Role a Supabase API key grants: 'anon', 'service_role', 'authenticated' or 'unknown'. Never sends the key anywhere. */
export function keyRole(key) {
  if (/^sb_secret_/.test(key)) return 'service_role';
  if (/^sb_publishable_/.test(key)) return 'anon';
  try {
    const part = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4))).role || 'unknown';
  } catch {
    return 'unknown';
  }
}
