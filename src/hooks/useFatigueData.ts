import { useEffect, useMemo, useState } from "react";
import { parseSqliteTimestamp, query } from "../db";
import {
  acwr,
  deloadCheck,
  groupByWeek,
  isoWeekKey,
  monotony,
  rpeCoverage,
  sessionLoads,
  trainingLevels,
  weeklyMuscleBands,
  type AcwrResult,
  type DeloadCheck,
  type MonotonyResult,
  type MuscleTrainingLevel,
  type MuscleWeeklyBand,
  type RpeCoverage,
  type SetLike,
} from "../lib/metrics";

/** One set joined with its session start time and the exercise's muscles. */
export interface FatigueQueryRow extends SetLike {
  session_id: number;
  started_at: string | null;
}

export interface FatigueWeek {
  key: string;
  bands: MuscleWeeklyBand[];
  /** Σ Foster session loads of the sessions held that week. */
  load: number;
}

export interface FatigueData {
  ready: boolean;
  weeks: FatigueWeek[];
  acwr: AcwrResult | null;
  monotony: MonotonyResult | null;
  deload: DeloadCheck;
  coverage: RpeCoverage;
  /** Per-muscle training level over the last TRAINING_LEVELS.WINDOW_WEEKS. */
  levels: MuscleTrainingLevel[];
  /** ISO week key of the in-progress week. */
  currentWeek: string | null;
}

const EMPTY_DELOAD: DeloadCheck = { suggest: false, reasons: [], overMrvMuscles: [], acwrSpike: false };

/** Pulls the last ~5 weeks of working sets and runs the fatigue pipeline
 *  (THEORY.md §3): weekly landmark bands, ACWR, monotony/strain, deload.
 *  Sets without a parseable session timestamp are dropped (explicitly, by
 *  construction of the join). */
export function useFatigueData(): FatigueData {
  const [rows, setRows] = useState<FatigueQueryRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    query<FatigueQueryRow>(
      `SELECT sl.session_id, sl.weight_kg, sl.load_kg, sl.reps, sl.rpe, sl.is_warmup,
              s.started_at, e.primary_muscles, e.secondary_muscles
       FROM set_logs sl
       JOIN sessions s ON s.id = sl.session_id
       JOIN exercises e ON e.id = sl.exercise_id
       WHERE sl.is_warmup = 0
         AND s.started_at >= datetime('now', '-34 days', 'start of day')
       ORDER BY s.started_at`,
    )
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([])); // SQL unavailable (browser dev): degrade to empty
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(() => {
    if (rows === null)
      return {
        ready: false,
        weeks: [],
        acwr: null,
        monotony: null,
        deload: EMPTY_DELOAD,
        coverage: { n_total: 0, n_with_rpe: 0, level: "low" },
        levels: [],
        currentWeek: null,
      };

    const now = new Date();
    const withTs = rows.flatMap((r) => {
      const ts = parseSqliteTimestamp(r.started_at);
      return ts === null ? [] : [{ ...r, started_at: ts }];
    });

    const loads = sessionLoads(withTs);
    const loadById = new Map(loads.map((l) => [l.session_id, l.load]));
    const sessionDate = new Map<number, number>();
    for (const s of withTs) {
      if (!sessionDate.has(s.session_id)) sessionDate.set(s.session_id, s.started_at as number);
    }

    const weeks: FatigueWeek[] = groupByWeek(withTs).map((w) => {
      const ids = new Set(w.sets.map((s) => s.session_id as number));
      let load = 0;
      for (const id of ids) load += loadById.get(id) ?? 0;
      return { key: w.week, bands: weeklyMuscleBands(w.sets), load };
    });

    const acwrResult =
      loads.length > 0
        ? acwr(
            loads.map((l) => ({ load: l.load, date: new Date(sessionDate.get(l.session_id) ?? now.getTime()) })),
            now,
          )
        : null;

    const monotonyResult = monotony(weeks.map((w) => w.load));
    const deload = deloadCheck(
      weeks.map((w) => w.bands),
      acwrResult,
    );

    const levels = trainingLevels(
      weeks.map((w) => w.bands),
      {
        weekKeys: weeks.map((w) => w.key),
        sets: withTs as Array<SetLike & { started_at: number | string | null }>,
      },
    );

    return {
      ready: true,
      weeks,
      acwr: acwrResult,
      monotony: monotonyResult,
      deload,
      levels,
      coverage: rpeCoverage(withTs),
      currentWeek: isoWeekKey(now),
    };
  }, [rows]);
}
