export async function postAutoJournal({
  supabase,
  entryDate,
  sourceModule,
  sourceDocNumber,
  description,
  lines,
  postedBy = 'System Auto-GL',
}) {
  const validLines = (lines || [])
    .map((l) => ({
      account_code: String(l.account_code),
      account_name: l.account_name,
      debit: Number((Number(l.debit) || 0).toFixed(2)),
      credit: Number((Number(l.credit) || 0).toFixed(2)),
      memo: l.memo || '',
    }))
    .filter((l) => l.debit > 0 || l.credit > 0);

  if (validLines.length < 2) return null;

  const totalDr = Number(validLines.reduce((s, l) => s + l.debit, 0).toFixed(2));
  const totalCr = Number(validLines.reduce((s, l) => s + l.credit, 0).toFixed(2));

  // Enforce strict double-entry balance (protect against rounding drift by adjusting last line if <= 0.02 SAR)
  const drift = Number((totalDr - totalCr).toFixed(2));
  if (Math.abs(drift) > 0 && Math.abs(drift) <= 0.05) {
    const last = validLines[validLines.length - 1];
    if (last.credit > 0) last.credit = Number((last.credit + drift).toFixed(2));
    else if (last.debit > 0) last.debit = Number((last.debit - drift).toFixed(2));
  }

  const finalDr = Number(validLines.reduce((s, l) => s + l.debit, 0).toFixed(2));
  const finalCr = Number(validLines.reduce((s, l) => s + l.credit, 0).toFixed(2));
  if (finalDr <= 0 || finalDr !== finalCr) return null;

  const { data: jvNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'JOURNAL' });

  const { data } = await supabase
    .from('gl_journal_entries')
    .insert({
      id: `jv-auto-${Date.now()}-${Math.floor(Math.random() * 999)}`,
      voucher_number: jvNum,
      entry_date: entryDate || new Date().toISOString().slice(0, 10),
      reference: sourceDocNumber || '',
      description,
      lines: validLines,
      total_debit_sar: finalDr,
      total_credit_sar: finalCr,
      source_module: sourceModule,
      source_doc_number: sourceDocNumber || '',
      status: 'posted',
      posted_by: postedBy,
    })
    .select()
    .single();

  return data;
}