// Team members, quick-create master data, company settings — handlers moved verbatim from App.jsx (Prompt 15). `s` is the store built so far.
import { ROLE_OPTIONS } from '../../app/constants';
import { supabase } from '../../lib/supabase';


export function useAdminActions(s) {
  const { company, fxRates, newMember, procSettings, quickCreateType, quickCust, quickItem, quickVend, refreshAllErpData, salesSettings, setMemberCreating, setMemberFeedback, setNewInq, setNewMember, setNewPO, setQuickCreateType, setSettingsSavedMsg, setShowNewMemberForm } = s;
  // User management goes through the admin-users Edge Function (service role stays on the server).
  // Returns the function's JSON on success; throws an Error with a readable message on failure.
  const callAdminUsers = async (action, payload) => {
    const { data, error } = await supabase.functions.invoke('admin-users', { body: { action, ...payload } });
    if (error) {
      let message = error.message;
      try {
        const body = await error.context?.json?.();
        if (body?.error) message = body.error;
      } catch { /* not JSON */ }
      if (/Failed to send a request|404|not found/i.test(message)) {
        message = 'The admin-users function is not deployed yet. Deploy it in Supabase (see CLAUDE.md), then try again.';
      }
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };

  // Create New Salesman / Team Member (login + team_profiles, created server-side)
  const handleCreateTeamMember = async (e) => {
    e.preventDefault();
    setMemberCreating(true);
    setMemberFeedback('');
    try {
      const roleMeta = ROLE_OPTIONS.find((r) => r.key === newMember.role_key) || ROLE_OPTIONS[0];
      const created = await callAdminUsers('create', {
        email: newMember.email.trim(),
        password: newMember.password,
        full_name: newMember.full_name.trim(),
        phone: newMember.phone,
        role_key: roleMeta.key,
        division: newMember.division,
        is_salesman: newMember.is_salesman,
        commission_pct: newMember.is_salesman ? parseFloat(newMember.commission_pct) || 0 : 0,
      });

      // Auto-select if triggered from inline "+ Create Salesman" dropdown
      if (quickCreateType === 'salesman' && created?.user_id) {
        setNewInq((prev) => ({ ...prev, salesmanId: created.user_id }));
        setQuickCreateType(null);
      }

      setMemberFeedback(`Created ${newMember.full_name} (${roleMeta.label}) — ready to sign in immediately.`);
      setShowNewMemberForm(false);
      setNewMember({
        full_name: '', email: '', password: '', phone: '',
        role_key: 'sales_mep', division: 'MEP', is_salesman: true, commission_pct: 10,
      });
      refreshAllErpData();
    } catch (err) {
      setMemberFeedback(`Error: ${err.message}`);
    } finally {
      setMemberCreating(false);
    }
  };

  const runMemberAction = async (action, payload, okText) => {
    setMemberFeedback('');
    try {
      await callAdminUsers(action, payload);
      setMemberFeedback(okText);
    } catch (err) {
      setMemberFeedback(`Error: ${err.message}`);
    }
    refreshAllErpData();
  };

  const handleChangeMemberRole = (member, roleKey) => {
    const meta = ROLE_OPTIONS.find((r) => r.key === roleKey);
    if (!meta || roleKey === member.role_key) return;
    if (!window.confirm(`Change ${member.full_name}'s role to ${meta.label}?`)) return;
    runMemberAction('set_role', { user_id: member.id, role_key: roleKey }, `${member.full_name} is now ${meta.label}.`);
  };

  const handleToggleMemberActive = (member) => {
    const nextActive = member.active === false;
    const verb = nextActive ? 'Reactivate' : 'Deactivate';
    if (!window.confirm(`${verb} ${member.full_name}? ${nextActive ? 'They will be able to sign in again.' : 'They will be signed out and blocked from signing in.'}`)) return;
    runMemberAction('set_status', { user_id: member.id, active: nextActive }, `${member.full_name} ${nextActive ? 'reactivated' : 'deactivated'}.`);
  };

  const handleResetMemberPassword = (member) => {
    const pw = window.prompt(`New temporary password for ${member.full_name} (at least 8 characters):`);
    if (pw === null) return;
    if (pw.length < 8) {
      setMemberFeedback('Error: Password must be at least 8 characters.');
      return;
    }
    runMemberAction('reset_password', { user_id: member.id, password: pw }, `Password reset for ${member.full_name}. Share it with them securely.`);
  };

  // Inline Quick-Create Handlers from any "+ Create New" Field Dropdown
  const handleQuickCreateCustomer = async (e) => {
    e.preventDefault();
    const id = `cust-${Date.now()}`;
    const { data: code } = await supabase.rpc('next_doc_number', { p_doc_type: 'CUSTOMER' });
    await supabase.from('customers').insert({
      id,
      customer_code: code,
      ...quickCust,
      credit_limit_sar: 50000,
      payment_terms: 'Net 30',
    });
    await refreshAllErpData();
    setNewInq((prev) => ({
      ...prev,
      customerId: id,
      clientName: quickCust.name_en,
      clientVat: quickCust.vat_number,
      contactPerson: quickCust.contact_person,
      phone: quickCust.phone,
      email: quickCust.email,
    }));
    setQuickCreateType(null);
  };

  const handleQuickCreateVendor = async (e) => {
    e.preventDefault();
    const id = `vend-${Date.now()}`;
    const { data: code } = await supabase.rpc('next_doc_number', { p_doc_type: 'VENDOR' });
    await supabase.from('vendors').insert({
      id,
      vendor_code: code,
      ...quickVend,
      payment_terms: 'Net 30',
    });
    await refreshAllErpData();
    setNewPO((prev) => ({
      ...prev,
      vendorId: id,
      supplierName: quickVend.name_en,
      supplierVat: quickVend.vat_number,
      currency: quickVend.default_currency,
      fxRate: fxRates[quickVend.default_currency] || 1,
    }));
    setQuickCreateType(null);
  };

  const handleQuickCreateItem = async (e) => {
    e.preventDefault();
    const id = `item-${Date.now()}`;
    const qDocKey = quickItem.item_type === 'Service' ? 'ITEM_SERVICE' : 'ITEM_GOODS'; const { data: item_code } = await supabase.rpc('next_doc_number', { p_doc_type: qDocKey });
    await supabase.from('items').insert({
      id,
      item_code,
      ...quickItem,
      sales_price_sar: parseFloat(quickItem.sales_price_sar) || 0,
      purchase_price: parseFloat(quickItem.purchase_price) || 0,
    });
    await refreshAllErpData();
    setNewInq((prev) => ({
      ...prev,
      itemId: id,
      firstItemDesc: quickItem.name_ar ? `${quickItem.name_en} (${quickItem.name_ar})` : quickItem.name_en,
      firstItemUom: quickItem.uom,
      firstItemCost: parseFloat(quickItem.purchase_price) || 0,
      firstItemCurrency: quickItem.purchase_currency,
    }));
    setNewPO((prev) => ({
      ...prev,
      itemId: id,
      itemDesc: `${quickItem.name_en} (${quickItem.uom})`,
      unitCostFx: parseFloat(quickItem.purchase_price) || 0,
      currency: quickItem.purchase_currency,
      fxRate: fxRates[quickItem.purchase_currency] || 1,
    }));
    setQuickCreateType(null);
  };

  const handleSaveCompanySettings = async (e) => {
    e.preventDefault();
    await supabase.from('app_settings').upsert({
      key: 'company_profile',
      value: company,
      updated_at: new Date().toISOString(),
    });
    await supabase.from('app_settings').upsert({
      key: 'sales_settings',
      value: Object.fromEntries(Object.entries(salesSettings).map(([k, v]) => [k, Number(v) || 0])),
      updated_at: new Date().toISOString(),
    });
    await supabase.from('app_settings').upsert({
      key: 'procurement_settings',
      value: Object.fromEntries(Object.entries(procSettings).map(([k, v]) => [k, Number(v) || 0])),
      updated_at: new Date().toISOString(),
    });
    setSettingsSavedMsg('Company & ZATCA settings saved and synced across all users.');
    setTimeout(() => setSettingsSavedMsg(''), 4000);
  };

  const handleUpdateSalesmanRule = async (userId, isSalesman, commissionPct) => {
    const { error } = await supabase
      .from('team_profiles')
      .update({
        is_salesman: isSalesman,
        commission_pct: parseFloat(commissionPct) || 0,
      })
      .eq('id', userId);
    if (error) setMemberFeedback(`Error: ${error.message}`);
    refreshAllErpData();
  };


  return { callAdminUsers, handleChangeMemberRole, handleCreateTeamMember, handleQuickCreateCustomer, handleQuickCreateItem, handleQuickCreateVendor, handleResetMemberPassword, handleSaveCompanySettings, handleToggleMemberActive, handleUpdateSalesmanRule, runMemberAction };
}
