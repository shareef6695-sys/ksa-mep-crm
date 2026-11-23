// Sign-in landing page (moved from App.jsx).
import { AlertTriangle, ArrowRight, Building2, Eye, EyeOff, Lock, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useUxPrefs } from '../ui/FioriShell';

export default function LoginLandingPage({ company, onLoginSuccess }) {
  const [uxPrefs, setUxPrefs] = useUxPrefs();
  const isAr = uxPrefs.lang === 'ar';
  const L = (en, ar) => (isAr ? ar : en);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSignIn = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) setErrorMsg(error.message || 'Invalid credentials.');
      else if (data?.user) onLoginSuccess(data.user);
    } catch {
      setErrorMsg('Unable to connect to authentication server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <div className="ux-shellbar h-12 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {company.logoUrl ? (
            <img src={company.logoUrl} alt="" className="h-7 max-w-[100px] object-contain" />
          ) : (
            <span className="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold text-sm flex items-center justify-center">{(company.nameEn || 'H')[0]}</span>
          )}
          <span className="font-bold text-sm truncate">{L('Horizon ERP', 'نظام هورايزن')}</span>
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-xl bg-slate-100 text-[11px] font-semibold">
          {[['en', 'English'], ['ar', 'العربية']].map(([code, label]) => (
            <button
              key={code}
              type="button"
              onClick={() => setUxPrefs({ lang: code })}
              className={`px-2.5 py-1 rounded-lg cursor-pointer ${uxPrefs.lang === code ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 grid lg:grid-cols-2">
        <div className="hidden lg:flex flex-col justify-between p-12 xl:p-16 bg-gradient-to-br from-blue-600 to-blue-900 text-white">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-[11px] font-semibold uppercase tracking-wide">
              <Building2 className="w-3.5 h-3.5" /> {L('Enterprise Resource Planning • KSA', 'تخطيط موارد المؤسسة • المملكة العربية السعودية')}
            </div>
            <h1 className="mt-8 text-4xl xl:text-5xl font-bold leading-tight">{isAr ? company.nameAr : company.nameEn}</h1>
            <p className="mt-2 text-lg text-blue-100 font-semibold">{isAr ? company.nameEn : company.nameAr}</p>
            <ul className="mt-10 space-y-3 text-sm text-blue-50 max-w-md">
              {[
                L('Order-to-cash: quotations, sales orders, deliveries, ZATCA e-invoices', 'من الطلب إلى التحصيل: عروض الأسعار وأوامر البيع والتسليم والفوترة الإلكترونية'),
                L('Procure-to-pay with multi-currency landed cost', 'من الشراء إلى السداد مع التكلفة الواصلة متعددة العملات'),
                L('Full accounting: GL, bank, assets, VAT return, statements', 'محاسبة متكاملة: الأستاذ العام والبنوك والأصول والإقرار الضريبي والقوائم المالية'),
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="text-xs text-blue-100 flex items-center justify-between gap-4">
            <span>© {new Date().getFullYear()} {company.nameEn}</span>
            <span>VAT {company.vatNumber} • CR {company.crNumber}</span>
          </div>
        </div>

        <div className="flex items-center justify-center p-5 sm:p-10">
          <div className="w-full max-w-sm bg-white rounded-2xl p-6 sm:p-8">
            <div className="lg:hidden mb-5">
              <div className="text-lg font-bold">{isAr ? company.nameAr : company.nameEn}</div>
              <div className="text-xs text-slate-500">{L('Enterprise Resource Planning', 'تخطيط موارد المؤسسة')}</div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
              <Lock className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">{L('Sign in', 'تسجيل الدخول')}</h2>
            <p className="text-xs text-slate-500 mt-1">{L('Use your corporate email and password.', 'استخدم بريدك الإلكتروني وكلمة المرور الخاصة بالعمل.')}</p>

            {errorMsg && (
              <div className="mt-4 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSignIn} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">{L('Work email', 'البريد الإلكتروني')}</label>
                <input
                  type="email"
                  required
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-base sm:text-sm focus:outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">{L('Password', 'كلمة المرور')}</label>
                <div className="relative" dir="ltr">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full ps-3 pe-11 py-2.5 bg-white border border-slate-300 rounded-xl text-base sm:text-sm focus:outline-none focus:border-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute end-2.5 top-2 text-slate-500 p-1 cursor-pointer"
                    aria-label={showPassword ? L('Hide password', 'إخفاء كلمة المرور') : L('Show password', 'إظهار كلمة المرور')}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <>{L('Sign in', 'دخول')} <ArrowRight className="w-4 h-4 ux-flip-rtl" /></>}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
