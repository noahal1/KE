// Progression layer: double progression, %1RM target weights, e1RM pooling.
// THEORY.md §4. Pure functions — the caller supplies previous-session working
// sets (newest session for that exercise, warmups filtered) and the plan's
// rep window; this module decides the next recommendation.

import { INCREMENTS, PROGRESSION, TREND } from "./landmarks.ts";
import type { SetLike } from "./types.ts";
import { int, num } from "./types.ts";
import { bestE1rmOfDay, prescribeLoad } from "./intensity.ts";

// ---------------------------------------------------------------------------
// Increments

/** kg increment + rounding tier for an exercise (THEORY.md §4.3). */
export function incrementFor(ex: { equipment?: unknown; pattern?: unknown }): { kg: number; tier: "barbell" | "fixed" } {
  for (const tier of INCREMENTS) {
    if (tier.match(ex)) return { kg: tier.kg, tier: tier.tier };
  }
  return { kg: 2.5, tier: "fixed" }; // unreachable: INCREMENTS ends with a catch-all
}

/** Round a target weight down to the nearest legal plate/dumbbell jump of
 *  `step` (min one step so regression never rounds to 0). */
export function roundToIncrement(weightKg: number, step: number): number {
  if (step <= 0) return weightKg;
  return Math.max(step, Math.floor(weightKg / step + 1e-9) * step);
}

// ---------------------------------------------------------------------------
// Double progression (THEORY.md §4.1)

export type ProgressionAction = "increase" | "hold" | "regress";

export interface ProgressionInput {
  /** Working sets of the athlete's previous session for this exercise
   *  (same weight across sets is typical but not required). */
  sets: SetLike[];
  /** Planned rep window (plan_exercises.rep_min/rep_max). */
  rep_min: number | null | undefined;
  rep_max: number | null | undefined;
  /** Exercise equipment/pattern for the increment tier. */
  exercise: { equipment?: unknown; pattern?: unknown };
  /** Recorded-RPE sets among `sets` (for the RIR gate). */
  // no extra field needed — RIR gate reads rpe off the sets themselves
}

export interface ProgressionResult {
  action: ProgressionAction;
  /** Recommended next weight in kg (already rounded to the increment). */
  weight_kg: number | null;
  /** Recommended rep target for the next session. */
  reps: number | null;
  /** null when no RPE was recorded (gate skipped, reps-only rule). */
  rirGateUsed: boolean | null;
  /** Why the action fired — for UI explanation / tests. */
  why: "all-sets-hit-max-with-rir" | "all-sets-hit-max" | "a-set-below-min" | "within-window" | "no-data";
  /** Base weight the recommendation was computed from (max of prev sets). */
  baseWeightKg: number | null;
}

/**
 * Double progression over the previous session's working sets:
 * - every set ≥ rep_max AND (no RPE recorded OR every RIR ≤ RIR_GATE) → add
 *   one increment, reps return to rep_min;
 * - any set < rep_min → −10% of base weight (rounded down to increment);
 * - otherwise hold the weight.
 */
export function doubleProgression(input: ProgressionInput): ProgressionResult {
  const sets = input.sets.filter((s) => {
    const w = num(s.weight_kg);
    const r = num(s.reps);
    return !s.is_warmup && w !== null && r !== null && r > 0;
  });

  const repMin = int(input.rep_min);
  const repMax = int(input.rep_max);
  const baseWeight = sets.reduce((mx, s) => Math.max(mx, num(s.weight_kg) ?? 0), 0) || null;
  const { kg: step } = incrementFor(input.exercise);

  if (sets.length === 0 || repMax === null || baseWeight === null) {
    return {
      action: "hold",
      weight_kg: baseWeight,
      reps: repMin ?? null,
      rirGateUsed: null,
      why: "no-data",
      baseWeightKg: baseWeight,
    };
  }

  const repsList = sets.map((s) => num(s.reps)!);
  const rirList = sets
    .map((s) => (typeof s.rpe === "number" || typeof s.rpe === "string" ? 10 - Number(s.rpe) : null))
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const hasRpe = rirList.length > 0;
  const rirGateOk = !hasRpe || rirList.every((rir) => rir <= PROGRESSION.RIR_GATE);

  if (repsList.every((r) => r >= repMax) && rirGateOk) {
    return {
      action: "increase",
      weight_kg: roundToIncrement(baseWeight + step, step),
      reps: repMin ?? repMax,
      rirGateUsed: hasRpe,
      why: hasRpe ? "all-sets-hit-max-with-rir" : "all-sets-hit-max",
      baseWeightKg: baseWeight,
    };
  }

  if (repsList.some((r) => r < (repMin ?? 1))) {
    return {
      action: "regress",
      weight_kg: roundToIncrement(baseWeight * PROGRESSION.REGRESSION_FACTOR, step),
      reps: repMin ?? repMax,
      rirGateUsed: hasRpe,
      why: "a-set-below-min",
      baseWeightKg: baseWeight,
    };
  }

  return {
    action: "hold",
    weight_kg: baseWeight,
    reps: Math.min(repMax, (Math.max(...repsList) ?? 0) + 1),
    rirGateUsed: hasRpe,
    why: "within-window",
    baseWeightKg: baseWeight,
  };
}

// ---------------------------------------------------------------------------
// %1RM prescription with e1RM pooling (THEORY.md §4.2)

export interface PrescribeResult {
  /** Pooled e1RM the prescription is based on. */
  e1rm: number | null;
  /** Target weight for `reps @ rir` in kg (raw — round for display). */
  weight_kg: number | null;
  pct1rm: number | null;
  /** How the pool was built. */
  source: "pooled-max" | "none";
}

/**
 * Pool e1RM across sessions: the MAX over the last
 * PROGRESSION.E1RM_POOL_SESSIONS sessions with a valid estimate (fatigue
 * days must not deflate the prescription). Sessions without any valid set
 * are skipped; if NO session yields an estimate the result is null.
 */
export function pooledE1rm(sessionSets: SetLike[][]): { e1rm: number | null; source: PrescribeResult["source"] } {
  const estimates: number[] = [];
  for (const sets of sessionSets) {
    const best = bestE1rmOfDay(sets);
    if (best?.e1rm != null) estimates.push(best.e1rm);
    if (estimates.length >= PROGRESSION.E1RM_POOL_SESSIONS) break;
  }
  if (estimates.length > 0) {
    return { e1rm: Math.max(...estimates), source: "pooled-max" };
  }
  return { e1rm: null, source: "none" };
}

/** Target weight for `reps @ rir` from pooled session history. */
export function prescribeFromHistory(
  sessionSets: SetLike[][],
  reps: number,
  rir = 0,
): PrescribeResult {
  const { e1rm: pool, source } = pooledE1rm(sessionSets);
  if (pool === null) {
    return { e1rm: null, weight_kg: null, pct1rm: null, source: "none" };
  }
  const { weight_kg, pct1rm } = prescribeLoad(pool, reps, rir);
  return { e1rm: pool, weight_kg, pct1rm, source };
}

// ---------------------------------------------------------------------------
// e1RM trend (THEORY.md §4.4 — description only, no forecasting)

export interface E1rmPoint {
  /** Epoch ms of the session. */
  t: number;
  e1rm: number;
}

export interface E1rmTrendResult {
  points: E1rmPoint[];
  /** OLS slope over the last TREND.WINDOW points, kg per day.
   *  null when fewer than TREND.MIN_POINTS points. */
  slopePerDay: number | null;
}

/** Per-session best e1RM series from raw rows (any order; deduped by
 *  session — pass rows already grouped per session for clarity). Ascending
 *  in time. Rows need a parseable `started_at` (epoch ms). */
export function e1rmTrend(sessionSets: SetLike[][]): E1rmTrendResult {
  const points: E1rmPoint[] = [];
  for (const sets of sessionSets) {
    const ts = num(sets[0]?.started_at);
    const best = bestE1rmOfDay(sets);
    if (ts === null || best?.e1rm == null) continue;
    points.push({ t: ts, e1rm: best.e1rm });
  }
  points.sort((a, b) => a.t - b.t);

  const win = points.slice(-TREND.WINDOW);
  if (win.length < TREND.MIN_POINTS) {
    return { points, slopePerDay: null };
  }
  // OLS over days since the first point of the window.
  const t0 = win[0].t;
  const xs = win.map((p) => (p.t - t0) / 86_400_000);
  const ys = win.map((p) => p.e1rm);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxx === 0 ? null : sxy / sxx;
  return { points, slopePerDay: slope };
}
