import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "lucide-react";
import { query, execute, run } from "../db";
import type { Plan } from "../types";
import { summarizeBodyParts } from "../muscles";
import PlanIOModal from "../components/PlanIOModal";

interface PlanRow extends Plan {
  day_count: number;
  last_workout: string | null;
  bodyParts: string[];
}

export default function PlansPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [ioOpen, setIoOpen] = useState(false);

  const load = () => {
    query<PlanRow>(
      `SELECT p.*,
        (SELECT COUNT(*) FROM plan_days d WHERE d.plan_id = p.id) AS day_count,
        (SELECT MAX(s.started_at) FROM sessions s
          JOIN plan_days d2 ON s.plan_day_id = d2.id
          WHERE d2.plan_id = p.id) AS last_workout
      FROM plans p ORDER BY p.created_at DESC`,
    ).then(async (planRows) => {
      const muscleRows = await query<{
        plan_id: number;
        primary_muscles: string;
        secondary_muscles: string;
      }>(
        `SELECT d.plan_id, e.primary_muscles, e.secondary_muscles
         FROM plan_exercises pe
         JOIN plan_days d ON d.id = pe.day_id
         JOIN exercises e ON e.id = pe.exercise_id
         ORDER BY d.day_order, pe.exercise_order`,
      );
      setPlans(
        planRows.map((p) => ({
          ...p,
          bodyParts: summarizeBodyParts(
            muscleRows.filter((m) => m.plan_id === p.id),
          ),
        })),
      );
    });
  };

  useEffect(load, []);

  const create = async () => {
    const n = name.trim() || `Plan ${new Date().toLocaleDateString()}`;
    const id = await execute("INSERT INTO plans (name) VALUES ($1)", [n]);
    setCreating(false);
    setName("");
    navigate(`/plans/${id}`);
  };

  const duplicate = async (p: Plan) => {
    const newId = await execute("INSERT INTO plans (name) VALUES ($1)", [`${p.name} (copy)`]);
    const days = await query<{ id: number; name: string; day_order: number }>(
      "SELECT id, name, day_order FROM plan_days WHERE plan_id = $1 ORDER BY day_order",
      [p.id],
    );
    for (const day of days) {
      const newDayId = await execute(
        "INSERT INTO plan_days (plan_id, name, day_order) VALUES ($1,$2,$3)",
        [newId, day.name, day.day_order],
      );
      await run(
        `INSERT INTO plan_exercises (day_id, exercise_id, target_sets, rep_min, rep_max, rest_seconds, exercise_order, notes)
         SELECT $1, exercise_id, target_sets, rep_min, rep_max, rest_seconds, exercise_order, notes
         FROM plan_exercises WHERE day_id = $2`,
        [newDayId, day.id],
      );
    }
    load();
  };

  const remove = async (p: Plan) => {
    if (!confirm(t("plans.deletePlanConfirm"))) return;
    await run("DELETE FROM plans WHERE id = $1", [p.id]);
    load();
  };

  return (
    <div className="bg-[#F9F8F6] px-5 py-8 text-[#1C1C1C] lg:px-10 lg:py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="ed-serif text-3xl lg:text-4xl">{t("plans.title")}</h1>
        <div className="flex items-baseline gap-8">
          <button onClick={() => setIoOpen(true)} className="ed-link ed-btn-quiet">
            {t("io.title")}
          </button>
          <button onClick={() => setCreating(true)} className="ed-link ed-btn-quiet">
            + {t("plans.newPlan")}
          </button>
        </div>
      </div>
      <div className="mt-3 h-px w-full bg-[#1C1C1C]/10" />

      {creating && (
        <div className="mt-10 flex flex-wrap items-end gap-6 border border-[#1C1C1C]/10 p-6 max-sm:flex-col max-sm:items-stretch lg:p-8">
          <div className="flex-1">
            <label className="ed-label">{t("plans.planName")}</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              className="ed-input mt-1"
            />
          </div>
          <button onClick={create} className="ed-btn">
            {t("common.save")}
          </button>
          <button onClick={() => setCreating(false)} className="ed-btn-outline">
            {t("common.cancel")}
          </button>
        </div>
      )}

      {plans.length === 0 && !creating && (
        <p className="mt-16 max-w-md font-sans text-sm leading-relaxed text-[#1C1C1C]/60">
          {t("plans.emptyHint")}
        </p>
      )}

      <div className="mt-12">
        {plans.map((p, i) => (
          <div
            key={p.id}
            onClick={() => navigate(`/plans/${p.id}`)}
            className="group ed-divider flex cursor-pointer items-center gap-8 py-7"
          >
            <span className="w-10 shrink-0 font-mono text-xs text-[#1C1C1C]/40">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="ed-serif text-2xl transition-all duration-500 group-hover:italic">
                {p.name}
              </h2>
              <div className="mt-1 text-xs tracking-wide text-[#1C1C1C]/60">
                {p.bodyParts.length > 0 && (
                  <>
                    {p.bodyParts.map((bp) => t(`bodyPart.${bp}`)).join(" · ")}
                    {" · "}
                  </>
                )}
                {p.day_count} {t("plans.days")} ·{" "}
                {t("plans.lastWorkout")}:{" "}
                {p.last_workout ? p.last_workout.slice(0, 16).replace("T", " ") : t("plans.never")}
              </div>
            </div>
            <div
              className="flex shrink-0 items-center gap-6 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => duplicate(p)}
                className="ed-link ed-btn-quiet"
              >
                {t("plans.duplicate")}
              </button>
              <button
                onClick={() => remove(p)}
                className="ed-link ed-btn-quiet text-[#1C1C1C]/40 hover:text-[#1C1C1C]"
              >
                {t("common.delete")}
              </button>
            </div>
            <ArrowUpRight
              className="h-5 w-5 shrink-0 text-[#1C1C1C]/40 transition-transform duration-500 group-hover:translate-x-1 group-hover:-translate-y-1"
              strokeWidth={1.5}
            />
          </div>
        ))}
      </div>
      {ioOpen && (
        <PlanIOModal
          open
          plans={plans}
          onClose={() => setIoOpen(false)}
          onImported={load}
        />
      )}
    </div>
  );
}
