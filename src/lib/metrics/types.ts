// Shared input/output types for the metrics library. Pure data — no React, no SQL.
// Mirrors the rows the app already queries (see src/types.ts); the loose
// `unknown`-typed signature lets smoke tests feed raw SQLite rows directly.

/** One logged set, warmups filtered upstream. Fields are `unknown`-typed so
 *  callers can pass joined rows straight from the DB; functions validate what
 *  they use and degrade explicitly (never silently) on bad input. */
export interface SetLike {
  /** Owning session (joined from set_logs); required for session-level
   *  aggregation in fatigue.ts — sets without it are skipped there. */
  session_id?: unknown;
  weight_kg?: unknown;
  reps?: unknown;
  rpe?: unknown;
  is_warmup?: unknown;
  /** CSV muscle columns for fractional attribution (optional; pre-parsed
   *  primary/secondary lists may be supplied instead). */
  primary_muscles?: unknown;
  secondary_muscles?: unknown;
  primary?: unknown;
  secondary?: unknown;
  equipment?: unknown;
  pattern?: unknown;
  /** ISO timestamp of the owning session. */
  started_at?: unknown;
  /** Effective load in kg incl. the body-relative portion of bodyweight work
   *  (THEORY.md §5.3), written at logging time. Preferred over weight_kg for
   *  tonnage; absent/null/zero → weight_kg (legacy rows, weighted lifts). */
  load_kg?: unknown;
}

/** An exercise row (for equipment/pattern lookups in progression logic). */
export interface ExerciseLike {
  equipment?: unknown;
  pattern?: unknown;
}

/** Confidence marker attached to every estimated output. */
export type Confidence = "high" | "medium" | "low";

/** RPE coverage report — stimulus metrics must never omit it (THEORY.md §2.4). */
export interface RpeCoverage {
  n_total: number;
  n_with_rpe: number;
  /** "ok" ≥ DEFAULT_COVERAGE_THRESHOLD, else "low". */
  level: "ok" | "low";
}

/** Result of fractional attribution for one muscle over some window. */
export interface MuscleVolume {
  muscle: string;
  /** Σ effective-set weights (primary ×1.0 / secondary ×0.5, RIR-weighted). */
  fractional_sets: number;
  /** Σ set tonnage × attribution coefficient (unweighted by RIR). */
  fractional_tonnage: number;
}

/** Which muscle list a contribution came from. */
export type AttributionRole = "primary" | "secondary";

/** Per-muscle weekly set counts bucketed against MEV/MAV/MRV landmarks. */
export interface MuscleWeeklyBand {
  muscle: string;
  /** Raw (un-RIR-weighted) fractional sets — landmark tables are defined on this. */
  sets: number;
  band: "below-mev" | "mev-mav" | "mav-mrv" | "above-mrv";
}

/** Coercion helpers shared by the modules. */
export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

/** Tonnage base of a set (THEORY.md §5.3): load_kg when usable, else
 *  weight_kg. This is THE single switchpoint — every tonnage consumer
 *  (fractional attribution, ACWR tonnage, volume SQLs) routes through here
 *  or the matching COALESCE so bodyweight work is priced consistently. */
export function effectiveLoadKg(s: SetLike): number | null {
  const load = num(s.load_kg);
  if (load !== null && load > 0) return load;
  return num(s.weight_kg);
}

export function csvList(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Muscles of a set: pre-parsed `primary`/`secondary` arrays win, else CSV. */
export function musclesOf(s: SetLike): { primary: string[]; secondary: string[] } {
  const pick = (arr: unknown, csv: unknown): string[] =>
    Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : csvList(csv);
  return {
    primary: pick(s.primary, s.primary_muscles),
    secondary: pick(s.secondary, s.secondary_muscles),
  };
}
