import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "lucide-react";
import { query, run } from "../db";
import type { Session } from "../types";
import { useSettings } from "../SettingsContext";
import { formatVolume } from "../units";
import { summarizeBodyParts } from "../muscles";
import FitImportPanel from "../components/FitImportPanel";

export default function HistoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { unit } = useSettings();
  const [sessions, setSessions] = useState<(Session & { bodyParts: string[] })[]>([]);
  const [showImport, setShowImport] = useState(false);

  const load = () => {
    query<Session>(
      `SELECT s.*,
        (SELECT COUNT(*) FROM set_logs sl WHERE sl.session_id = s.id) AS set_count,
        (SELECT COALESCE(SUM(COALESCE(sl.load_kg, sl.weight_kg) * sl.reps),0) FROM set_logs sl
          WHERE sl.session_id = s.id AND sl.is_warmup = 0) AS total_volume
      FROM sessions s
      WHERE s.finished_at IS NOT NULL
      ORDER BY s.started_at DESC`,
    ).then(async (sessionRows) => {
      const muscleRows = await query<{
        session_id: number;
        primary_muscles: string;
        secondary_muscles: string;
      }>(
        `SELECT sl.session_id, e.primary_muscles, e.secondary_muscles
         FROM set_logs sl
         JOIN exercises e ON e.id = sl.exercise_id
         GROUP BY sl.session_id, sl.exercise_id
         ORDER BY sl.session_id, sl.exercise_id`,
      );
      setSessions(
        sessionRows.map((s) => ({
          ...s,
          bodyParts: summarizeBodyParts(
            muscleRows.filter((m) => m.session_id === s.id),
          ),
        })),
      );
    });
  };

  useEffect(load, []);

  const remove = async (s: Session) => {
    if (!confirm(t("history.deleteConfirm"))) return;
    await run("DELETE FROM sessions WHERE id = $1", [s.id]);
    load();
  };

  return (
    <div className="bg-[#F9F8F6] px-5 py-8 text-[#1C1C1C] lg:px-10 lg:py-12">
      <div className="flex items-baseline justify-between">
        <h1 className="ed-serif text-3xl lg:text-4xl">{t("history.title")}</h1>
        <div className="flex items-baseline gap-6">
          <button
            onClick={() => setShowImport((v) => !v)}
            className="ed-btn-quiet"
          >
            {showImport ? t("fitimport.hide") : t("fitimport.show")}
          </button>
          <span className="ed-label">{sessions.length} records</span>
        </div>
      </div>
      <div className="mt-3 h-px w-full bg-[#1C1C1C]/10" />

      {showImport && (
        <FitImportPanel onImported={load} />
      )}

      {sessions.length === 0 && (
        <p className="mt-16 max-w-md font-sans text-sm leading-relaxed text-[#1C1C1C]/60">
          {t("history.empty")}
        </p>
      )}

      <div className="mt-10">
        {sessions.map((s, i) => (
          <div
            key={s.id}
            onClick={() => navigate(`/history/${s.id}`)}
            className="group ed-divider flex cursor-pointer items-center gap-4 py-6 sm:gap-8"
          >
            <span className="w-10 shrink-0 font-mono text-xs text-[#1C1C1C]/40">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="ed-serif text-xl transition-all duration-500 group-hover:italic">
                {s.name}
              </h2>
              <div className="mt-0.5 text-xs tracking-wide text-[#1C1C1C]/60">
                {s.bodyParts.length > 0 && (
                  <>
                    {s.bodyParts.map((bp) => t(`bodyPart.${bp}`)).join(" · ")}
                    {" · "}
                  </>
                )}
                {s.started_at.slice(0, 16).replace("T", " ")}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-4 sm:gap-8">
              <span className="ed-label">{t("history.sets", { n: s.set_count ?? 0 })}</span>
              <span className="font-mono text-sm text-[#1C1C1C]">
                {formatVolume(s.total_volume ?? 0, unit)}
                {unit}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  remove(s);
                }}
                className="ed-link ed-btn-quiet text-[#1C1C1C]/40 hover:text-[#1C1C1C] max-sm:hidden"
                aria-label={t("common.delete")}
              >
                {t("common.delete")}
              </button>
              <ArrowUpRight
                className="h-4 w-4 shrink-0 text-[#1C1C1C]/40 transition-transform duration-500 group-hover:translate-x-1 group-hover:-translate-y-1"
                strokeWidth={1.5}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
