import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronUp, ChevronDown, X } from "lucide-react";
import { query, execute, run } from "../db";
import type { Plan, PlanDay, PlanExercise } from "../types";
import { useSettings } from "../SettingsContext";
import ExercisePicker from "../components/ExercisePicker";
import ExerciseDetailModal from "../components/ExerciseDetailModal";
import MuscleTags from "../components/MuscleTags";
import { summarizeBodyParts } from "../muscles";
import type { Exercise } from "../types";

interface DayExRow extends PlanExercise {
  slug: string;
  name_en: string;
  name_zh: string;
  equipment: string;
  category: string;
  pattern: string;
  primary_muscles: string;
  secondary_muscles: string;
  is_custom: number;
}

export default function PlanDetailPage() {
  const { id } = useParams();
  const planId = Number(id);
  const { t } = useTranslation();
  const { lang } = useSettings();
  const navigate = useNavigate();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [days, setDays] = useState<(PlanDay & { exercises: DayExRow[] })[]>([]);
  const [pickerForDay, setPickerForDay] = useState<number | null>(null);
  const [newDayName, setNewDayName] = useState("");
  const [addingDay, setAddingDay] = useState(false);
  const [detailEx, setDetailEx] = useState<Exercise | null>(null);

  const load = useCallback(async () => {
    const p = await query<Plan>("SELECT * FROM plans WHERE id = $1", [planId]);
    setPlan(p[0] ?? null);
    const dayRows = await query<PlanDay>(
      "SELECT * FROM plan_days WHERE plan_id = $1 ORDER BY day_order",
      [planId],
    );
    const dayIds = dayRows.map((d) => d.id);
    let exRows: DayExRow[] = [];
    if (dayIds.length > 0) {
      const placeholders = dayIds.map((_, i) => `$${i + 1}`).join(",");
      exRows = await query<DayExRow>(
        `SELECT pe.*, e.slug, e.name_en, e.name_zh, e.equipment, e.category, e.pattern,
                e.primary_muscles, e.secondary_muscles, e.is_custom
         FROM plan_exercises pe
         JOIN exercises e ON e.id = pe.exercise_id
         WHERE pe.day_id IN (${placeholders})
         ORDER BY pe.day_id, pe.exercise_order`,
        dayIds,
      );
    }
    setDays(
      dayRows.map((d) => ({
        ...d,
        exercises: exRows.filter((e) => e.day_id === d.id),
      })),
    );
  }, [planId]);

  useEffect(() => {
    if (!Number.isNaN(planId)) load();
  }, [load]);

  const addDay = async () => {
    const n = newDayName.trim() || `Day ${days.length + 1}`;
    await execute("INSERT INTO plan_days (plan_id, name, day_order) VALUES ($1,$2,$3)", [
      planId,
      n,
      days.length,
    ]);
    setNewDayName("");
    setAddingDay(false);
    load();
  };

  const renameDay = async (day: PlanDay, name: string) => {
    await run("UPDATE plan_days SET name = $1 WHERE id = $2", [name, day.id]);
    load();
  };

  const removeDay = async (day: PlanDay) => {
    if (!confirm(t("plans.deleteDayConfirm"))) return;
    await run("DELETE FROM plan_days WHERE id = $1", [day.id]);
    load();
  };

  const addExercise = async (ex: Exercise) => {
    if (pickerForDay == null) return;
    const count = await query<{ c: number }>(
      "SELECT COUNT(*) AS c FROM plan_exercises WHERE day_id = $1",
      [pickerForDay],
    );
    await execute(
      "INSERT INTO plan_exercises (day_id, exercise_id, exercise_order) VALUES ($1,$2,$3)",
      [pickerForDay, ex.id, count[0]?.c ?? 0],
    );
    setPickerForDay(null);
    load();
  };

  const removeExercise = async (row: PlanExercise) => {
    await run("DELETE FROM plan_exercises WHERE id = $1", [row.id]);
    load();
  };

  const moveExercise = async (row: PlanExercise, dir: -1 | 1) => {
    await run("UPDATE plan_exercises SET exercise_order = exercise_order + $1 WHERE id = $2", [
      dir,
      row.id,
    ]);
    load();
  };

  const updateField = async (row: PlanExercise, field: string, value: number) => {
    const allowed = ["target_sets", "rep_min", "rep_max", "rest_seconds"];
    if (!allowed.includes(field)) return;
    await run(`UPDATE plan_exercises SET ${field} = $1 WHERE id = $2`, [value, row.id]);
    load();
  };

  if (!plan)
    return (
      <div className="bg-[#F9F8F6] px-10 py-12 text-sm text-[#1C1C1C]/60">
        {t("common.loading")}
      </div>
    );

  return (
    <div className="bg-[#F9F8F6] px-5 py-8 text-[#1C1C1C] lg:px-10 lg:py-12">
      <button onClick={() => navigate("/plans")} className="ed-link ed-btn-quiet">
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        {t("plans.title")}
      </button>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="ed-serif text-3xl lg:text-4xl">{plan.name}</h1>
        <button onClick={() => setAddingDay(true)} className="ed-link ed-btn-quiet">
          + {t("plans.addDay")}
        </button>
      </div>
      <div className="mt-3 h-px w-full bg-[#1C1C1C]/10" />

      {addingDay && (
        <div className="mt-10 flex flex-wrap items-end gap-6 border border-[#1C1C1C]/10 p-6 max-sm:flex-col max-sm:items-stretch lg:p-8">
          <div className="flex-1">
            <label className="ed-label">{t("plans.dayName")}</label>
            <input
              autoFocus
              value={newDayName}
              onChange={(e) => setNewDayName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDay()}
              className="ed-input mt-1"
            />
          </div>
          <button onClick={addDay} className="ed-btn">
            {t("common.save")}
          </button>
          <button onClick={() => setAddingDay(false)} className="ed-btn-outline">
            {t("common.cancel")}
          </button>
        </div>
      )}

      <div className="mt-12 space-y-16">
        {days.map((day, di) => (
          <section key={day.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#1C1C1C]/10 pb-4">
              <div className="flex min-w-0 flex-1 items-baseline gap-4">
                <span className="font-mono text-xs text-[#1C1C1C]/40">
                  {String(di + 1).padStart(2, "0")}
                </span>
                <input
                  value={day.name}
                  onChange={(e) => {
                    setDays((ds) =>
                      ds.map((d) => (d.id === day.id ? { ...d, name: e.target.value } : d)),
                    );
                  }}
                  onBlur={(e) => renameDay(day, e.target.value)}
                  className="ed-serif bg-transparent text-2xl outline-none"
                />
                {summarizeBodyParts(day.exercises).length > 0 && (
                  <span className="shrink-0 font-mono text-xs tracking-wide text-[#1C1C1C]/50">
                    {summarizeBodyParts(day.exercises).map((bp) => t(`bodyPart.${bp}`)).join(" · ")}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-6">
                <button
                  onClick={() => navigate(`/workout/day/${day.id}`)}
                  className="ed-link text-xs tracking-[0.2em] uppercase text-[#1C1C1C]/60 transition-colors hover:text-[#1C1C1C]"
                >
                  {t("plans.startDay")}
                </button>
                <button
                  onClick={() => removeDay(day)}
                  className="text-[#1C1C1C]/40 transition-colors hover:text-[#1C1C1C]"
                  aria-label={t("common.delete")}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="mt-2">
              {day.exercises.length === 0 && (
                <p className="py-6 font-sans text-sm leading-relaxed text-[#1C1C1C]/40">
                  {t("plans.noExercises")}
                </p>
              )}
              {day.exercises.map((row, ri) => (
                <div
                  key={row.id}
                  className="group ed-divider flex flex-wrap items-center gap-x-4 gap-y-2 py-4"
                >
                  <div className="flex flex-col">
                    <button
                      onClick={() => moveExercise(row, -1)}
                      className="text-[#1C1C1C]/30 transition-colors hover:text-[#1C1C1C]"
                      aria-label="up"
                    >
                      <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                    <button
                      onClick={() => moveExercise(row, 1)}
                      className="text-[#1C1C1C]/30 transition-colors hover:text-[#1C1C1C]"
                      aria-label="down"
                    >
                      <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                  <span className="w-8 shrink-0 font-mono text-[0.6rem] text-[#1C1C1C]/40">
                    {String(ri + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() =>
                        setDetailEx({
                          id: row.exercise_id,
                          slug: row.slug,
                          name_en: row.name_en,
                          name_zh: row.name_zh,
                          equipment: row.equipment,
                          category: row.category,
                          pattern: row.pattern,
                          primary_muscles: row.primary_muscles,
                          secondary_muscles: row.secondary_muscles,
                          is_custom: row.is_custom,
                        })
                      }
                      className="ed-serif text-left text-lg leading-snug transition-all duration-500 group-hover:italic hover:underline decoration-[#1C1C1C]/30 underline-offset-4"
                    >
                      {lang === "zh" ? row.name_zh : row.name_en}
                    </button>
                    <div className="text-xs tracking-wide text-[#1C1C1C]/60">
                      {t(`equipment.${row.equipment}`)}{" · "}
                      <MuscleTags primary={row.primary_muscles} secondary={row.secondary_muscles} max={2} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs max-sm:w-full">
                    <NumberField
                      value={row.target_sets}
                      label={t("common.sets")}
                      onCommit={(v) => updateField(row, "target_sets", v)}
                    />
                    <span className="text-[#1C1C1C]/40">×</span>
                    <NumberField
                      value={row.rep_min}
                      label={t("common.reps")}
                      onCommit={(v) => updateField(row, "rep_min", v)}
                    />
                    <span className="text-[#1C1C1C]/40">–</span>
                    <NumberField
                      value={row.rep_max}
                      label=""
                      onCommit={(v) => updateField(row, "rep_max", v)}
                    />
                    <span className="mx-2 h-4 w-px bg-[#1C1C1C]/10" />
                    <NumberField
                      value={row.rest_seconds}
                      label={`${t("common.rest")}(s)`}
                      onCommit={(v) => updateField(row, "rest_seconds", v)}
                    />
                  </div>
                  <button
                    onClick={() => removeExercise(row)}
                    className="text-[#1C1C1C]/30 transition-colors hover:text-[#1C1C1C]"
                    aria-label={t("common.delete")}
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => setPickerForDay(day.id)}
              className="ed-link ed-btn-quiet mt-4"
            >
              + {t("plans.addExercise")}
            </button>
          </section>
        ))}
      </div>

      <ExercisePicker
        open={pickerForDay != null}
        onClose={() => setPickerForDay(null)}
        onSelect={addExercise}
      />

      {detailEx && (
        <ExerciseDetailModal exercise={detailEx} onClose={() => setDetailEx(null)} />
      )}
    </div>
  );
}

function NumberField({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (v: number) => void;
}) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <label className="flex items-center gap-1">
      {label && <span className="font-sans text-xs text-[#1C1C1C]/40">{label}</span>}
      <input
        type="number"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = parseInt(v, 10);
          if (!Number.isNaN(n) && n !== value) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="ed-num w-12"
      />
    </label>
  );
}
