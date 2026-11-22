import React, { useEffect, useRef, useState } from 'react';
import {
  Menu,
  Search,
  Bell,
  Home,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  LogOut,
  Sun,
  Moon,
  Monitor,
  Rows3,
  Rows4,
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  AlertTriangle,
  Info,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { t, SUPPORTED_LANGS } from './i18n';

/* ------------------------------------------------------------------ */
/* Preferences: theme / density / language, persisted per browser      */
/* ------------------------------------------------------------------ */
const PREFS_KEY = 'ux_prefs';
const DEFAULT_PREFS = { theme: 'light', density: 'cozy', lang: 'en' };

const readPrefs = () => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
};

export function useUxPrefs() {
  const [prefs, setPrefsState] = useState(readPrefs);

  useEffect(() => {
    const html = document.documentElement;
    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const apply = () => {
      const dark = prefs.theme === 'dark' || (prefs.theme === 'auto' && media?.matches);
      html.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    apply();
    html.setAttribute('data-density', prefs.density === 'compact' ? 'compact' : 'cozy');
    html.setAttribute('lang', prefs.lang === 'ar' ? 'ar' : 'en');
    html.setAttribute('dir', prefs.lang === 'ar' ? 'rtl' : 'ltr');
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable: preferences simply won't persist */
    }
    if (prefs.theme === 'auto' && media) {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    return undefined;
  }, [prefs]);

  const setPrefs = (patch) => setPrefsState((p) => ({ ...p, ...patch }));
  return [prefs, setPrefs];
}

/* Close a popover when clicking outside it or pressing Escape */
function useDismiss(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return ref;
}

const initials = (name = '') =>
  name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || 'U';

/* ------------------------------------------------------------------ */
/* Shell bar                                                           */
/* ------------------------------------------------------------------ */
export function ShellBar({
  lang,
  company,
  appTitle,
  isHome,
  onHome,
  onToggleNav,
  onSearch,
  notifications = [],
  profile,
  prefs,
  setPrefs,
  onSignOut,
  syncStatus,
  ytdSales,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const menuRef = useDismiss(menuOpen, () => setMenuOpen(false));
  const notifRef = useDismiss(notifOpen, () => setNotifOpen(false));
  const live = syncStatus === 'live';

  return (
    <header className="ux-shellbar sticky top-0 z-30 h-12 px-2 sm:px-3 flex items-center gap-1.5 sm:gap-3 no-print">
      <button
        type="button"
        onClick={onToggleNav}
        className="p-2 rounded-xl hover:bg-slate-100 cursor-pointer"
        aria-label={t(lang, 'shell.expand')}
      >
        <Menu className="w-5 h-5" />
      </button>

      <button type="button" onClick={onHome} className="flex items-center gap-2 min-w-0 cursor-pointer rounded-xl px-1 py-1 hover:bg-slate-100">
        {company?.logoUrl ? (
          <img src={company.logoUrl} alt="" className="h-7 max-w-[88px] object-contain" />
        ) : (
          <span className="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold text-sm flex items-center justify-center shrink-0">
            {(company?.nameEn || 'H')[0]}
          </span>
        )}
        <span className="hidden md:block font-bold text-sm truncate">{t(lang, 'shell.product')}</span>
      </button>

      {!isHome && appTitle && (
        <div className="hidden sm:flex items-center gap-1.5 min-w-0 text-sm">
          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 ux-flip-rtl" />
          <span className="font-semibold truncate max-w-[220px]">{appTitle}</span>
        </div>
      )}

      <div className="flex-1 flex justify-center min-w-0">
        <button
          type="button"
          onClick={onSearch}
          className="w-full max-w-md h-8 px-3 rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-500 text-xs flex items-center gap-2 cursor-pointer"
        >
          <Search className="w-4 h-4 text-blue-600 shrink-0" />
          <span className="truncate text-start flex-1">{t(lang, 'shell.search')}</span>
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-white border border-slate-300 rounded">Ctrl K</kbd>
        </button>
      </div>

      {typeof ytdSales === 'string' && (
        <div className="hidden lg:block text-end shrink-0 leading-tight">
          <div className="text-[10px] uppercase font-semibold text-slate-500">{t(lang, 'shell.ytdSales')}</div>
          <div className="text-xs font-bold text-blue-700">SAR {ytdSales}</div>
        </div>
      )}

      <span
        className={`hidden sm:inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
          live ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
        }`}
        title={live ? t(lang, 'shell.live') : t(lang, 'shell.syncing')}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
        {live ? t(lang, 'shell.live') : t(lang, 'shell.syncing')}
      </span>

      {/* Notifications */}
      <div className="relative" ref={notifRef}>
        <button
          type="button"
          onClick={() => setNotifOpen((o) => !o)}
          className="relative p-2 rounded-xl hover:bg-slate-100 cursor-pointer"
          aria-label={t(lang, 'shell.notifications')}
        >
          <Bell className="w-5 h-5" />
          {notifications.length > 0 && (
            <span className="absolute top-1 end-1 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
              {notifications.length}
            </span>
          )}
        </button>
        {notifOpen && (
          <div className="ux-popover absolute end-0 mt-2 w-80 max-w-[92vw] p-2 z-40">
            <div className="px-2 py-1.5 text-xs font-bold text-slate-900">{t(lang, 'shell.notifications')}</div>
            {notifications.length === 0 ? (
              <div className="px-2 py-4 text-xs text-slate-500 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> {t(lang, 'shell.noNotifications')}
              </div>
            ) : (
              <ul className="space-y-1">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setNotifOpen(false);
                        n.onClick?.();
                      }}
                      className="w-full text-start px-2 py-2 rounded-xl hover:bg-slate-100 flex items-start gap-2 text-xs cursor-pointer"
                    >
                      {n.tone === 'negative' ? (
                        <AlertTriangle className="w-4 h-4 shrink-0 ux-kpi-negative" />
                      ) : n.tone === 'critical' ? (
                        <AlertTriangle className="w-4 h-4 shrink-0 ux-kpi-critical" />
                      ) : (
                        <Info className="w-4 h-4 shrink-0 ux-kpi-info" />
                      )}
                      <span className="text-slate-800">{n.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* User menu */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="w-8 h-8 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center cursor-pointer"
          aria-label={t(lang, 'shell.settings')}
        >
          {initials(profile?.full_name || profile?.email)}
        </button>
        {menuOpen && (
          <div className="ux-popover absolute end-0 mt-2 w-72 max-w-[92vw] p-3 z-40 space-y-3">
            <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-200">
              <span className="w-10 h-10 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
                {initials(profile?.full_name || profile?.email)}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">{profile?.full_name}</div>
                <div className="text-[11px] text-slate-500 truncate">{profile?.role_label || profile?.email}</div>
              </div>
            </div>

            <PrefGroup label={t(lang, 'shell.appearance')}>
              {[
                ['light', Sun],
                ['dark', Moon],
                ['auto', Monitor],
              ].map(([v, Icon]) => (
                <PrefOption key={v} active={prefs.theme === v} onClick={() => setPrefs({ theme: v })}>
                  <Icon className="w-3.5 h-3.5" /> {t(lang, `shell.theme.${v}`)}
                </PrefOption>
              ))}
            </PrefGroup>

            <PrefGroup label={t(lang, 'shell.density')}>
              {[
                ['cozy', Rows3],
                ['compact', Rows4],
              ].map(([v, Icon]) => (
                <PrefOption key={v} active={prefs.density === v} onClick={() => setPrefs({ density: v })}>
                  <Icon className="w-3.5 h-3.5" /> {t(lang, `shell.density.${v}`)}
                </PrefOption>
              ))}
            </PrefGroup>

            <PrefGroup label={t(lang, 'shell.language')} icon={Languages}>
              {SUPPORTED_LANGS.map((l) => (
                <PrefOption key={l.code} active={prefs.lang === l.code} onClick={() => setPrefs({ lang: l.code })}>
                  {l.label}
                </PrefOption>
              ))}
            </PrefGroup>

            <button
              type="button"
              onClick={onSignOut}
              className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 hover:bg-rose-50 text-rose-700 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4 ux-flip-rtl" /> {t(lang, 'shell.signOut')}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function PrefGroup({ label, icon: Icon, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide font-bold text-slate-500 mb-1.5 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </div>
      <div className="flex gap-1 p-0.5 rounded-xl bg-slate-100">{children}</div>
    </div>
  );
}

function PrefOption({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer ${
        active ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Side navigation                                                     */
/* ------------------------------------------------------------------ */
export function SideNavigation({ lang, navTree, activeId, expanded, onToggleGroup, onSelect, collapsed, onToggleCollapsed, onHome, isMobile, onClose }) {
  const showText = !collapsed || isMobile;
  return (
    <nav className="ux-sidenav h-full flex flex-col select-none" aria-label="Main">
      <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-slate-200">
        <button
          type="button"
          onClick={onHome}
          aria-current={activeId === 'home' ? 'page' : undefined}
          className="ux-nav-item flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
          title={t(lang, 'shell.home')}
        >
          <Home className="w-4 h-4 shrink-0" />
          {showText && <span className="truncate">{t(lang, 'shell.home')}</span>}
        </button>
        {isMobile ? (
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        ) : (
          showText && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
              title={t(lang, 'shell.collapse')}
            >
              <PanelLeftClose className="w-4 h-4 ux-flip-rtl" />
            </button>
          )
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {navTree.map((mod) => {
          const ModIcon = mod.icon;
          const isOpen = Boolean(expanded[mod.id]);
          const hasActive = mod.subModules.some((s) => s.id === activeId);
          return (
            <div key={mod.id}>
              <button
                type="button"
                onClick={() => onToggleGroup(mod.id)}
                className={`ux-nav-item w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                  hasActive && !isOpen ? 'text-blue-700' : ''
                }`}
                title={t(lang, `nav.${mod.id}`, mod.label)}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <ModIcon className={`w-4 h-4 shrink-0 ${hasActive ? 'text-blue-600' : 'text-slate-500'}`} />
                  {showText && <span className="truncate">{t(lang, `nav.${mod.id}`, mod.label)}</span>}
                </span>
                {showText &&
                  (isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 ux-flip-rtl" />
                  ))}
              </button>

              {isOpen && showText && (
                <div className="mt-0.5 space-y-0.5">
                  {mod.subModules.map((sub) => {
                    const SubIcon = sub.icon;
                    const active = activeId === sub.id;
                    return (
                      <button
                        type="button"
                        key={sub.id}
                        onClick={() => onSelect(mod.id, sub.id)}
                        aria-current={active ? 'page' : undefined}
                        className="ux-nav-item w-full flex items-center justify-between gap-2 ps-8 pe-2.5 py-1.5 rounded-xl text-[11.5px] font-medium cursor-pointer"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <SubIcon className="w-3.5 h-3.5 shrink-0 opacity-80" />
                          <span className="truncate">{t(lang, `nav.${sub.id}`, sub.label)}</span>
                        </span>
                        {typeof sub.count === 'number' && sub.count > 0 && (
                          <span className={`px-1.5 rounded-full text-[10px] font-bold ${active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                            {sub.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!isMobile && collapsed && (
        <div className="p-2 border-t border-slate-200">
          <button type="button" onClick={onToggleCollapsed} className="w-full p-2 rounded-xl hover:bg-slate-100 text-slate-500 flex justify-center cursor-pointer" title={t(lang, 'shell.expand')}>
            <PanelLeftOpen className="w-4 h-4 ux-flip-rtl" />
          </button>
        </div>
      )}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Launchpad                                                           */
/* ------------------------------------------------------------------ */
const toneClass = { positive: 'ux-kpi-positive', critical: 'ux-kpi-critical', negative: 'ux-kpi-negative', info: 'ux-kpi-info', neutral: 'text-slate-900' };

export function Launchpad({ lang, profile, groups = [], insights = [] }) {
  const firstName = (profile?.full_name || '').split(' ')[0];
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            {t(lang, 'home.greeting')}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">{t(lang, 'home.subtitle')}</p>
        </div>
        <div className="text-xs text-slate-500">{new Date().toLocaleDateString(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
      </div>

      {insights.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-slate-900 mb-2.5">{t(lang, 'home.insights')}</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {insights.map((k) => (
              <button
                type="button"
                key={k.id}
                onClick={k.onClick}
                className="ux-tile text-start p-4 cursor-pointer"
              >
                <div className="text-[11px] font-semibold text-slate-500 truncate">{k.label}</div>
                <div className={`mt-1.5 text-xl sm:text-2xl font-bold tabular-nums ${toneClass[k.tone] || toneClass.neutral}`}>{k.value}</div>
                {k.footer && (
                  <div className="mt-1 text-[11px] text-slate-500 flex items-center gap-1 truncate">
                    {k.trend === 'up' && <TrendingUp className="w-3.5 h-3.5 ux-kpi-positive" />}
                    {k.trend === 'down' && <TrendingDown className="w-3.5 h-3.5 ux-kpi-negative" />}
                    {k.footer}
                  </div>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.id}>
          <h2 className="text-sm font-bold text-slate-900 mb-2.5 flex items-center gap-2">
            {g.icon && <g.icon className="w-4 h-4 text-blue-600" />}
            {g.title}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {g.tiles.map((tile) => (
              <LaunchpadTile key={tile.id} tile={tile} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function LaunchpadTile({ tile }) {
  const Icon = tile.icon;
  return (
    <button type="button" onClick={tile.onClick} className="ux-tile text-start p-3.5 h-36 flex flex-col justify-between cursor-pointer min-w-0">
      <div className="min-w-0">
        <div className="text-[13px] font-bold text-slate-900 leading-snug line-clamp-2">{tile.title}</div>
        {tile.subtitle && <div className="text-[11px] text-slate-500 mt-0.5 truncate">{tile.subtitle}</div>}
      </div>
      <div className="flex items-end justify-between gap-2 min-w-0">
        {Icon && <Icon className="w-6 h-6 text-blue-600 shrink-0 opacity-90" />}
        {tile.value !== undefined && tile.value !== null && tile.value !== '' && (
          <div className="text-end min-w-0">
            <div className={`text-2xl font-bold tabular-nums leading-none truncate ${toneClass[tile.tone] || toneClass.info}`}>{tile.value}</div>
            {tile.unit && <div className="text-[10px] text-slate-500 mt-1 truncate">{tile.unit}</div>}
          </div>
        )}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Page header (breadcrumb + title) & message strip                    */
/* ------------------------------------------------------------------ */
export function PageHeader({ lang, crumbs = [], title, subtitle, icon: Icon, onBack }) {
  return (
    <div className="ux-page-header -mx-4 sm:-mx-6 -mt-5 mb-5 px-4 sm:px-6 py-3 no-print">
      <div className="flex items-center gap-1 text-[11px] text-slate-500 flex-wrap">
        {crumbs.map((c, i) => (
          <React.Fragment key={`${c.label}-${i}`}>
            {i > 0 && <ChevronRight className="w-3 h-3 ux-flip-rtl" />}
            {c.onClick ? (
              <button type="button" onClick={c.onClick} className="hover:text-blue-700 hover:underline cursor-pointer">
                {c.label}
              </button>
            ) : (
              <span>{c.label}</span>
            )}
          </React.Fragment>
        ))}
      </div>
      <div className="flex items-center gap-2.5 mt-1">
        {onBack && (
          <button type="button" onClick={onBack} className="p-1 rounded-lg hover:bg-slate-100 cursor-pointer" aria-label={t(lang, 'shell.back')}>
            <ChevronLeft className="w-5 h-5 ux-flip-rtl" />
          </button>
        )}
        {Icon && <Icon className="w-5 h-5 text-blue-600 shrink-0" />}
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">{title}</h1>
          {subtitle && <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

const stripStyles = {
  information: ['bg-blue-50 border-blue-200 text-blue-900', Info],
  warning: ['bg-amber-50 border-amber-200 text-amber-900', AlertTriangle],
  error: ['bg-rose-50 border-rose-200 text-rose-800', AlertTriangle],
  success: ['bg-emerald-50 border-emerald-200 text-emerald-800', CheckCircle2],
};

export function MessageStrip({ type = 'information', children, onClose }) {
  const [cls, Icon] = stripStyles[type] || stripStyles.information;
  return (
    <div className={`px-3 py-2 rounded-xl border text-xs flex items-start gap-2 no-print ${cls}`}>
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 cursor-pointer opacity-70 hover:opacity-100">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
