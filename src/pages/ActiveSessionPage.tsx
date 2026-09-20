import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, X } from "lucide-react";
import { query, execute, run } from "../db";
import type { Session, SetLog } from "../types";
import { useSettings } from "../SettingsContext";
import { formatWeight, formatVolume, displayToKg, kgToDisplay } from "../units";
import { bodyweightLoadKg } from "../lib/metrics";
import ExercisePicker from "../components/ExercisePicker";
import RestTimerBar from "../components/RestTimerBar";
import SetForm from "../components/SetForm";
import ExerciseGif from "../components/ExerciseGif";
import MuscleTags from "../components/MuscleTags";
import type { Exercise } from "../types";
import { doubleProgression, prescribeFromHistory, type SetLike } from "../lib/metrics";

interface SessionExerciseRow {
  id: number;
  exercise_id: number;
  name_en: string;
  name_zh: string;
  equipment: string;
  pattern: string;
  slug: string;
  primary_muscles: string;
  secondary_muscles: string;
  target_sets: number | null;
  rep_min: number | null;
  rep_max: number | null;
  rest_seconds: number | null;
}

interface LoggedSet extends SetLog {}

/** Working sets of one past session for one exercise (for progression). */
interface PastSetRow extends SetLike {
  session_id: number;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  is_warmup: number;
}

/** Next-set recommendation computed per exercise (THEORY.md §4). */
interface NextHint {
  action: "increase" | "hold" | "regress" | "prescribe" | null;
  weightKg: number | null;
  reps: number | null;
  rirUsed: boolean | null;
}

/** Split DESC-ordered past rows into per-session arrays (newest first). */
function groupBySession(rows: PastSetRow[]): PastSetRow[][] {
  const out: PastSetRow[][] = [];
  let curId: number | null = null;
  for (const r of rows) {
    if (r.session_id !== curId) {
      out.push([]);
      curId = r.session_id;
    }
    out[out.length - 1].push(r);
  }
  return out;
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function ActiveSessionPage() {
  const { id } = useParams();
  const sessionId = Number(id);
  const { t } = useTranslation();
  const { lang, unit, soundCue, profile } = useSettings();
  const navigate = useNavigate();

  const [session, setSession] = useState<Session | null>(null);
  const [exRows, setExRows] = useState<SessionExerciseRow[]>([]);
  const [sets, setSets] = useState<LoggedSet[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [prFlash, setPrFlash] = useState<number | null>(null);
  const [demoFor, setDemoFor] = useState<number | null>(null);

  const [restLeft, setRestLeft] = useState(0);
  const [restTotal, setRestTotal] = useState(0);
  const [pastRows, setPastRows] = useState<Map<number, PastSetRow[]>>(new Map());

  const [elapsed, setElapsed] = useState(0);

  const load = useCallback(async () => {
    const s = await query<Session>("SELECT * FROM sessions WHERE id = $1", [sessionId]);
    setSession(s[0] ?? null);
    const rows = await query<SessionExerciseRow>(
      `SELECT se.id, se.exercise_id, e.name_en, e.name_zh, e.equipment, e.pattern, e.slug,
              e.primary_muscles, e.secondary_muscles,
              pe.target_sets, pe.rep_min, pe.rep_max, pe.rest_seconds
       FROM session_exercises se
       JOIN exercises e ON e.id = se.exercise_id
       LEFT JOIN plan_days d ON d.id = (
         SELECT plan_day_id FROM sessions WHERE id = se.session_id
       )
       LEFT JOIN plan_exercises pe ON pe.day_id = d.id AND pe.exercise_id = se.exercise_id
       WHERE se.session_id = $1
       ORDER BY se.exercise_order`,
      [sessionId],
    );
    setExRows(rows);
    const setRows = await query<SetLog>(
      "SELECT * FROM set_logs WHERE session_id = $1 ORDER BY id",
      [sessionId],
    );
    setSets(setRows);
  }, [sessionId]);

  useEffect(() => {
    if (!Number.isNaN(sessionId)) load();
  }, [load]);

  useEffect(() => {
    if (!session?.started_at) return;
    const start = new Date(session.started_at + "Z").getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [session?.started_at]);

  useEffect(() => {
    if (restLeft > 0) {
      const h = setTimeout(() => setRestLeft((s) => s - 1), 1000);
      return () => clearTimeout(h);
    }
  }, [restLeft]);

  useEffect(() => {
    if (prFlash != null) {
      const h = setTimeout(() => setPrFlash(null), 3000);
      return () => clearTimeout(h);
    }
  }, [prFlash]);

  const prevBests = useRef<Map<number, { weight_kg: number; reps: number } | null>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const m = new Map<number, { weight_kg: number; reps: number } | null>();
      for (const row of exRows) {
        const best = await query<{ weight_kg: number; reps: number }>(
          `SELECT sl.weight_kg, sl.reps FROM set_logs sl
           JOIN sessions s ON s.id = sl.session_id
           WHERE sl.exercise_id = $1 AND sl.is_warmup = 0 AND s.id != $2 AND s.started_at < (
             SELECT started_at FROM sessions WHERE id = $2
           )
           ORDER BY sl.weight_kg DESC, sl.reps DESC LIMIT 1`,
          [row.exercise_id, sessionId],
        );
        m.set(row.exercise_id, best[0] ?? null);
      }
      if (!cancelled) prevBests.current = m;
    };
    if (exRows.length > 0) run();
    return () => {
      cancelled = true;
    };
  }, [exRows, sessionId]);

  // Past working sets per exercise (newest-first), for progression hints:
  // up to ~5 recent sessions' worth, warmups excluded (THEORY.md §4).
  useEffect(() => {
    if (exRows.length === 0) return;
    let cancelled = false;
    const run = async () => {
      const m = new Map<number, PastSetRow[]>();
      for (const row of exRows) {
        const rows = await query<PastSetRow>(
          `SELECT sl.session_id, sl.weight_kg, sl.reps, sl.rpe, sl.is_warmup
           FROM set_logs sl
           JOIN sessions s ON s.id = sl.session_id
           WHERE sl.exercise_id = $1 AND sl.is_warmup = 0 AND s.id != $2
             AND s.started_at < (SELECT started_at FROM sessions WHERE id = $2)
           ORDER BY s.started_at DESC, sl.id DESC
           LIMIT 80`,
          [row.exercise_id, sessionId],
        );
        m.set(row.exercise_id, rows);
      }
      if (!cancelled) setPastRows(m);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [exRows, sessionId]);

  const setsByExercise = useMemo(() => {
    const m = new Map<number, LoggedSet[]>();
    for (const s of sets) {
      const arr = m.get(s.exercise_id) ?? [];
      arr.push(s);
      m.set(s.exercise_id, arr);
    }
    for (const [, arr] of m) arr.sort((a, b) => a.set_number - b.set_number);
    return m;
  }, [sets]);

  // Tonnage uses the effective load: load_kg (bodyweight-inclusive, written at
  // log time) when present, else weight_kg (external-only legacy rows).
  const totalVolume = useMemo(
    () =>
      sets
        .filter((s) => !s.is_warmup)
        .reduce((acc, s) => acc + (s.load_kg ?? s.weight_kg) * s.reps, 0),
    [sets],
  );

  // Per-exercise recommendation from the last past session's working sets
  // (double progression) or, when no plan rep window exists, a %1RM target
  // for the plan's rep midpoint from the pooled e1RM (THEORY.md §4.1/4.2).
  const nextHints = useMemo(() => {
    const m = new Map<number, NextHint>();
    for (const row of exRows) {
      const history = pastRows.get(row.exercise_id) ?? [];
      if (history.length === 0) {
        m.set(row.exercise_id, { action: null, weightKg: null, reps: null, rirUsed: null });
        continue;
      }
      // newest session = leading session_id run of the DESC-ordered rows
      const newestId = history[0].session_id;
      const newestSets = history.filter((s) => s.session_id === newestId);
      const ex = { equipment: row.equipment, pattern: row.pattern };

      if (row.rep_min != null && row.rep_max != null) {
        const r = doubleProgression({
          sets: newestSets,
          rep_min: row.rep_min,
          rep_max: row.rep_max,
          exercise: ex,
        });
        if (r.weight_kg != null) {
          m.set(row.exercise_id, {
            action: r.action,
            weightKg: r.weight_kg,
            reps: r.reps,
            rirUsed: r.rirGateUsed,
          });
          continue;
        }
      }
      // Free-session exercise (no rep window): %1RM target at the rep dose
      // of the last session (capped to the calibrated domain), RIR 2.
      const lastReps = Math.max(...newestSets.map((s) => s.reps));
      const targetReps = Math.min(15, lastReps > 0 ? lastReps : 8);
      const p = prescribeFromHistory(
        groupBySession(history),
        targetReps,
        2,
      );
      m.set(row.exercise_id, {
        action: p.weight_kg != null ? "prescribe" : null,
        weightKg: p.weight_kg,
        reps: p.weight_kg != null ? targetReps : null,
        rirUsed: true,
      });
    }
    return m;
  }, [exRows, pastRows]);

  const addExerciseToSession = async (ex: Exercise) => {
    const count = await query<{ c: number }>(
      "SELECT COUNT(*) AS c FROM session_exercises WHERE session_id = $1",
      [sessionId],
    );
    await execute(
      "INSERT INTO session_exercises (session_id, exercise_id, exercise_order) VALUES ($1,$2,$3)",
      [sessionId, ex.id, count[0]?.c ?? 0],
    );
    setPickerOpen(false);
    load();
  };

  const logSet = async (
    exRow: SessionExerciseRow,
    weightDisplay: number,
    reps: number,
    rpe: number | null,
    isWarmup: boolean,
  ) => {
    const weightKg = displayToKg(weightDisplay, unit);
    const existing = setsByExercise.get(exRow.exercise_id) ?? [];
    const setNumber = existing.length + 1;

    const pb = prevBests.current.get(exRow.exercise_id);
    const sessionBestWeight = Math.max(
      0,
      ...existing.filter((s) => !s.is_warmup).map((s) => s.weight_kg),
    );
    const sessionBestRepsAtWeight = existing
      .filter((s) => !s.is_warmup && s.weight_kg === weightKg)
      .reduce((mx, s) => Math.max(mx, s.reps), 0);

    let isPR = false;
    if (!isWarmup && weightKg > 0 && pb) {
      if (weightKg > pb.weight_kg && weightKg > sessionBestWeight) isPR = true;
      else if (
        weightKg === pb.weight_kg &&
        reps > pb.reps &&
        reps > sessionBestRepsAtWeight &&
        weightKg >= sessionBestWeight
      )
        isPR = true;
    }

    // Effective load (THEORY.md §5): bodyweight moves get the body-relative
    // portion priced in at log time; weighted moves store weight_kg as-is.
    // Falls back to weight_kg (null) when no bodyweight is on file.
    const loadKg =
      exRow.equipment === "bodyweight"
        ? bodyweightLoadKg({ pattern: exRow.pattern }, profile.weightKg, weightKg)
        : weightKg;

    await execute(
      "INSERT INTO set_logs (session_id, exercise_id, set_number, weight_kg, load_kg, reps, rpe, is_warmup, is_pr) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [sessionId, exRow.exercise_id, setNumber, weightKg, loadKg, reps, rpe, isWarmup ? 1 : 0, isPR ? 1 : 0],
    );
    if (isPR) setPrFlash(exRow.exercise_id);

    const rest = exRow.rest_seconds ?? 90;
    if (rest > 0) {
      setRestTotal(rest);
      setRestLeft(rest);
    }
    await load();
  };

  const deleteSet = async (s: SetLog) => {
    if (!confirm(t("workout.deleteSetConfirm"))) return;
    await run("DELETE FROM set_logs WHERE id = $1 AND session_id = $2", [s.id, sessionId]);
    await load();
  };

  const finish = async () => {
    if (!confirm(t("workout.finishConfirm"))) return;
    await run("UPDATE sessions SET finished_at = datetime('now') WHERE id = $1", [sessionId]);
    navigate("/history");
  };

  const discard = async () => {
    if (!confirm(t("workout.discardConfirm"))) return;
    await run("DELETE FROM sessions WHERE id = $1", [sessionId]);
    navigate("/workout");
  };

  if (!session)
    return (
      <div className="bg-[#F9F8F6] px-5 py-8 text-sm text-[#1C1C1C]/60 sm:px-10 sm:py-12">
        {t("common.loading")}
      </div>
    );

  return (
    <div className="bg-[#F9F8F6] px-5 py-8 pb-32 text-[#1C1C1C] lg:px-10 lg:py-12">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-6">
        <div className="min-w-0 flex-1">
          <button onClick={() => navigate("/workout")} className="ed-link ed-btn-quiet">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("workout.title")}
          </button>
          <h1 className="ed-serif mt-4 text-3xl leading-none lg:text-4xl">{session.name}</h1>
        </div>
        <div className="flex flex-wrap items-end gap-6 sm:gap-10">
          <div className="text-right">
            <div className="ed-label">{t("workout.volume")}</div>
            <div className="mt-1 font-mono text-xl text-[#1C1C1C] sm:text-2xl">
              {formatVolume(totalVolume, unit)}
              {unit}
            </div>
            <div className="mt-1 ed-label">
              {t("history.sets", { n: sets.length })}
            </div>
          </div>
          <div className="text-right">
            <div className="ed-label">Elapsed</div>
            <div className="mt-1 font-mono text-xl tabular-nums text-[#1C1C1C] sm:text-2xl">
              {formatDuration(elapsed)}
            </div>
          </div>
          <div className="flex items-end gap-6">
            <button onClick={finish} className="ed-btn px-5 py-2.5 text-xs">
              {t("workout.finish")}
            </button>
            <button onClick={discard} className="ed-link ed-btn-quiet text-[#1C1C1C]/40 hover:text-[#1C1C1C]">
              {t("workout.discard")}
            </button>
          </div>
        </div>
      </div>
      <div className="mt-8 h-px w-full bg-[#1C1C1C]/10" />

      <div className="mt-14 space-y-16">
        {exRows.length === 0 && (
          <p className="max-w-md font-sans text-sm leading-relaxed text-[#1C1C1C]/60">
            {t("workout.addExercise")}
          </p>
        )}
        {exRows.map((row, i) => {
          const mySets = setsByExercise.get(row.exercise_id) ?? [];
          const pb = prevBests.current.get(row.exercise_id);
          const hint = nextHints.get(row.exercise_id) ?? null;
          const hintDisplay =
            hint?.weightKg != null ? Math.round(kgToDisplay(hint.weightKg, unit) * 10) / 10 : null;
          return (
            <section key={row.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-[#1C1C1C]/10 pb-4">
                <div className="flex min-w-0 items-baseline gap-4">
                  <span className="font-mono text-xs text-[#1C1C1C]/40">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h2 className="ed-serif min-w-0 text-xl transition-all duration-500 hover:italic sm:text-2xl">
                    {lang === "zh" ? row.name_zh : row.name_en}
                  </h2>
                  {prFlash === row.exercise_id && (
                    <span className="ed-serif text-sm italic text-[#1C1C1C]/60">
                      ★ {t("workout.prHint")}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <div className="text-xs tracking-wide text-[#1C1C1C]/60">
                    {t(`equipment.${row.equipment}`)}{" · "}
                    <MuscleTags primary={row.primary_muscles} secondary={row.secondary_muscles} max={2} />
                    {pb
                      ? ` · ${t("workout.previousBest")}: ${formatWeight(pb.weight_kg, unit)}${unit} × ${pb.reps}`
                      : ""}
                    {row.target_sets
                      ? ` · ${t("common.sets")} ${row.target_sets} × ${row.rep_min ?? 8}-${row.rep_max ?? 12}`
                      : ""}
                  </div>
                  <button
                    onClick={() => setDemoFor(demoFor === row.exercise_id ? null : row.exercise_id)}
                    className="ed-link ed-btn-quiet text-[0.65rem]"
                  >
                    {demoFor === row.exercise_id ? t("workout.hideDemo") : t("workout.showDemo")}
                  </button>
                </div>
              </div>

              {demoFor === row.exercise_id && (
                <div className="mt-4">
                  <ExerciseGif
                    compact
                    exercise={{
                      slug: row.slug,
                      name_en: row.name_en,
                      is_custom: 0,
                    }}
                  />
                </div>
              )}

              {hint && hintDisplay != null && (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border border-[#1C1C1C]/15 px-4 py-2.5">
                  <span className="ed-label">{t("workout.nextHint")}</span>
                  <span className="font-mono text-sm text-[#1C1C1C]">
                    {formatWeight(hint.weightKg, unit)}{unit} × {hint.reps}
                  </span>
                  <span className="font-sans text-xs text-[#1C1C1C]/50">
                    {hint.action === "increase" && t("workout.nextHintIncrease")}
                    {hint.action === "hold" && t("workout.nextHintHold")}
                    {hint.action === "regress" && t("workout.nextHintRegress")}
                    {hint.action === "prescribe" && t("workout.nextHintPrescribe")}
                  </span>
                  {hint.rirUsed === false && (
                    <span className="font-sans text-xs text-[#1C1C1C]/40">
                      {t("workout.nextHintNoRpe")}
                    </span>
                  )}
                </div>
              )}

              {mySets.length > 0 && (
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left ed-label">
                      <th className="py-2 pr-4 font-normal">#</th>
                      <th className="py-2 pr-4 font-normal">{t("common.weight")} ({unit})</th>
                      <th className="py-2 pr-4 font-normal">{t("common.reps")}</th>
                      <th className="py-2 pr-4 font-normal">{t("common.rpe")}</th>
                      <th className="py-2 pr-4 font-normal">W</th>
                      <th className="py-2 font-normal" />
                    </tr>
                  </thead>
                  <tbody>
                    {mySets.map((s) => (
                      <tr key={s.id} className="border-t border-[#1C1C1C]/10">
                        <td className="py-2 pr-4 font-mono text-xs text-[#1C1C1C]/40">
                          {s.set_number}
                        </td>
                        <td className="py-2 pr-4 font-mono text-[#1C1C1C]">
                          <span className="inline-flex items-center gap-1.5">
                            {s.load_kg != null && s.load_kg > 0 ? (
                              <span title={t("body.inclBodyweight")}>
                                ≈ {formatWeight(s.load_kg, unit)}
                              </span>
                            ) : (
                              formatWeight(s.weight_kg, unit)
                            )}
                            {s.is_pr ? (
                              <span className="ed-serif text-xs italic">★</span>
                            ) : null}
                          </span>
                        </td>
                        <td className="py-2 pr-4 font-mono text-[#1C1C1C]">{s.reps}</td>
                        <td className="py-2 pr-4 text-[#1C1C1C]/60">{s.rpe ?? "–"}</td>
                        <td className="py-2 text-[#1C1C1C]/60">
                          {s.is_warmup ? "◦" : ""}
                        </td>
                        <td className="py-2 pl-4 text-right">
                          <button
                            onClick={() => deleteSet(s)}
                            className="text-[#1C1C1C]/30 transition-colors hover:text-[#1C1C1C]"
                            aria-label={t("common.delete")}
                          >
                            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <SetForm
                setNumber={mySets.length + 1}
                lastSet={mySets[mySets.length - 1]}
                repMin={row.rep_min}
                repMax={row.rep_max}
                targetSets={row.target_sets}
                unit={unit}
                suggested={
                  hint?.weightKg != null && hint.reps != null
                    ? { weightKg: hint.weightKg, reps: hint.reps }
                    : undefined
                }
                effectiveLoad={
                  row.equipment === "bodyweight" && profile.weightKg != null
                    ? (wDisplay) => {
                        const loadKg = bodyweightLoadKg(
                          { pattern: row.pattern },
                          profile.weightKg,
                          displayToKg(wDisplay, unit),
                        );
                        return loadKg === null ? null : kgToDisplay(loadKg, unit);
                      }
                    : undefined
                }
                onLog={(w, r, rpe, warmup) => logSet(row, w, r, rpe, warmup)}
              />
              {row.equipment === "bodyweight" && profile.weightKg == null && (
                <p className="-mt-3 font-sans text-xs text-[#1C1C1C]/40">
                  {t("workout.bodyweightNote")}
                </p>
              )}
            </section>
          );
        })}
      </div>

      <div className="mt-16">
        <button onClick={() => setPickerOpen(true)} className="ed-link ed-btn-quiet">
          + {t("workout.addExercise")}
        </button>
      </div>

      <RestTimerBar
        left={restLeft}
        total={restTotal}
        onSkip={() => {
          setRestLeft(0);
          setRestTotal(0);
        }}
        onExtend={(sec) => {
          setRestLeft((s) => s + sec);
          setRestTotal((s) => s + sec);
        }}
        soundCue={soundCue}
        label={t("workout.resting")}
        skipLabel={t("workout.skipRest")}
        extendLabel={t("workout.extendRest")}
        doneLabel={t("workout.restDone")}
      />

      <ExercisePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={addExerciseToSession}
      />
    </div>
  );
}
