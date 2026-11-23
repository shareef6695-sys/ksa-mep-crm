import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { HandCoins, X, Wallet, Undo2, ArrowRight } from 'lucide-react';
import { formatSAR, invoiceOpenSar } from './erpEngine';

// Multi-invoice customer receipts and customer credit (migration 0006):
//   post_receipt          one receipt, several invoices of one customer, remainder on account (2050)
//   apply_customer_credit use a customer's credit to settle an invoice
//   post_customer_refund  pay a customer's credit back from cash / bank
const METHODS = ['Bank Transfer', 'Cash', 'Cheque', 'POS / Card', 'SADAD'];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s) => String(s || '').trim().toLowerCase();
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

export function CustomerReceiptsPanel({ supabase, invoices = [], glAccounts = [], canPost = false, onRefresh, lang = 'en' }) {
  const L = (en, ar) => (lang === 'ar' ? ar : en);
  const [credits, setCredits] = useState([]);
  const [creditsError, setCreditsError] = useState('');
  const [modal, setModal] = useState(null); // 'receipt' | {type:'apply', client} | {type:'refund', client, balance}
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadCredits = useCallback(async () => {
    const { data, error } = await supabase.from('customer_credit_balances').select('*').order('client_name');
    if (error) {
      setCreditsError(/customer_credit_balances|PGRST205|does not exist/i.test(error.message) ? 'needs-0006' : error.message);
      setCredits([]);
    } else {
      setCreditsError('');
      setCredits(data || []);
    }
  }, [supabase]);
  useEffect(() => {
    loadCredits();
  }, [loadCredits, invoices]);

  const openInvoices = useMemo(
    () => invoices.filter((i) => invoiceOpenSar(i) > 0.009).sort((a, b) => String(a.issued_at).localeCompare(String(b.issued_at))),
    [invoices]
  );
  const clients = useMemo(() => Array.from(new Set(openInvoices.map((i) => i.client_name).filter(Boolean))).sort(), [openInvoices]);
  const cashAccounts = useMemo(() => {
    const list = glAccounts.filter((a) => String(a.account_code).startsWith('10') && a.account_type === 'Asset' && a.is_active !== false);
    return list.length ? list : [{ account_code: '1020', account_name_en: 'Bank - Main Current Account (SAR)' }];
  }, [glAccounts]);

  const done = (text) => {
    setMsg({ type: 'ok', text });
    setModal(null);
    loadCredits();
    onRefresh && onRefresh();
  };
  const fail = (error) => setMsg({ type: 'error', text: error.message || String(error) });

  if (creditsError === 'needs-0006') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900">
        {L('Multi-invoice receipts and customer credit need database update 0006_credit_receipts.sql.', 'الإيصالات متعددة الفواتير ورصيد العملاء تتطلب تحديث قاعدة البيانات 0006.')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {msg && (
        <div className={`rounded-2xl p-3 text-xs font-semibold flex items-start justify-between gap-3 ${msg.type === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500">{L('Open receivables', 'الذمم المفتوحة')}</div>
            <div className="text-lg font-bold">SAR {formatSAR(openInvoices.reduce((s, i) => s + invoiceOpenSar(i), 0))}</div>
            <div className="text-[11px] text-slate-400">{openInvoices.length} {L('open invoices', 'فاتورة مفتوحة')}</div>
          </div>
          {canPost && (
            <button type="button" onClick={() => setModal('receipt')} className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
              <HandCoins className="w-4 h-4" /> {L('Receive Payment', 'استلام دفعة')}
            </button>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-xs text-slate-500 flex items-center gap-1.5"><Wallet className="w-4 h-4" /> {L('Customer credit (2050)', 'أرصدة العملاء الدائنة (2050)')}</div>
          <div className="text-lg font-bold">SAR {formatSAR(credits.reduce((s, c) => s + Number(c.credit_balance_sar || 0), 0))}</div>
          <div className="text-[11px] text-slate-400">{L('Advances and refunds due', 'دفعات مقدمة ومبالغ مستحقة الرد')}</div>
        </div>
      </div>

      {credits.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="p-3">{L('Customer', 'العميل')}</th>
                <th className="p-3 text-right">{L('Credit balance', 'الرصيد الدائن')}</th>
                <th className="p-3">{L('Last movement', 'آخر حركة')}</th>
                {canPost && <th className="p-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {credits.map((c) => {
                const hasOpen = openInvoices.some((i) => norm(i.client_name) === norm(c.client_name));
                return (
                  <tr key={c.client_name}>
                    <td className="p-3 font-semibold">{c.client_name}</td>
                    <td className="p-3 text-right font-bold text-emerald-700">SAR {formatSAR(c.credit_balance_sar)}</td>
                    <td className="p-3 text-slate-500">{c.last_movement}</td>
                    {canPost && (
                      <td className="p-3 text-right whitespace-nowrap space-x-2">
                        {Number(c.credit_balance_sar) > 0 && hasOpen && (
                          <button type="button" onClick={() => setModal({ type: 'apply', client: c.client_name, balance: Number(c.credit_balance_sar) })} className="px-2.5 py-1 rounded-lg border border-slate-300 font-semibold cursor-pointer inline-flex items-center gap-1">
                            <ArrowRight className="w-3.5 h-3.5" /> {L('Apply to invoice', 'تطبيق على فاتورة')}
                          </button>
                        )}
                        {Number(c.credit_balance_sar) > 0 && (
                          <button type="button" onClick={() => setModal({ type: 'refund', client: c.client_name, balance: Number(c.credit_balance_sar) })} className="px-2.5 py-1 rounded-lg border border-rose-300 text-rose-700 font-semibold cursor-pointer inline-flex items-center gap-1">
                            <Undo2 className="w-3.5 h-3.5" /> {L('Refund', 'رد المبلغ')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'receipt' && (
        <ReceiptModal L={L} clients={clients} openInvoices={openInvoices} credits={credits} saving={saving}
          onClose={() => setModal(null)}
          onSubmit={async (form) => {
            setSaving(true);
            const { data, error } = await supabase.rpc('post_receipt', {
              p_client_name: form.client,
              p_amount: r2(form.amount),
              p_method: form.method,
              p_reference: form.reference,
              p_date: form.date,
              p_allocations: form.allocations.filter((a) => r2(a.amount) > 0).map((a) => ({ invoice_id: a.invoice_id, amount: r2(a.amount) })),
            });
            setSaving(false);
            if (error) return fail(error);
            done(`${data.receipt_number}: SAR ${formatSAR(data.amount_sar)} received from ${data.client_name}${Number(data.unapplied_sar) > 0 ? ` (SAR ${formatSAR(data.unapplied_sar)} held on account)` : ''}.`);
          }}
        />
      )}

      {modal?.type === 'apply' && (
        <ApplyCreditModal L={L} client={modal.client} balance={modal.balance} invoices={openInvoices.filter((i) => norm(i.client_name) === norm(modal.client))} saving={saving}
          onClose={() => setModal(null)}
          onSubmit={async ({ invoiceId, amount }) => {
            setSaving(true);
            const { data, error } = await supabase.rpc('apply_customer_credit', { p_invoice_id: invoiceId, p_amount: r2(amount) });
            setSaving(false);
            if (error) return fail(error);
            done(`SAR ${formatSAR(amount)} of ${modal.client}'s credit applied to ${data.invoice_number}.`);
          }}
        />
      )}

      {modal?.type === 'refund' && (
        <RefundModal L={L} client={modal.client} balance={modal.balance} cashAccounts={cashAccounts} saving={saving}
          onClose={() => setModal(null)}
          onSubmit={async (f) => {
            setSaving(true);
            const { data, error } = await supabase.rpc('post_customer_refund', {
              p_client_name: modal.client, p_amount: r2(f.amount), p_bank_account: f.account, p_method: f.method, p_reference: f.reference, p_date: f.date,
            });
            setSaving(false);
            if (error) return fail(error);
            done(`Refund ${data.source_doc_number} of SAR ${formatSAR(f.amount)} to ${modal.client} posted.`);
          }}
        />
      )}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl max-w-2xl w-full p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto text-xs">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="font-bold text-base">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls = 'w-full border border-slate-300 rounded-xl px-3 py-2 bg-white';

function ReceiptModal({ L, clients, openInvoices, credits, saving, onClose, onSubmit }) {
  const [client, setClient] = useState(clients[0] || '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Bank Transfer');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(today());
  const [alloc, setAlloc] = useState({});

  const rows = useMemo(() => openInvoices.filter((i) => norm(i.client_name) === norm(client)), [openInvoices, client]);
  const credit = Number(credits.find((c) => norm(c.client_name) === norm(client))?.credit_balance_sar || 0);

  // Allocate the amount to the oldest invoices first
  const autoAllocate = (amt, list = rows) => {
    let left = r2(amt);
    const next = {};
    list.forEach((i) => {
      const take = Math.min(left, invoiceOpenSar(i));
      next[i.id] = take > 0 ? take.toFixed(2) : '';
      left = r2(left - Math.max(0, take));
    });
    setAlloc(next);
  };

  const allocated = r2(rows.reduce((s, i) => s + r2(alloc[i.id]), 0));
  const unapplied = r2(r2(amount) - allocated);
  const over = rows.some((i) => r2(alloc[i.id]) > invoiceOpenSar(i) + 0.001);
  const invalid = !client || r2(amount) <= 0 || unapplied < -0.001 || over;

  return (
    <Modal title={L('Receive Customer Payment', 'استلام دفعة من عميل')} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) onSubmit({ client, amount, method, reference, date, allocations: rows.map((i) => ({ invoice_id: i.id, amount: alloc[i.id] })) });
        }}
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block font-semibold text-slate-700 mb-1">{L('Customer *', 'العميل *')}</span>
            <input list="receipt-clients" value={client} onChange={(e) => { setClient(e.target.value); setAlloc({}); }} className={inputCls} required />
            <datalist id="receipt-clients">{clients.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="block">
            <span className="block font-semibold text-slate-700 mb-1">{L('Amount received (SAR) *', 'المبلغ المستلم (ريال) *')}</span>
            <input type="number" step="0.01" min="0.01" required value={amount}
              onChange={(e) => { setAmount(e.target.value); autoAllocate(e.target.value); }} className={inputCls} />
          </label>
          <label className="block">
            <span className="block font-semibold text-slate-700 mb-1">{L('Method', 'طريقة الدفع')}</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          <label className="block">
            <span className="block font-semibold text-slate-700 mb-1">{L('Date', 'التاريخ')}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </label>
        </div>
        <input placeholder={L('Bank / cheque reference', 'مرجع البنك / الشيك')} value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} />
        {credit > 0 && (
          <p className="text-emerald-700 font-semibold">{L(`This customer already has SAR ${formatSAR(credit)} of credit you can apply instead.`, `لدى العميل رصيد دائن ${formatSAR(credit)} ريال يمكن تطبيقه.`)}</p>
        )}

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between bg-slate-50 px-3 py-2">
            <span className="font-semibold text-slate-600">{L('Apply to open invoices', 'التطبيق على الفواتير المفتوحة')}</span>
            <button type="button" onClick={() => autoAllocate(amount)} className="text-blue-700 font-semibold cursor-pointer">{L('Oldest first', 'الأقدم أولاً')}</button>
          </div>
          {rows.length === 0 ? (
            <p className="p-3 text-slate-500">{L('No open invoices for this customer — the whole amount will be held on account.', 'لا توجد فواتير مفتوحة — سيُسجّل المبلغ كاملاً كدفعة مقدمة.')}</p>
          ) : (
            <table className="w-full">
              <tbody className="divide-y divide-slate-100">
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td className="p-2.5"><div className="font-semibold">{i.invoice_number}</div><div className="text-[11px] text-slate-400">{String(i.issued_at || '').slice(0, 10)}</div></td>
                    <td className="p-2.5 text-right text-slate-500">{L('Open', 'مفتوح')} SAR {formatSAR(invoiceOpenSar(i))}</td>
                    <td className="p-2.5 w-36">
                      <input type="number" step="0.01" min="0" value={alloc[i.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })}
                        className={`w-full border rounded-lg px-2 py-1.5 text-right ${r2(alloc[i.id]) > invoiceOpenSar(i) + 0.001 ? 'border-rose-400' : 'border-slate-300'}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-between font-semibold">
          <span>{L('Allocated', 'المخصص')}: SAR {formatSAR(allocated)}</span>
          <span className={unapplied < -0.001 ? 'text-rose-700' : unapplied > 0 ? 'text-amber-700' : 'text-slate-600'}>
            {unapplied < -0.001 ? L('Allocations exceed the amount', 'التخصيص يتجاوز المبلغ') : `${L('On account', 'دفعة مقدمة')}: SAR ${formatSAR(Math.max(0, unapplied))}`}
          </span>
        </div>
        <button type="submit" disabled={invalid || saving} className="w-full py-2.5 rounded-xl bg-emerald-600 disabled:bg-slate-300 text-white font-semibold cursor-pointer">
          {saving ? L('Posting…', 'جارٍ الترحيل…') : L('Post Receipt', 'ترحيل الإيصال')}
        </button>
      </form>
    </Modal>
  );
}

function ApplyCreditModal({ L, client, balance, invoices, saving, onClose, onSubmit }) {
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id || '');
  const inv = invoices.find((i) => i.id === invoiceId);
  const max = Math.min(balance, inv ? invoiceOpenSar(inv) : 0);
  const [amount, setAmount] = useState(max.toFixed(2));
  return (
    <Modal title={L(`Apply ${client}'s credit`, `تطبيق رصيد ${client}`)} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ invoiceId, amount }); }}>
        <p>{L('Available credit', 'الرصيد المتاح')}: <strong>SAR {formatSAR(balance)}</strong></p>
        <select value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); const i = invoices.find((x) => x.id === e.target.value); setAmount(Math.min(balance, i ? invoiceOpenSar(i) : 0).toFixed(2)); }} className={inputCls}>
          {invoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_number} — {L('open', 'مفتوح')} SAR {formatSAR(invoiceOpenSar(i))}</option>)}
        </select>
        <input type="number" step="0.01" min="0.01" max={max} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        <button type="submit" disabled={saving || !(r2(amount) > 0 && r2(amount) <= r2(max))} className="w-full py-2.5 rounded-xl bg-blue-600 disabled:bg-slate-300 text-white font-semibold cursor-pointer">
          {L('Apply credit', 'تطبيق الرصيد')}
        </button>
      </form>
    </Modal>
  );
}

function RefundModal({ L, client, balance, cashAccounts, saving, onClose, onSubmit }) {
  const [f, setF] = useState({ amount: balance.toFixed(2), account: cashAccounts.find((a) => a.account_code === '1020')?.account_code || cashAccounts[0].account_code, method: 'Bank Transfer', reference: '', date: today() });
  return (
    <Modal title={L(`Refund ${client}`, `رد مبلغ إلى ${client}`)} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit(f); }}>
        <p>{L('Available credit', 'الرصيد المتاح')}: <strong>SAR {formatSAR(balance)}</strong></p>
        <div className="grid sm:grid-cols-2 gap-3">
          <input type="number" step="0.01" min="0.01" max={balance} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={inputCls} aria-label="Amount" />
          <select value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} className={inputCls} aria-label="Pay from">
            {cashAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} - {a.account_name_en}</option>)}
          </select>
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} className={inputCls}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inputCls} />
        </div>
        <input placeholder={L('Reference', 'المرجع')} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} className={inputCls} />
        <button type="submit" disabled={saving || !(r2(f.amount) > 0 && r2(f.amount) <= r2(balance))} className="w-full py-2.5 rounded-xl bg-rose-600 disabled:bg-slate-300 text-white font-semibold cursor-pointer">
          {L('Post refund', 'ترحيل الرد')}
        </button>
      </form>
    </Modal>
  );
}
