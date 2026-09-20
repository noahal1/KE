import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Menu, X } from "lucide-react";

const items = [
  { to: "/", key: "nav.plans" },
  { to: "/workout", key: "nav.workout" },
  { to: "/history", key: "nav.history" },
  { to: "/stats", key: "nav.stats" },
  { to: "/calendar", key: "nav.calendar" },
  { to: "/settings", key: "nav.settings" },
];

/**
 * Fixed top bar shown only below the lg breakpoint. Toggles a full-screen
 * slide-down nav overlay. The desktop Sidebar stays untouched.
 */
export default function MobileTopBar() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the overlay whenever the route changes
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Lock body scroll while the overlay is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-[#1C1C1C]/10 bg-[#F9F8F6] px-5 py-3.5 lg:hidden">
      <div>
        <span className="ed-serif text-base tracking-[0.3em] uppercase">KE</span>
        <span className="ml-3 text-[0.55rem] tracking-[0.2em] uppercase text-[#1C1C1C]/40">
          Training Journal
        </span>
      </div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? t("common.close") : "Menu"}
        className="p-1.5 text-[#1C1C1C]/70 transition-colors hover:text-[#1C1C1C]"
      >
        {open ? (
          <X className="h-5 w-5" strokeWidth={1.5} />
        ) : (
          <Menu className="h-5 w-5" strokeWidth={1.5} />
        )}
      </button>

      {open && (
        <nav className="fixed inset-x-0 top-[52px] bottom-0 z-40 overflow-y-auto border-t border-[#1C1C1C]/10 bg-[#F9F8F6] px-8 py-8">
          <ul>
            {items.map(({ to, key }, i) => (
              <li key={to} className="border-b border-[#1C1C1C]/10 first:border-t">
                <NavLink
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    `flex items-baseline gap-4 py-4 ${
                      isActive ? "text-[#1C1C1C]" : "text-[#1C1C1C]/60"
                    }`
                  }
                >
                  <span className="w-6 font-mono text-[0.6rem] text-[#1C1C1C]/40">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm tracking-[0.2em] uppercase">{t(key)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
