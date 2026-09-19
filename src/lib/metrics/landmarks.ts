// Central configuration for every tunable constant in the metrics library.
// THEORY.md documents the rationale + confidence for each; keep the two in sync.

export const E1RM = {
  /** Epley: 1RM = w × (1 + r/30). */
  EPLEY_DIVISOR: 30,
  /** Brzycki: 1RM = w × 36 / (37 − r). */
  BRZYCKI_NUMERATOR: 36,
  BRZYCKI_DENOMINATOR_OFFSET: 37,
  /** Reps strictly above this are outside the linear model's valid domain. */
  MAX_REPS_FOR_E1RM: 12,
  /** Mean-relative gap between the two formulas beyond which confidence drops to "low". */
  DIVERGENCE_LOW_CONFIDENCE: 0.08,
  /** Epley-based RPE correction: treat (reps + RIR) as total reps to failure. */
  RPE_CORRECTION: true,
} as const;

export const STIMULUS = {
  /** Effective-reps threshold: reps with RIR ≤ 5 count (THEORY.md §2.1). */
  MAX_STIMULATIVE_RIR: 5,
  /** Weight of a set by its terminal RIR; missing RPE uses MISSING_RIR_ASSUMPTION. */
  EFFECTIVE_SET_WEIGHTS: [
    { maxRir: 1, weight: 1.0 },
    { maxRir: 3, weight: 0.85 },
    { maxRir: 5, weight: 0.6 },
    { maxRir: Infinity, weight: 0.3 },
  ],
  /** Assumed terminal RIR when a set has no recorded RPE (THEORY.md §2.4). */
  MISSING_RIR_ASSUMPTION: 3,
  /** Fractional attribution coefficients (THEORY.md §2.2). */
  PRIMARY_WEIGHT: 1.0,
  SECONDARY_WEIGHT: 0.5,
  /** Per-set RPE coverage below which stimulus metrics are flagged "low". */
  COVERAGE_THRESHOLD: 0.6,
} as const;

/** Weekly set landmarks per muscle (THEORY.md §3.1).
 *  Keys must use the app's muscle vocabulary (same list as ExercisePicker's
 *  MUSCLE_CHIPS). NOTE: the app has no per-delt-head keys — one merged
 *  "shoulders" entry (typical program mix: presses as indirect + side/rear
 *  isolation) until per-head keys are ever introduced. */
/** Levels used by the "training level" summary (stats page). The four-step
 *  ladder matches the fatigue monitor's bands so the two views stay legible
 *  together. */
export const TRAINING_LEVELS = {
  /** Weekly average used as the "current" window. */
  WINDOW_WEEKS: 4,
  /** Minimum effective weekly sets before a muscle counts as untouched. */
  MAINTENANCE_SETS: 1,
  /** Bands: [minInclusive, maxExclusive) as a fraction of the MAV midpoint. */
  BANDS: [
    { key: "maintenance", max: 0.25 },
    { key: "developing", max: 0.6 },
    { key: "optimal", max: 1.25 },
    { key: "overreaching", max: Infinity },
  ] as Array<{ key: "maintenance" | "developing" | "optimal" | "overreaching"; max: number }>,
} as const;

export const VOLUME_LANDMARKS: Record<string, { mev: [number, number]; mav: [number, number]; mrv: number }> = {
  chest:         { mev: [6, 8],   mav: [12, 20], mrv: 22 },
  lats:          { mev: [8, 12],  mav: [14, 24], mrv: 26 },
  "upper-back":  { mev: [6, 8],   mav: [12, 20], mrv: 26 },
  shoulders:     { mev: [6, 10],  mav: [10, 20], mrv: 26 },
  biceps:        { mev: [6, 8],   mav: [12, 20], mrv: 26 },
  triceps:       { mev: [4, 6],   mav: [10, 14], mrv: 24 },
  forearms:      { mev: [2, 4],   mav: [4, 8],   mrv: 12 },
  quads:         { mev: [4, 8],   mav: [8, 16],  mrv: 20 },
  hamstrings:    { mev: [4, 6],   mav: [8, 16],  mrv: 20 },
  glutes:        { mev: [0, 4],   mav: [4, 12],  mrv: 16 },
  adductors:     { mev: [0, 4],   mav: [4, 8],   mrv: 12 },
  calves:        { mev: [6, 8],   mav: [10, 16], mrv: 20 },
  abs:           { mev: [4, 6],   mav: [8, 16],  mrv: 24 },
  obliques:      { mev: [0, 4],   mav: [4, 8],   mrv: 16 },
  core:          { mev: [4, 6],   mav: [8, 16],  mrv: 24 },
  traps:         { mev: [0, 4],   mav: [6, 12],  mrv: 20 },
  "lower-back":  { mev: [0, 4],   mav: [4, 10],  mrv: 16 },
};

/** Fallback for unknown muscle keys: deliberately permissive. */
export const DEFAULT_LANDMARK = { mev: [4, 8] as [number, number], mav: [8, 16] as [number, number], mrv: 20 };

/** Load-increment tiers (THEORY.md §4.3), matched against equipment/pattern. */
export const INCREMENTS: Array<{
  match: (ex: { equipment?: unknown; pattern?: unknown }) => boolean;
  /** kg added on progression. */
  kg: number;
  /** Free-weight/barbell-ish → jump tiers apply; else nearest-tier rounding. */
  tier: "barbell" | "fixed";
}> = [
  { match: (e) => e.equipment === "barbell" && lowerBodyPattern(e.pattern), kg: 5, tier: "barbell" },
  { match: (e) => e.equipment === "barbell", kg: 2.5, tier: "barbell" },
  { match: (e) => e.equipment === "smith", kg: 5, tier: "barbell" },
  { match: () => true, kg: 2.5, tier: "fixed" },
];

function lowerBodyPattern(pattern: unknown): boolean {
  return pattern === "squat" || pattern === "hinge" || pattern === "single-leg";
}

export const PROGRESSION = {
  /** All working sets ≥ rep_max AND this RIR or less → add weight. */
  RIR_GATE: 2,
  /** Regression multiplier when a set fails rep_min. */
  REGRESSION_FACTOR: 0.9,
  /** e1RM pool = max over this many most recent sessions with an estimate. */
  E1RM_POOL_SESSIONS: 4,
} as const;

/** e1RM trend settings (THEORY.md §4.4 — descriptive only). */
export const TREND = {
  /** OLS window size (most recent sessions with estimates). */
  WINDOW: 4,
  /** Minimum points before a slope is reported. */
  MIN_POINTS: 3,
} as const;

/** Body-layer constants (THEORY.md §5): bodyweight load pricing + weight
 *  trend smoothing. Single point of configuration, like every other tunable. */
export const BODY = {
  /** Body-relative fraction of a bodyweight movement's load by pattern
   *  family: lower body ≈ 90% of body mass, upper-body push/pull ≈ 65%,
 *  core/holds ≈ 50% (conservative midpoints from biomechanics literature;
   *  approximate — the ordering is solid, the exact points are engineering
   *  defaults). External weight is added on top, uncaptured. */
  BW_FRACTION: { lower: 0.9, upper: 0.65, core: 0.5 },
  /** EWMA α for the weight-trend smoother: 0.5 damps single-day water-weight
   *  swings the way a ~7-point moving average would, without daily entries. */
  EWMA_ALPHA: 0.5,
} as const;

/** Deload triggers (THEORY.md §3.4). */
export const DELOAD = {
  /** Weeks in a row above MRV (any muscle) before a deload is suggested. */
  CONSECUTIVE_WEEKS_OVER_MRV: 2,
  /** ACWR peak threshold. */
  ACWR_SPIKE: 1.5,
  /** Deload volume multiplier + intensity reduction. */
  VOLUME_MULTIPLIER: 0.5,
  INTENSITY_REDUCTION_PCT: 10,
} as const;
