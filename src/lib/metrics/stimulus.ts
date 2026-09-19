// Stimulus layer: effective reps, effective-set weighting, RPE coverage and
// fractional muscle attribution. THEORY.md §2. Pure functions.

import { STIMULUS } from "./landmarks.ts";
import type { AttributionRole, MuscleVolume, RpeCoverage, SetLike } from "./types.ts";
import { effectiveLoadKg, musclesOf, num } from "./types.ts";
import { rpeToRir } from "./intensity.ts";

/** Terminal RIR of a set: recorded RPE converted, else the configured
 *  neutral assumption (THEORY.md §2.4). Also reports whether it was imputed. */
export function terminalRir(s: SetLike): { rir: number; imputed: boolean } {
  const rir = rpeToRir(s.rpe);
  if (rir !== null) return { rir, imputed: false };
  return { rir: STIMULUS.MISSING_RIR_ASSUMPTION, imputed: true };
}

/**
 * Effective reps of a set (THEORY.md §2.1): the reps performed at RIR ≤
 * MAX_STIMULATIVE_RIR. Linear approximation `clamp(6 − RIR_end, 0, reps)`.
 */
export function effectiveReps(s: SetLike): number {
  const r = num(s.reps);
  if (r === null || r <= 0) return 0;
  const { rir } = terminalRir(s);
  const raw = STIMULUS.MAX_STIMULATIVE_RIR + 1 - rir; // 6 − RIR
  return Math.max(0, Math.min(r, raw));
}

/** Weight of a whole set by its terminal RIR (THEORY.md §2.1 table). */
export function effectiveSetWeight(s: SetLike): number {
  const { rir } = terminalRir(s);
  for (const band of STIMULUS.EFFECTIVE_SET_WEIGHTS) {
    if (rir <= band.maxRir) return band.weight;
  }
  return STIMULUS.EFFECTIVE_SET_WEIGHTS[STIMULUS.EFFECTIVE_SET_WEIGHTS.length - 1].weight;
}

/** RPE coverage across a window of sets (THEORY.md §2.4). */
export function rpeCoverage(sets: SetLike[]): RpeCoverage {
  const n_total = sets.length;
  const n_with_rpe = sets.filter((s) => rpeToRir(s.rpe) !== null).length;
  const level = n_total > 0 && n_with_rpe / n_total >= STIMULUS.COVERAGE_THRESHOLD ? "ok" : "low";
  return { n_total, n_with_rpe, level };
}

interface Contribution {
  muscle: string;
  role: AttributionRole;
  /** Share of the set credited to this muscle entry (1.0 across the set). */
  share: number;
}

/**
 * Split one set across its muscle entries: every primary muscle gets
 * PRIMARY_WEIGHT, every secondary SECONDARY_WEIGHT, then the set's total
 * share is normalized to 1.0 so attribution is conservative by construction
 * (a chest+triceps exercise splits the credit instead of doubling it).
 * Exported for reuse by trainingLevels' per-muscle session counting.
 */
export function contributionsOf(s: SetLike): Contribution[] {
  const { primary, secondary } = musclesOf(s);
  const raw: Contribution[] = [
    ...primary.map((muscle) => ({ muscle, role: "primary" as const, share: STIMULUS.PRIMARY_WEIGHT })),
    ...secondary.map((muscle) => ({ muscle, role: "secondary" as const, share: STIMULUS.SECONDARY_WEIGHT })),
  ];
  if (raw.length === 0) return [];
  const total = raw.reduce((acc, c) => acc + c.share, 0);
  return raw.map((c) => ({ ...c, share: c.share / total }));
}

/** Per-muscle fractional volume over a window of working sets (THEORY.md §2.2).
 *  Tonnage attribution uses raw w×r (not RIR-weighted); set attribution is
 *  RIR-weighted (effective sets). */
export function fractionalAttribution(sets: SetLike[]): MuscleVolume[] {
  const acc = new Map<string, MuscleVolume>();
  for (const s of sets) {
    const w = effectiveLoadKg(s);
    const r = num(s.reps);
    const tonnage = w !== null && r !== null ? Math.max(0, w) * Math.max(0, r) : 0;
    const setWeight = effectiveSetWeight(s);

    for (const c of contributionsOf(s)) {
      let entry = acc.get(c.muscle);
      if (!entry) {
        entry = { muscle: c.muscle, fractional_sets: 0, fractional_tonnage: 0 };
        acc.set(c.muscle, entry);
      }
      entry.fractional_sets += setWeight * c.share;
      entry.fractional_tonnage += tonnage * c.share;
    }
  }
  return [...acc.values()].map((e) => ({
    muscle: e.muscle,
    fractional_sets: e.fractional_sets,
    fractional_tonnage: e.fractional_tonnage,
  }));
}

/** Aggregate to weekly per-muscle sets from raw (un-RIR-weighted) fractional
 *  sets — the unit the MEV/MAV/MRV landmark table is defined on. */
export function weeklyMuscleSets(sets: SetLike[]): MuscleVolume[] {
  const acc = new Map<string, number>();
  for (const s of sets) {
    for (const c of contributionsOf(s)) {
      acc.set(c.muscle, (acc.get(c.muscle) ?? 0) + c.share);
    }
  }
  return [...acc.entries()].map(([muscle, sets_]) => ({
    muscle,
    fractional_sets: sets_,
    fractional_tonnage: 0,
  }));
}
