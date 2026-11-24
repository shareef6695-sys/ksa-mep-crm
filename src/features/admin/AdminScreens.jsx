// Admin screens — moved verbatim from App.jsx (Prompt 15). Data and handlers come from the store (useErp).
import NotificationsView from './NotificationsView';
import { useErp } from '../../app/ErpContext';
import { UserPlus } from 'lucide-react';
import { ROLE_OPTIONS } from '../../app/constants';
import { AuditLogView } from '../../erp/AuditLogView';
import { CompanyLogoUploader } from '../../erp/CompanyLogoUploader';
import { NumberRangesView } from '../../erp/NumberRangesView';
import { isValidCr, isValidKsaVat } from '../../erp/erpEngine';
import { can, canManageNumberRanges } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';

export default function AdminScreens() {
  const { company, handleChangeMemberRole, handleCreateTeamMember, handleEraseMember, handleResetMemberPassword, handleSaveCompanySettings,
    handleToggleMemberActive, handleUpdateSalesmanRule, isAdminUser, lang, memberCreating, memberFeedback, newMember,
    numberRanges, phase2Active, procSettings, profile, refreshAllErpData, salesSettings, selectSubModule, setCompany, setNewMember,
    setProcSettings, setSalesSettings, setShowNewMemberForm, settingsSavedMsg, showNewMemberForm, teamProfiles, view, zatcaAdvice } = useErp();
  return (
    <>
          {view === 'set_salesmen' && (
            <div className="space-y-4 max-w-3xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900">Team Members &amp; Salesmen Master</h2>
                  <p className="text-xs text-slate-500">
                    Create new Salesmen, Procurement, Finance, or Admin logins and configure their Net Profit Share (%).
                  </p>
                </div>
                <button
                  hidden={!can(profile, 'user.manage')}
                  onClick={() => setShowNewMemberForm(!showNewMemberForm)}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" /> {showNewMemberForm ? 'Close Form' : '+ Create Salesman / Team Member'}
                </button>
              </div>

              {memberFeedback && (
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-semibold">
                  {memberFeedback}
                </div>
              )}

              {showNewMemberForm && (
                <form onSubmit={handleCreateTeamMember} className="bg-white border border-blue-200 rounded-2xl p-5 shadow-sm space-y-4 text-xs">
                  <div className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">
                    Register New Salesman or Team Member (All Fields Marked *)
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Full Name *</label>
                      <input
                        type="text"
                        required
                        value={newMember.full_name}
                        onChange={(e) => setNewMember({ ...newMember, full_name: e.target.value })}
                        placeholder="e.g. Tariq Al-Harbi"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Work Email (Login ID) *</label>
                      <input
                        type="email"
                        required
                        value={newMember.email}
                        onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
                        placeholder="tariq@horizon-ksa.com"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Initial Login Password *</label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={newMember.password}
                        onChange={(e) => setNewMember({ ...newMember, password: e.target.value })}
                        placeholder="At least 8 characters"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Mobile / WhatsApp</label>
                      <input
                        type="tel"
                        value={newMember.phone}
                        onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })}
                        placeholder="+966 5X XXX XXXX"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Department / Role *</label>
                      <select
                        value={newMember.role_key}
                        onChange={(e) => {
                          const r = ROLE_OPTIONS.find((x) => x.key === e.target.value);
                          setNewMember({
                            ...newMember,
                            role_key: e.target.value,
                            is_salesman: r ? r.isSalesman : false,
                          });
                        }}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white font-semibold"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.key} value={r.key}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Assigned Division *</label>
                      <select
                        value={newMember.division}
                        onChange={(e) => setNewMember({ ...newMember, division: e.target.value })}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                      >
                        <option value="MEP">MEP Trading &amp; Contracting</option>
                        <option value="IT & ELV">IT &amp; ELV Systems</option>
                        <option value="MEP & IT">All Divisions (MEP &amp; IT)</option>
                      </select>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newMember.is_salesman}
                        onChange={(e) => setNewMember({ ...newMember, is_salesman: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span>Eligible as Salesman (Appears in Customer &amp; Inquiry Salesman dropdowns)</span>
                    </label>

                    {newMember.is_salesman && (
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-600">Net Profit Share %:</span>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          required
                          value={newMember.commission_pct}
                          onChange={(e) => setNewMember({ ...newMember, commission_pct: e.target.value })}
                          className="w-20 border border-slate-300 rounded-lg px-2.5 py-1 text-right font-bold bg-white"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setShowNewMemberForm(false)} className="px-4 py-2 rounded-xl border border-slate-300 font-semibold">
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={memberCreating}
                      className="px-5 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer"
                    >
                      {memberCreating ? 'Creating Account...' : 'Create Team Member'}
                    </button>
                  </div>
                </form>
              )}

              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                {teamProfiles.map((member) => (
                  <div key={member.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">{member.full_name}</span>
                        {member.is_salesman && (
                          <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 text-[10px] font-bold">
                            Salesman
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        {member.email} • {member.role_label}
                        {member.active === false && <span className="ml-2 px-2 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-bold">Inactive</span>}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {isAdminUser && (
                        <>
                          <select
                            value={member.role_key || ''}
                            onChange={(e) => handleChangeMemberRole(member, e.target.value)}
                            className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white"
                            aria-label={`Role for ${member.full_name}`}
                          >
                            {!ROLE_OPTIONS.some((r) => r.key === member.role_key) && <option value="">No role</option>}
                            {ROLE_OPTIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleResetMemberPassword(member)}
                            className="px-2 py-1 rounded-lg border border-slate-300 text-xs font-semibold cursor-pointer"
                          >
                            Reset password
                          </button>
                          {member.id !== profile?.id && (
                            <button
                              type="button"
                              onClick={() => handleToggleMemberActive(member)}
                              className={`px-2 py-1 rounded-lg text-xs font-semibold cursor-pointer ${member.active === false ? 'bg-emerald-600 text-white' : 'border border-rose-300 text-rose-700'}`}
                            >
                              {member.active === false ? 'Reactivate' : 'Deactivate'}
                            </button>
                          )}
                          {member.id !== profile?.id && !member.personal_data_erased_at && (
                            <button
                              type="button"
                              onClick={() => handleEraseMember(member)}
                              className="px-2 py-1 rounded-lg border border-rose-300 text-rose-700 text-xs font-semibold cursor-pointer"
                            >
                              Erase personal data
                            </button>
                          )}
                        </>
                      )}
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={Boolean(member.is_salesman)}
                          disabled={!isAdminUser}
                          onChange={(e) => handleUpdateSalesmanRule(member.id, e.target.checked, member.commission_pct)}
                        />
                        Salesman
                      </label>

                      <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg px-2 py-1">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          defaultValue={member.commission_pct || 0}
                          disabled={!isAdminUser}
                          onBlur={(e) => handleUpdateSalesmanRule(member.id, member.is_salesman, e.target.value)}
                          className="w-14 text-right font-bold text-xs focus:outline-none"
                        />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {view === 'set_audit_log' && <AuditLogView supabase={supabase} teamProfiles={teamProfiles} lang={lang} />}
          {view === 'set_num_ranges' && (canManageNumberRanges(profile) ? <NumberRangesView supabase={supabase} ranges={numberRanges} onRefresh={refreshAllErpData} /> : <div className='bg-amber-50 border border-amber-200 rounded-2xl p-6 text-xs text-amber-900 font-semibold'>Access Restricted: Only Admin / CEO or Finance roles can modify Document Number Ranges.</div>)}
          {view === 'set_company' && (
            <form onSubmit={handleSaveCompanySettings} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 max-w-2xl">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">Company &amp; ZATCA Tax Profile (Editable)</h2>
              </div>

              {settingsSavedMsg && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                  {settingsSavedMsg}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Company Legal Name (English)</label>
                  <input type="text" value={company.nameEn} onChange={(e) => setCompany({ ...company, nameEn: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base sm:text-xs" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Company Legal Name (Arabic)</label>
                  <input type="text" dir="rtl" value={company.nameAr} onChange={(e) => setCompany({ ...company, nameAr: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base sm:text-xs" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">15-Digit ZATCA VAT Number</label>
                  {!isValidKsaVat(company.vatNumber) && <p className="text-[11px] text-rose-700 mb-1">Must be 15 digits, starting and ending with 3.</p>}
                  <input type="text" maxLength={15} value={company.vatNumber} onChange={(e) => setCompany({ ...company, vatNumber: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono text-base sm:text-xs" />
              <div className="sm:col-span-2"><CompanyLogoUploader logoUrl={company.logoUrl} onChange={(val) => setCompany((prev) => ({ ...prev, logoUrl: val }))} /></div>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Commercial Registration (CR)</label>
                  {company.crNumber && !isValidCr(company.crNumber) && <p className="text-[11px] text-rose-700 mb-1">CR numbers are 10 digits.</p>}
                  <input type="text" value={company.crNumber} onChange={(e) => setCompany({ ...company, crNumber: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono text-base sm:text-xs" />
                </div>
                {[
                  ['buildingNo', 'Building No. (4 digits)'], ['street', 'Street'], ['district', 'District'],
                  ['city', 'City'], ['postalCode', 'Postal Code (5 digits)'], ['additionalNo', 'Additional No.'],
                ].map(([k, label]) => (
                  <div key={k}>
                    <label className="block font-semibold text-slate-700 mb-1">{label} *</label>
                    <input type="text" value={company[k] || ''} onChange={(e) => setCompany({ ...company, [k]: e.target.value })}
                      className={`w-full border rounded-xl px-3 py-2 text-base sm:text-xs ${company[k] || k === 'additionalNo' ? 'border-slate-300' : 'border-amber-400'}`} />
                  </div>
                ))}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Address (English)</label>
                  <input type="text" value={company.addressEn} onChange={(e) => setCompany({ ...company, addressEn: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base sm:text-xs" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Address (Arabic)</label>
                  <input type="text" dir="rtl" value={company.addressAr} onChange={(e) => setCompany({ ...company, addressAr: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base sm:text-xs" />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
                <div className="font-semibold text-slate-800">VAT-taxable revenue per year (SAR) — decides your ZATCA Phase 2 wave</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {['2022', '2023', '2024', '2025'].map((y) => (
                    <label key={y} className="block">
                      <span className="block text-slate-500 mb-0.5">{y}</span>
                      <input type="number" min="0" step="1000" value={company.taxableRevenueByYear?.[y] ?? ''}
                        onChange={(e) => setCompany({ ...company, taxableRevenueByYear: { ...(company.taxableRevenueByYear || {}), [y]: e.target.value } })}
                        className="w-full border border-slate-300 rounded-lg px-2 py-1.5" />
                    </label>
                  ))}
                </div>
                <div className="text-slate-600"><strong>{zatcaAdvice.wave}</strong> — deadline {zatcaAdvice.deadline}</div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
                <div className="font-semibold text-slate-800">Sales controls</div>
                <div className="grid grid-cols-3 gap-2">
                  {[['minMarginPct', 'Quotes below this margin % need approval'], ['approvalAboveSar', 'Quotes above this value (SAR, excl. VAT) need approval'], ['overdueBlockDays', 'Block new orders when an invoice is overdue by (days)']].map(([k, label]) => (
                    <label key={k} className="block">
                      <span className="block text-slate-500 mb-0.5">{label}</span>
                      <input type="number" min="0" step="any" value={salesSettings[k] ?? ''} onChange={(e) => setSalesSettings({ ...salesSettings, [k]: e.target.value })} className="w-full border border-slate-300 rounded-lg px-2 py-1.5" />
                    </label>
                  ))}
                </div>
                <div className="font-semibold text-slate-800 pt-1">Purchasing controls (approval limits and matching tolerances)</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[['managerApprovalAboveSar', 'Manager approves above (SAR)'], ['ceoApprovalAboveSar', 'CEO approves above (SAR)'], ['priceTolerancePct', 'Bill price tolerance %'], ['qtyTolerancePct', 'Receipt / bill qty tolerance %']].map(([k, label]) => (
                    <label key={k} className="block">
                      <span className="block text-slate-500 mb-0.5">{label}</span>
                      <input type="number" min="0" step="any" value={procSettings[k] ?? ''} onChange={(e) => setProcSettings({ ...procSettings, [k]: e.target.value })} className="w-full border border-slate-300 rounded-lg px-2 py-1.5" />
                    </label>
                  ))}
                </div>
              </div>

              <div className={`p-3 rounded-xl border text-xs ${phase2Active ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                <span className="font-semibold">ZATCA Phase 2: {phase2Active ? 'active' : 'not onboarded'}.</span>{' '}
                Onboarding, CSIDs and clearance are managed in <button type="button" onClick={() => selectSubModule('settings', 'set_zatca_phase2')} className="underline font-semibold cursor-pointer">ZATCA Phase 2 (Fatoora)</button>.
              </div>

              <button type="submit" className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer">
                Save Company Settings
              </button>
            </form>
          )}
          {view === 'set_notifications' && <NotificationsView supabase={supabase} canSend={can(profile, 'notify.send')} />}
    </>
  );
}
