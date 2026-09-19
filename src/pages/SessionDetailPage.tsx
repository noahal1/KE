import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { query } from "../db";
import type { Session, SetLog } from "../types";
import { useSettings } from "../SettingsContext";
import { formatWeight, formatVolume } from "../units";
import { summarizeBodyParts } from "../muscles";
import MuscleTags from "../components/MuscleTags";

interface DetailRow extends SetLog {
  name_en: string;
  name_zh: string;
  equipment: string;
  primary_muscles: string;
  secondary_muscles: string;
}

export default function SessionDetailPage() {
  const { id } = useParams();
  const sessionId = Number(id);
  const { t } = useTranslation();
  const { lang, unit } = useSettings();
  const navigate = useNavigate();

  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<DetailRow[]>([]);

  useEffect(() => {
    query<Session>("SELECT * FROM sessions WHERE id = $1", [sessionId]).then((s) =>
      setSession(s[0] ?? null),
    );
    query<DetailRow>(
      `SELECT sl.*, e.name_en, e.name_zh, e.equipment, e.primary_muscles, e.secondary_muscles
       FROM set_logs sl JOIN exercises e ON e.id = sl.exercise_id
       WHERE sl.session_id = $1 ORDER BY sl.exercise_id, sl.set_number`,
      [sessionId],
    ).then(setRows);
  }, [sessionId]);

  if (!session)
    return (
      <div className="bg-[#F9F8F6] px-10 py-12 text-sm text-[#1C1C1C]/60">
        {t("common.loading")}
      </div>
    );

  const grouped = new Map<number, DetailRow[]>();
  for (const r of rows) {
    const arr = grouped.get(r.exercise_id) ?? [];
    arr.push(r);
    grouped.set(r.exercise_id, arr);
  }

  const totalVolume = rows
    .filter((r) => !r.is_warmup)
    .reduce((acc, r) => acc + (r.load_kg ?? r.weight_kg) * r.reps, 0);

  const bodyParts = summarizeBodyParts(rows);

  return (
    <div className="bg-[#F9F8F6] px-5 py-8 text-[#1C1C1C] lg:px-10 lg:py-12">
      <button onClick={() => navigate("/history")} className="ed-link ed-btn-quiet">
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        {t("history.title")}
      </button>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="ed-serif text-3xl lg:text-4xl">{session.name}</h1>
        <div className="text-xs tracking-wide text-[#1C1C1C]/60">
          {session.started_at.slice(0, 16).replace("T", " ")}
          {session.finished_at ? ` → ${session.finished_at.slice(11, 16)}` : ""}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-[#1C1C1C]/10 pb-4">
        <span className="ed-label">
          {bodyParts.length > 0 && (
            <>
              {bodyParts.map((bp) => t(`bodyPart.${bp}`)).join(" · ")}
              {" · "}
            </>
          )}
          {t("workout.volume")}: {formatVolume(totalVolume, unit)}
          {unit} · {t("history.sets", { n: rows.length })}
        </span>
      </div>

      <div className="mt-14 space-y-16">
        {[...grouped.entries()].map(([exerciseId, sets]) => (
          <section key={exerciseId}>
            <div className="border-b border-[#1C1C1C]/10 pb-4">
              <h2 className="ed-serif text-2xl transition-all duration-500 hover:italic">
                {lang === "zh" ? sets[0].name_zh : sets[0].name_en}
              </h2>
              <span className="mt-1 block text-xs tracking-wide text-[#1C1C1C]/60">
                {t(`equipment.${sets[0].equipment}`)}{" · "}
                <MuscleTags
                  primary={sets[0].primary_muscles}
                  secondary={sets[0].secondary_muscles}
                  max={2}
                />
              </span>
            </div>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left ed-label">
                  <th className="py-2 pr-4 font-normal">#</th>
                  <th className="py-2 pr-4 font-normal">{t("common.weight")} ({unit})</th>
                  <th className="py-2 pr-4 font-normal">{t("common.reps")}</th>
                  <th className="py-2 pr-4 font-normal">{t("common.rpe")}</th>
                  <th className="py-2 font-normal">PR</th>
                </tr>
              </thead>
              <tbody>
                {sets.map((s) => (
                  <tr key={s.id} className="border-t border-[#1C1C1C]/10">
                    <td className="py-2 pr-4 font-mono text-xs text-[#1C1C1C]/40">
                      {s.set_number}
                    </td>
                    <td className="py-2 pr-4 font-mono text-[#1C1C1C]">
                      {s.load_kg != null && s.load_kg > 0 ? (
                        <span title={t("body.inclBodyweight")}>
                          ≈ {formatWeight(s.load_kg, unit)}
                        </span>
                      ) : (
                        formatWeight(s.weight_kg, unit)
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono text-[#1C1C1C]">{s.reps}</td>
                    <td className="py-2 pr-4 text-[#1C1C1C]/60">{s.rpe ?? "–"}</td>
                    <td className="py-2">
                      {s.is_pr ? <span className="ed-serif text-xs italic">★</span> : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}
