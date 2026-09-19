import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { query, execute, run } from "../db";
import type { Plan, PlanDay } from "../types";
import { summarizeBodyParts } from "../muscles";

export default function WorkoutPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { dayId } = useParams();

  const [plans, setPlans] = useState<(Plan & { days: (PlanDay & { bodyParts: string[] })[] })[]>([]);
  const startedRef = useRef(false);

  useEffect(() => {
    query<Plan>("SELECT * FROM plans ORDER BY created_at DESC").then(async (planRows) => {
      const dayRows = await query<PlanDay>("SELECT * FROM plan_days ORDER BY day_order");
      const muscleRows = await query<{
        day_id: number;
        primary_muscles: string;
        secondary_muscles: string;
      }>(
        `SELECT pe.day_id, e.primary_muscles, e.secondary_muscles
         FROM plan_exercises pe
         JOIN exercises e ON e.id = pe.exercise_id
         ORDER BY pe.day_id, pe.exercise_order`,
      );
      setPlans(
        planRows.map((p) => ({
          ...p,
          days: dayRows
            .filter((d) => d.plan_id === p.id)
            .map((d) => ({
              ...d,
              bodyParts: summarizeBodyParts(
                muscleRows.filter((m) => m.day_id === d.id),
              ),
            })),
        })),
      );
    });
  }, []);

  useEffect(() => {
    if (dayId && !startedRef.current) {
      startedRef.current = true;
      startFromDay(Number(dayId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayId]);

  const startFromDay = async (dId: number) => {
    const day = await query<PlanDay>("SELECT * FROM plan_days WHERE id = $1", [dId]);
    if (day.length === 0) {
      navigate("/workout", { replace: true });
      return;
    }
    const sessionId = await execute(
      "INSERT INTO sessions (plan_day_id, name) VALUES ($1,$2)",
      [dId, day[0].name],
    );
    await run(
      `INSERT INTO session_exercises (session_id, exercise_id, exercise_order)
       SELECT $1, exercise_id, exercise_order FROM plan_exercises WHERE day_id = $2`,
      [sessionId, dId],
    );
    navigate(`/workout/session/${sessionId}`, { replace: true });
  };

  const startFree = async () => {
    const name = `${t("workout.freeWorkout")} · ${new Date().toLocaleDateString()}`;
    const sessionId = await execute("INSERT INTO sessions (name) VALUES ($1)", [name]);
    navigate(`/workout/session/${sessionId}`);
  };

  return (
    <div className="bg-[#F9F8F6] px-5 py-8 text-[#1C1C1C] lg:px-10 lg:py-12">
      <div className="ed-label">{t("workout.title")}</div>
      <div className="mt-3 h-px w-full bg-[#1C1C1C]/10" />

      <button
        onClick={startFree}
        className="group ed-divider mt-10 flex w-full items-center justify-between gap-4 py-10 text-left"
      >
        <div className="min-w-0">
          <h2 className="ed-serif text-4xl leading-[0.95] transition-all duration-500 group-hover:italic sm:text-5xl md:text-6xl">
            {t("workout.freeWorkout")}
          </h2>
          <p className="mt-3 max-w-md font-sans text-sm leading-relaxed text-[#1C1C1C]/60">
            {t("workout.freeWorkoutDesc")}
          </p>
        </div>
        <ArrowRight
          className="h-8 w-8 shrink-0 text-[#1C1C1C]/40 transition-transform duration-500 group-hover:translate-x-2 group-hover:text-[#1C1C1C]"
          strokeWidth={1}
        />
      </button>

      <div className="mt-16 ed-label">{t("workout.pickDay")}</div>
      {plans.length === 0 && (
        <p className="mt-8 max-w-md font-sans text-sm leading-relaxed text-[#1C1C1C]/60">
          {t("plans.emptyHint")}
        </p>
      )}
      <div className="mt-8 space-y-14">
        {plans.map((p) => (
          <section key={p.id}>
            <div className="flex items-baseline gap-4 border-b border-[#1C1C1C]/10 pb-4">
              <h3 className="ed-serif text-2xl">{p.name}</h3>
            </div>
            <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-10 max-sm:grid-cols-1">
              {p.days.map((d) => (
                <button
                  key={d.id}
                  onClick={() => startFromDay(d.id)}
                  className="group ed-divider flex items-center justify-between gap-3 py-5 text-left"
                >
                  <span className="min-w-0">
                    <span className="ed-serif block text-lg transition-all duration-500 group-hover:italic">
                      {d.name}
                    </span>
                    {d.bodyParts.length > 0 && (
                      <span className="block font-mono text-xs tracking-wide text-[#1C1C1C]/50">
                        {d.bodyParts.map((bp) => t(`bodyPart.${bp}`)).join(" · ")}
                      </span>
                    )}
                  </span>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-[#1C1C1C]/30 transition-all duration-500 group-hover:translate-x-1 group-hover:text-[#1C1C1C]"
                    strokeWidth={1.5}
                  />
                </button>
              ))}
              {p.days.length === 0 && (
                <div className="col-span-full py-4 font-sans text-sm text-[#1C1C1C]/40">
                  {t("plans.noExercises")}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
