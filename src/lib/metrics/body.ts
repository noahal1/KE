// Body layer: profile-based BMI, weight-trend smoothing, and bodyweight
// exercise load pricing. THEORY.md §5 (body data). Pure functions.

import { num } from "./types.ts";

// ---------------------------------------------------------------------------
// Profile & BMI

export interface BodyProfile {
  /** Biological sex — BMI thresholds are identical but body-fat ranges differ. */
  sex: "male" | "female" | null;
  /** Years. */
  age: number | null;
  /** Centimeters. */
  height_cm: number | null;
}

export interface BmiResult {
  bmi: number | null;
  category: "underweight" | "normal" | "overweight" | "obese" | null;
}

/** WHO adult BMI categories (same cutoffs regardless of sex). */
export function bmi(weightKg: unknown, heightCm: unknown): BmiResult {
  const w = num(weightKg);
  const hCm = num(heightCm);
  if (w === null || hCm === null || w <= 0 || hCm <= 0) {
    return { bmi: null, category: null };
  }
  const hM = hCm / 100;
  const v = w / (hM * hM);
  const category =
    v < 18.5 ? "underweight" : v < 25 ? "normal" : v < 30 ? "overweight" : "obese";
  return { bmi: v, category };
}

// ---------------------------------------------------------------------------
// Weight trend

/** One body-log row (weight_kg in kg, logged_at epoch ms or ISO string). */
export interface BodyLogLike {
  weight_kg?: unknown;
  body_fat_pct?: unknown;
  logged_at?: unknown;
}

export interface WeightPoint {
  t: number;
  weight: number;
  body_fat: number | null;
}

/** Parse + sort logs chronologically; drops rows without valid data. */
export function weightPoints(logs: BodyLogLike[]): WeightPoint[] {
  const pts: WeightPoint[] = [];
  for (const l of logs) {
    const w = num(l.weight_kg);
    if (w === null || w <= 0) continue;
    const t =
      typeof l.logged_at === "number"
        ? l.logged_at
        : typeof l.logged_at === "string"
          ? Date.parse(l.logged_at) || Date.parse(l.logged_at.replace(" ", "T") + "Z")
          : NaN;
    if (!Number.isFinite(t)) continue;
    const bf = num(l.body_fat_pct);
    pts.push({ t, weight: w, body_fat: bf });
  }
  return pts.sort((a, b) => a.t - b.t);
}

export interface WeightTrendResult {
  points: WeightPoint[];
  /** Latest smoothed weight (kg), null with < 1 point. */
  current: number | null;
  /** 7-point centered EWMA-smoothed slope, kg/week. null with < 2 points. */
  perWeek: number | null;
  /** Latest recorded body-fat %, null when never logged. */
  bodyFat: number | null;
  /** First → last weight delta (kg). */
  totalChange: number | null;
}

/** EWMA-smoothed weight trend: current value and kg/week slope. EWMA with
 *  α = 0.5 damps single-day water-weight swings the way a moving average
 *  would, without needing daily entries. */
export function weightTrend(logs: BodyLogLike[]): WeightTrendResult {
  const points = weightPoints(logs);
  if (points.length === 0) {
    return { points, current: null, perWeek: null, bodyFat: null, totalChange: null };
  }
  const smoothed: number[] = [];
  let prev = points[0].weight;
  for (const p of points) {
    prev = prev + 0.5 * (p.weight - prev);
    smoothed.push(prev);
  }
  const current = smoothed[smoothed.length - 1];

  // Slope from first vs last smoothed value, expressed per week.
  let perWeek: number | null = null;
  if (points.length >= 2) {
    const days = (points[points.length - 1].t - points[0].t) / 86_400_000;
    if (days >= 1) {
      perWeek = ((smoothed[smoothed.length - 1] - smoothed[0]) / days) * 7;
    }
  }

  const withBf = points.filter((p) => p.body_fat !== null);
  return {
    points,
    current,
    perWeek,
    bodyFat: withBf.length > 0 ? withBf[withBf.length - 1].body_fat : null,
    totalChange: points.length >= 2 ? points[points.length - 1].weight - points[0].weight : null,
  };
}

// ---------------------------------------------------------------------------
// Bodyweight exercise load

/** Effective added load of a bodyweight set: the body-relative portion of the
 *  movement. Upper-body pushes/rows ≈ 65% of body mass, lower body ≈ 90%,
 *  core/holds ≈ 50% (conservative midpoints from biomechanics literature).
 *  `totalWeightKg` = external weight + bodyweight (e.g. weighted pull-up). */
export function bodyweightLoadKg(
  exercise: { pattern?: unknown },
  bodyWeightKg: unknown,
  externalWeightKg: unknown,
): number | null {
  const bw = num(bodyWeightKg);
  if (bw === null || bw <= 0) return null;
  const external = Math.max(0, num(externalWeightKg) ?? 0);
  const pattern = typeof exercise.pattern === "string" ? exercise.pattern : "";
  const fraction = pattern === "squat" || pattern === "hinge" || pattern === "single-leg" ? 0.9 : pattern === "core" || pattern === "rotation" ? 0.5 : 0.65;
  return bw * fraction + external;
}
