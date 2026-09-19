// Fatigue layer: weekly per-muscle volume vs landmarks, ACWR, Foster
// monotony/strain, and deload triggers. THEORY.md §3. Pure functions —
// temporal binning is input-driven (ISO week from started_at) so tests and
// report scripts can feed synthetic timestamps.

import { DELOAD, TRAINING_LEVELS, VOLUME_LANDMARKS, DEFAULT_LANDMARK } from "./landmarks.ts";
import type { MuscleWeeklyBand, SetLike } from "./types.ts";
import { effectiveLoadKg, int, num } from "./types.ts";
import { contributionsOf, weeklyMuscleSets } from "./stimulus.ts";
import { rpeToRir } from "./intensity.ts";

// ---------------------------------------------------------------------------
// Weekly binning

/** Key for the ISO week containing `date`: "G-WW" (ISO year, ISO week).
 *  Offsets by the local timezone so a local evening session stays on its
 *  local calendar day. */
export function isoWeekKey(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  const day = local.getUTCDay() || 7; // ISO: Mon=1..Sun=7
  local.setUTCDate(local.getUTCDate() + 4 - day); // shift to the week's Thursday
  const yearStart = Date.UTC(local.getUTCFullYear(), 0, 1);
  // Whole days since Jan 1 of the (ISO) year — floor, never ceil, so a
  // sub-day remainder cannot inflate the week number.
  const days = Math.floor((local.getTime() - yearStart) / 86_400_000);
  const week = Math.floor(days / 7) + 1;
  return `${local.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface WeeklySetWindow {
  week: string;
  sets: SetLike[];
}

/** Group working sets into ISO weeks (week = Monday, locale-independent). */
export function groupByWeek(sets: SetLike[]): WeeklySetWindow[] {
  const acc = new Map<string, SetLike[]>();
  for (const s of sets) {
    const ts = num(s.started_at);
    if (ts === null) continue;
    const key = isoWeekKey(new Date(ts));
    let bucket = acc.get(key);
    if (!bucket) acc.set(key, (bucket = []));
    bucket.push(s);
  }
  return [...acc.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([week, weekSets]) => ({ week, sets: weekSets }));
}

// ---------------------------------------------------------------------------
// Weekly per-muscle volume vs landmarks

/** Landmark band for a weekly raw fractional-set count. Uses the upper MEV
 *  bound (the level a trained lifter should clear) and the lower MAV bound. */
export function bandFor(muscle: string, sets: number): MuscleWeeklyBand["band"] {
  const lm = VOLUME_LANDMARKS[muscle] ?? DEFAULT_LANDMARK;
  if (sets < lm.mev[1]) return "below-mev";
  if (sets < lm.mav[0]) return "mev-mav";
  if (sets <= lm.mrv) return "mav-mrv";
  return "above-mrv";
}

/** Per-muscle weekly raw fractional sets bucketed against MEV/MAV/MRV.
 *  Reuses weeklyMuscleSets (same normalized shares), adding band + sort. */
export function weeklyMuscleBands(weekSets: SetLike[]): MuscleWeeklyBand[] {
  return weeklyMuscleSets(weekSets)
    .sort((a, b) => (a.muscle < b.muscle ? -1 : a.muscle > b.muscle ? 1 : 0))
    .map((m) => ({
      muscle: m.muscle,
      sets: m.fractional_sets,
      band: bandFor(m.muscle, m.fractional_sets),
    }));
}

// ---------------------------------------------------------------------------
// Training level summary (stats page): per-muscle degree of training

/** Where a muscle's recent weekly volume sits relative to its MAV midpoint.
 *  `sessions` is the number of distinct sessions (within the window) that
 *  logged any set attributing to the muscle — set-level data, not an
 *  estimate. */
export interface MuscleTrainingLevel {
  muscle: string;
  /** Mean raw fractional sets per week over the window (0 if not trained). */
  weekly_sets: number;
  /** Number of weeks (within the window) the muscle got any volume. */
  weeks_trained: number;
  /** Distinct sessions (within the window) touching the muscle. */
  sessions: number;
  /** Mean raw fractional sets in the best week of the window. */
  peak_weekly_sets: number;
  /** MAV midpoint from the landmark table (fallback for unknown muscles). */
  mav_target: number;
  /** weekly_sets / mav_target — 0 when untrained. */
  level_ratio: number;
  level: "maintenance" | "developing" | "optimal" | "overreaching" | "untrained";
}

/** Best week's count for a muscle across the window's weeks (0 if never). */
function peakOf(weekly: number[]): number {
  return weekly.length === 0 ? 0 : Math.max(...weekly);
}

/**
 * Per-muscle "how hard is this being trained" over the last window (default
 * 4 weeks): mean weekly fractional sets vs the muscle's MAV midpoint, plus
 * frequency (weeks trained / sessions). Muscles never trained within the
 * window are reported as "untrained" when listed explicitly by the caller;
 * pass `allMuscles` to include them, omit it to keep only trained ones.
 */
export function trainingLevels(
  weeklyBands: MuscleWeeklyBand[][],
  options: {
    windowWeeks?: number;
    allMuscles?: string[];
    /** Set-level rows (started_at as epoch ms) for per-muscle session counts. */
    sets?: Array<SetLike & { started_at?: number | string | null }>;
    /** ISO week keys aligned with `weeklyBands` (from groupByWeek). */
    weekKeys?: string[];
  } = {},
): MuscleTrainingLevel[] {
  const windowWeeks = options.windowWeeks ?? TRAINING_LEVELS.WINDOW_WEEKS;
  const recent = weeklyBands.slice(-windowWeeks);
  const recentWeekKeys = options.weekKeys?.slice(-windowWeeks) ?? [];

  const acc = new Map<string, { weekly: number[] }>();
  for (let wi = 0; wi < recent.length; wi++) {
    for (const b of recent[wi]) {
      let entry = acc.get(b.muscle);
      if (!entry) acc.set(b.muscle, (entry = { weekly: [] }));
      entry.weekly[wi] = (entry.weekly[wi] ?? 0) + b.sets;
    }
  }
  // weekly[wi] is sparse — fill gaps with 0 so "weeks_trained" and the mean
  // divide by the full window, not just the weeks the muscle appeared.
  for (const entry of acc.values()) {
    for (let wi = 0; wi < recent.length; wi++) {
      if (entry.weekly[wi] === undefined) entry.weekly[wi] = 0;
    }
  }

  // Frequency: map each set's week → muscles → its session id. Only possible
  // when the caller supplies the underlying set rows; otherwise stays 0.
  const sessionIds = new Map<string, Set<number>>();
  if (options.sets) {
    const weekIndex = new Map(recentWeekKeys.map((k, i) => [k, i]));
    for (const s of options.sets) {
      const sid = int(s.session_id);
      const ts = num(s.started_at);
      if (sid === null || ts === null) continue;
      const wi = weekIndex.get(isoWeekKey(new Date(ts)));
      if (wi === undefined) continue;
      for (const c of contributionsOf(s)) {
        let set = sessionIds.get(c.muscle);
        if (!set) sessionIds.set(c.muscle, (set = new Set()));
        set.add(sid);
      }
    }
  }

  const keys = options.allMuscles
    ? [...new Set([...options.allMuscles, ...acc.keys()])]
    : [...acc.keys()];

  return keys.map((muscle) => {
    const entry = acc.get(muscle);
    const lm = VOLUME_LANDMARKS[muscle] ?? DEFAULT_LANDMARK;
    const mavTarget = (lm.mav[0] + lm.mav[1]) / 2;
    if (!entry) {
      return {
        muscle,
        weekly_sets: 0,
        weeks_trained: 0,
        sessions: 0,
        peak_weekly_sets: 0,
        mav_target: mavTarget,
        level_ratio: 0,
        level: "untrained" as const,
      };
    }
    const mean = entry.weekly.reduce((a, b) => a + b, 0) / recent.length;
    const ratio = mavTarget > 0 ? mean / mavTarget : 0;
    const band = TRAINING_LEVELS.BANDS.find((b) => ratio < b.max) ?? TRAINING_LEVELS.BANDS[TRAINING_LEVELS.BANDS.length - 1];
    return {
      muscle,
      weekly_sets: mean,
      weeks_trained: entry.weekly.filter((v) => v > 0).length,
      sessions: sessionIds.get(muscle)?.size ?? 0,
      peak_weekly_sets: peakOf(entry.weekly),
      mav_target: mavTarget,
      level_ratio: ratio,
      level: band.key,
    };
  });
}

// ---------------------------------------------------------------------------
// Session-level load (for ACWR + monotony)

export interface SessionLoad {
  session_id: number;
  /** Foster-style session load: Σ reps × RPE. Sets without RPE use RPE 10 —
   *  the conservative upper bound (Foster's sRPE assumes rated effort;
   *  unrated sets are treated as hardest). Callers wanting pure tonnage use
   *  the `tonnage` field instead. */
  load: number;
  tonnage: number;
}

/** Group sets into sessions and compute session loads. Sets without a
 *  session_id or valid reps are skipped. */
export function sessionLoads(sets: SetLike[]): SessionLoad[] {
  const bySession = new Map<number, SetLike[]>();
  for (const s of sets) {
    const sid = int(s.session_id);
    const reps = num(s.reps);
    if (sid === null || reps === null || reps <= 0) continue;
    let bucket = bySession.get(sid);
    if (!bucket) bySession.set(sid, (bucket = []));
    bucket.push(s);
  }
  return [...bySession.entries()]
    .sort(([a], [b]) => a - b)
    .map(([session_id, sessionSets]) => {
      let load = 0;
      let tonnage = 0;
      for (const s of sessionSets) {
        const reps = num(s.reps)!;
        const w = effectiveLoadKg(s);
        if (w !== null && w > 0) tonnage += w * reps;
        // Foster sRPE: reps × RPE; missing RPE → base 10 (conservative).
        const rir = rpeToRir(s.rpe);
        const rpe = rir === null ? 10 : 10 - rir;
        load += reps * rpe;
      }
      return { session_id, load, tonnage };
    });
}

// ---------------------------------------------------------------------------
// ACWR (rolling 7d / 28d) — descriptive trend metric only (THEORY.md §3.2)

export interface AcwrResult {
  acwr: number | null;
  acute: number;
  chronic: number;
  /** "ok" within [0.8, 1.5); "spike" ≥ 1.5. null when chronic is 0. */
  status: "ok" | "spike" | null;
}

/** Rolling ACWR over session loads: acute = last 7 days, chronic = mean
 *  weekly load over the last 28 days (acute window inclusive). */
export function acwr(sessions: Array<{ load: number; date: Date }>, now: Date): AcwrResult {
  const toMs = (d: Date) => d.getTime();
  const nowMs = toMs(now);
  const inWindow = (d: Date, days: number) => {
    const t = toMs(d);
    return t <= nowMs && t > nowMs - days * 86_400_000;
  };
  const acute = sessions.filter((s) => inWindow(s.date, 7)).reduce((a, s) => a + s.load, 0);
  const chronicWindow = sessions.filter((s) => inWindow(s.date, 28)).reduce((a, s) => a + s.load, 0);
  const chronic = chronicWindow / 4;
  if (chronic <= 0) return { acwr: null, acute, chronic: 0, status: null };
  const ratio = acute / chronic;
  return {
    acwr: ratio,
    acute,
    chronic,
    status: ratio >= DELOAD.ACWR_SPIKE ? "spike" : "ok",
  };
}

// ---------------------------------------------------------------------------
// Foster monotony & strain (THEORY.md §3.3)

export interface MonotonyResult {
  monotony: number | null;
  strain: number | null;
  n_sessions: number;
}

/** Weekly monotony = mean(sessionLoad) / sd(sessionLoad); strain = Σload ×
 *  monotony. Needs ≥ MIN_SESSIONS_FOR_MONOTONY sessions; sd = 0 → null. */
export function monotony(sessionLoadsWeek: number[]): MonotonyResult {
  const n = sessionLoadsWeek.length;
  if (n < 3) return { monotony: null, strain: null, n_sessions: n };
  const mean = sessionLoadsWeek.reduce((a, b) => a + b, 0) / n;
  const variance = sessionLoadsWeek.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (sd === 0) return { monotony: null, strain: null, n_sessions: n };
  const m = mean / sd;
  return {
    monotony: m,
    strain: mean * n * m,
    n_sessions: n,
  };
}

// ---------------------------------------------------------------------------
// Deload triggers (THEORY.md §3.4)

export interface DeloadCheck {
  suggest: boolean;
  /** Human-readable reasons (English, diagnostic — UI should prefer the
   *  structured fields below for i18n). */
  reasons: string[];
  /** Muscles over MRV for CONSECUTIVE_WEEKS_OVER_MRV weeks in a row. */
  overMrvMuscles: string[];
  /** True when the current ACWR ≥ spike threshold. */
  acwrSpike: boolean;
}

/** Deload suggested when: any muscle exceeded MRV for CONSECUTIVE_WEEKS_OVER_MRV
 *  weeks in a row (most recent weeks), or the current ACWR ≥ spike threshold. */
export function deloadCheck(
  weeklyBands: MuscleWeeklyBand[][],
  currentAcwr: AcwrResult | null,
): DeloadCheck {
  const reasons: string[] = [];
  const overMrvMuscles: string[] = [];

  if (weeklyBands.length >= DELOAD.CONSECUTIVE_WEEKS_OVER_MRV) {
    const recent = weeklyBands.slice(-DELOAD.CONSECUTIVE_WEEKS_OVER_MRV);
    const musclesOverMrv = recent.map((bands) =>
      bands.filter((b) => b.band === "above-mrv").map((b) => b.muscle),
    );
    const every = musclesOverMrv.every((m) => m.length > 0);
    if (every) {
      // intersect consecutive weeks: any muscle present in ALL of them
      const [first, ...rest] = musclesOverMrv;
      const persist = first.filter((m) => rest.every((week) => week.includes(m)));
      if (persist.length > 0) {
        overMrvMuscles.push(...persist);
        reasons.push(`over MRV for ${DELOAD.CONSECUTIVE_WEEKS_OVER_MRV} consecutive weeks: ${persist.join(", ")}`);
      }
    }
  }

  let acwrSpike = false;
  if (currentAcwr?.status === "spike") {
    acwrSpike = true;
    reasons.push(`ACWR ${currentAcwr.acwr} ≥ ${DELOAD.ACWR_SPIKE}`);
  }

  return { suggest: reasons.length > 0, reasons, overMrvMuscles, acwrSpike };
}
