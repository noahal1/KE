// FitPlan metrics library — pure functions, no React, no SQL (THEORY.md §5.1).
//
// Layers:
//   intensity  — RPE↔RIR, e1RM (Epley/Brzycki), %1RM prescriptions   (§1)
//   stimulus   — effective reps, effective sets, fractional attribution (§2)
//   fatigue    — weekly landmark bands, ACWR, monotony/strain, deload  (§3)
//   progression— double progression, %1RM targets, e1RM pooling         (§4)
//   body       — BMI, weight trend, bodyweight-exercise load pricing   (§5)
//   landmarks  — every tunable constant / landmark table in one place
//
// Conventions (THEORY.md §5.1): inputs are loosely-typed rows so callers can
// pass DB results directly; outputs carry confidence/coverage metadata; any
// unknown data degrades explicitly (never silently). Relative imports use
// explicit .ts extensions so the smoke test can run these files natively
// under Node's type stripping.
export * from "./types.ts";
export * from "./landmarks.ts";
export * from "./intensity.ts";
export * from "./stimulus.ts";
export * from "./fatigue.ts";
export * from "./progression.ts";
export * from "./body.ts";
