import { NavLink, Link } from "react-router-dom";
import { companyConfig } from "../../companyConfig.js";
import BrandMark from "./ui/BrandMark.jsx";
import Icon from "./ui/Icon.jsx";

// The console shell, adapted (spec §1): dark charcoal glass sidebar with the
// aura-tinted pill on the active item and live count badges on desktop; a
// bottom tab bar on phones. Public pages never use this.
const NAV = [
  { to: "/", label: "Quotes", icon: "list", end: true, badgeKey: "quotes" },
  { to: "/builder", label: "New quote", icon: "plus", end: true },
  { to: "/library", label: "Item library", short: "Library", icon: "book" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

export default function AppShell({ children, title, back, actions, badges = {}, hideTabs = false, band = true }) {
  return (
    <div className="min-h-screen lg:pl-[248px]">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[248px] glass-chrome text-white flex-col z-30">
        <div className="px-5 pt-6 pb-5 flex items-center gap-3">
          <BrandMark size={34} className="rounded-[10px] bg-white/95 p-0.5" />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold truncate">{companyConfig.businessName}</div>
            <div className="text-[12px] text-white/55">Quotes and invoices</div>
          </div>
        </div>
        <nav className="px-3 space-y-1" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex items-center gap-3 rounded-[12px] px-3 min-h-[44px] text-[15px] transition-colors duration-200 ${isActive ? "aura-pill text-white font-semibold" : "text-white/75 hover:bg-white/10 hover:text-white"}`}>
              <Icon name={n.icon} />
              <span className="flex-1">{n.label}</span>
              {n.badgeKey && badges[n.badgeKey] > 0 && (
                <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-white/90 text-chrome text-[12px] font-semibold tabular inline-flex items-center justify-center"
                  aria-label={`${badges[n.badgeKey]} need attention`}>{badges[n.badgeKey]}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-5 py-5 text-[12px] text-white/40">Powered by DropStack</div>
      </aside>

      {/* Header band: the one place the aura washes the app */}
      <header className={`sticky top-0 z-20 ${band ? "aura-wash" : ""} glass-light border-b border-hairline`}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-[56px] flex items-center gap-2">
          {back ? (
            <Link to={back.to} className="-ml-2 inline-flex items-center gap-0.5 min-h-[44px] pr-2 text-action text-[15px]">
              <Icon name="chevronLeft" /> {back.label}
            </Link>
          ) : (
            <span className="lg:hidden flex items-center gap-2 min-w-0">
              <BrandMark size={28} className="rounded-[8px]" />
            </span>
          )}
          <h1 className="flex-1 min-w-0 truncate text-[17px] font-semibold">{title}</h1>
          {actions}
        </div>
      </header>

      <main className={`max-w-3xl mx-auto px-4 sm:px-6 pt-5 ${hideTabs ? "pb-40" : "pb-32 lg:pb-12"}`}>{children}</main>

      {/* Phone tab bar */}
      {!hideTabs && (
        <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-30 glass-white border-t border-hairline pb-[env(safe-area-inset-bottom)]">
          <div className="grid grid-cols-4">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => `relative flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-medium ${isActive ? "text-brand" : "text-ink-3"}`}>
                <span className="relative">
                  <Icon name={n.icon} size={24} />
                  {n.badgeKey && badges[n.badgeKey] > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-white text-[11px] font-semibold tabular inline-flex items-center justify-center">{badges[n.badgeKey]}</span>
                  )}
                </span>
                {n.short ?? n.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
