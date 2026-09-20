import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChartLine, Dumbbell, History, Library, Settings } from "lucide-react";

/** Primary bottom-tab destinations (Android-first navigation). */
const tabs = [
  { to: "/", key: "nav.plans", icon: Library, end: true },
  { to: "/workout", key: "nav.workout", icon: Dumbbell, end: false },
  { to: "/history", key: "nav.history", icon: History, end: false },
  { to: "/stats", key: "nav.stats", icon: ChartLine, end: false },
  { to: "/calendar", key: "nav.calendar", icon: CalendarDays, end: false },
];

/**
 * Mobile chrome (below lg): a slim top bar with brand + settings shortcut,
 * and a fixed bottom tab bar — thumb-reachable navigation, the Android
 * convention. The desktop Sidebar is untouched.
 */
export default function MobileTopBar() {
  const { t } = useTranslation();

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-[#1C1C1C]/10 bg-[#F9F8F6] px-5 py-3.5 lg:hidden">
        <div>
          <span className="ed-serif text-base tracking-[0.3em] uppercase">KE</span>
          <span className="ml-3 text-[0.55rem] tracking-[0.2em] uppercase text-[#1C1C1C]/40">
            Training Journal
          </span>
        </div>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `p-1.5 transition-colors ${isActive ? "text-[#1C1C1C]" : "text-[#1C1C1C]/60"}`
          }
          aria-label={t("nav.settings")}
        >
          <Settings className="h-5 w-5" strokeWidth={1.5} />
        </NavLink>
      </header>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[#1C1C1C]/10 bg-[#F9F8F6] lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label={t("nav.plans")}
      >
        <ul className="flex">
          {tabs.map(({ to, key, icon: Icon, end }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 py-2.5 transition-colors ${
                    isActive ? "text-[#1C1C1C]" : "text-[#1C1C1C]/40"
                  }`
                }
              >
                <Icon className="h-5 w-5" strokeWidth={1.5} />
                <span className="text-[0.55rem] tracking-[0.15em] uppercase">{t(key)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
