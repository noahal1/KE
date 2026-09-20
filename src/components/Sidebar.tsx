import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { query } from "../db";
import type { Session } from "../types";
import { useSettings } from "../SettingsContext";

const items = [
  { to: "/", key: "nav.plans" },
  { to: "/workout", key: "nav.workout" },
  { to: "/history", key: "nav.history" },
  { to: "/stats", key: "nav.stats" },
  { to: "/calendar", key: "nav.calendar" },
  { to: "/settings", key: "nav.settings" },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const { unit } = useSettings();
  const navigate = useNavigate();
  const [activeSession, setActiveSession] = useState<Session | null>(null);

  // Poll for an unfinished session so the indicator stays fresh across pages.
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      query<Session>(
        "SELECT * FROM sessions WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1",
      )
        .then((rows) => {
          if (!cancelled) setActiveSession(rows[0] ?? null);
        })
        .catch(() => undefined);
    };
    check();
    const h = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(h);
    };
  }, []);

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r border-[#1C1C1C]/10 bg-[#F9F8F6]">
      <div className="px-8 pb-10 pt-9">
        <span className="ed-serif text-lg tracking-[0.3em] uppercase">KE</span>
        <div className="mt-2 text-[0.65rem] tracking-[0.2em] uppercase text-[#1C1C1C]/40">
          Training Journal
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-8">
        <ul>
          {items.map(({ to, key }, i) => (
            <li key={to} className="border-b border-[#1C1C1C]/10 first:border-t">
              <NavLink
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `group flex items-baseline gap-3 py-3.5 transition-colors duration-300 ${
                    isActive ? "text-[#1C1C1C]" : "text-[#1C1C1C]/60 hover:text-[#1C1C1C]"
                  }`
                }
              >
                <span className="w-5 font-mono text-[0.6rem] text-[#1C1C1C]/40">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-xs tracking-[0.2em] uppercase">{t(key)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="px-8 pb-9">
        {activeSession && (
          <button
            onClick={() => navigate(`/workout/session/${activeSession.id}`)}
            className="group mb-6 flex w-full items-center justify-between border border-[#1C1C1C] px-4 py-3 text-left"
          >
            <span className="min-w-0">
              <span className="block text-[0.6rem] tracking-[0.2em] uppercase text-[#1C1C1C]/50">
                {t("workout.sessionInProgress")}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[0.65rem] text-[#1C1C1C]">
                ● {activeSession.name}
              </span>
            </span>
            <ArrowRight
              className="h-3.5 w-3.5 shrink-0 text-[#1C1C1C]/40 transition-transform duration-500 group-hover:translate-x-1 group-hover:text-[#1C1C1C]"
              strokeWidth={1.5}
            />
          </button>
        )}
        <button
          onClick={() => navigate("/workout")}
          className="group flex w-full items-center justify-between border-t border-[#1C1C1C]/10 pt-6 text-left"
        >
          <span className="text-xs tracking-[0.2em] uppercase text-[#1C1C1C]/60 transition-colors group-hover:text-[#1C1C1C]">
            {t("workout.resumeSession")}
          </span>
          <ArrowRight
            className="h-4 w-4 text-[#1C1C1C]/40 transition-transform duration-500 group-hover:translate-x-1 group-hover:text-[#1C1C1C]"
            strokeWidth={1.5}
          />
        </button>
        <div className="mt-4 text-[0.6rem] tracking-[0.2em] uppercase text-[#1C1C1C]/40">
          {unit === "kg" ? "Metric · kg" : "Imperial · lb"}
        </div>
      </div>
    </div>
  );
}
