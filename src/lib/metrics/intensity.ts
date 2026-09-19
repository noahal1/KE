// Intensity layer: RPE↔RIR, estimated 1RM, %1RM and prescription inverse.
// THEORY.md §1. Pure functions; every estimate degrades explicitly.

import { E1RM } from "./landmarks.ts";
import type { Confidence, SetLike } from "./types.ts";
import { num } from "./types.ts";

/** RPE → RIR. Definitionally RIR = 10 − RPE (Zourdos 2016 scale).
 *  Returns null for missing/invalid RPE. */
export function rpeToRir(rpe: unknown): number | null {
  const r = num(rpe);
  if (r === null || r < 0 || r > 10) return null;
  return 10 - r;
}

export interface E1rmResult {
  /** Estimated 1RM in kg, or null outside the model's valid domain. */
  e1rm: number | null;
  confidence: Confidence | null;
  /** Mean-relative gap between Epley and Brzycki (diagnostic). */
  divergence: number;
  /** Human-readable exclusion reason when e1rm is null. */
  reason?: "high-reps" | "invalid-input";
}

/** Epley and Brzycki estimates from weight + reps-to-failure. */
function rawEpley(w: number, repsToFailure: number): number {
  return w * (1 + repsToFailure / E1RM.EPLEY_DIVISOR);
}
function rawBrzycki(w: number, repsToFailure: number): number {
  return (w * E1RM.BRZYCKI_NUMERATOR) / (E1RM.BRZYCKI_DENOMINATOR_OFFSET - repsToFailure);
}

/**
 * e1RM for one set (THEORY.md §1.2).
 * - With a recorded RPE, uses RPE correction: reps + RIR = total reps to failure.
 * - Without RPE, treats the set as taken to failure (plain formula).
 * - reps > MAX_REPS_FOR_E1RM → null (nonlinear domain), flagged "high-reps".
 */
export function e1rm(input: SetLike): E1rmResult {
  const w = num(input.weight_kg);
  const r = num(input.reps);
  const rir = rpeToRir(input.rpe);

  if (w === null || r === null || w <= 0 || r <= 0) {
    return { e1rm: null, confidence: null, divergence: 0, reason: "invalid-input" };
  }

  const repsToFailure = rir === null ? r : r + rir;
  if (repsToFailure > E1RM.MAX_REPS_FOR_E1RM) {
    return { e1rm: null, confidence: null, divergence: 0, reason: "high-reps" };
  }

  const epley = rawEpley(w, repsToFailure);
  const brzycki = rawBrzycki(w, repsToFailure);
  const mean = (epley + brzycki) / 2;
  const divergence = Math.abs(epley - brzycki) / mean;

  let confidence: Confidence;
  if (divergence > E1RM.DIVERGENCE_LOW_CONFIDENCE || repsToFailure > 10) {
    // (10, 12] is the fringe of the linear model's domain (THEORY.md §1.4).
    confidence = "low";
  } else if (repsToFailure <= 8 && rir !== null) {
    confidence = "high";
  } else {
    confidence = "medium";
  }

  return { e1rm: mean, confidence, divergence };
}

/** Best e1RM across a day's working sets: the max-tonnage set with reps ≤
 *  MAX_REPS_FOR_E1RM that yields an estimate; ties broken by fewer reps
 *  (a heavier 5-rep set beats an equal-tonnage 10-rep set). */
export function bestE1rmOfDay(sets: SetLike[]): E1rmResult | null {
  let best: E1rmResult | null = null;
  let bestTon = -1;
  for (const s of sets) {
    const w = num(s.weight_kg);
    const r = num(s.reps);
    if (w === null || r === null || s.is_warmup) continue;
    const res = e1rm(s);
    if (res.e1rm === null) continue;
    const ton = w * r;
    if (ton > bestTon || (ton === bestTon && best !== null && best.e1rm !== null && res.e1rm! > best.e1rm)) {
      best = res;
      bestTon = ton;
    }
  }
  return best;
}

export interface PrescriptionResult {
  /** Target working weight in kg, or null when e1RM is unavailable. */
  weight_kg: number | null;
  /** Corresponding %1RM (100 × w / e1RM). */
  pct1rm: number | null;
  reason?: "no-e1rm";
}

/**
 * Inverse prescription (THEORY.md §1.3): weight for `reps @ rir` from an
 * e1RM. Both Epley and Brzycki are linear in w, so the two-formula mean is
 * too — its exact inverse divides by the mean of the two per-rep
 * coefficients. Therefore `prescribeLoad(e1rm(s).e1rm, s.reps, rir)`
 * reproduces `s.weight_kg` exactly (up to float error).
 */
export function prescribeLoad(
  e1rmKg: number | null | undefined,
  reps: number,
  rir = 0,
): PrescriptionResult {
  if (e1rmKg == null || !Number.isFinite(e1rmKg) || e1rmKg <= 0) {
    return { weight_kg: null, pct1rm: null, reason: "no-e1rm" };
  }
  const rf = reps + rir; // total reps to failure
  const kEpley = 1 + rf / E1RM.EPLEY_DIVISOR;
  const kBrzycki = E1RM.BRZYCKI_NUMERATOR / (E1RM.BRZYCKI_DENOMINATOR_OFFSET - rf);
  const weight = e1rmKg / ((kEpley + kBrzycki) / 2);
  return { weight_kg: weight, pct1rm: (100 * weight) / e1rmKg };
}
