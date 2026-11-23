// DEPRECATED (Prompt 5). Journals are posted only by database functions (supabase/migrations/0004_posting.sql),
// in the same transaction as the document. Nothing imports this file any more; delete it.
export async function postAutoJournal() {
  throw new Error('postAutoJournal was removed: call the matching post_* database function instead (see CLAUDE.md → Posting).');
}
