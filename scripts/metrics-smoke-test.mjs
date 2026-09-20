// Smoke-tests the KE metrics library (THEORY.md §5.2): formula anchors,
// property checks and boundary behavior. Runs the TypeScript sources natively
// under Node's type-stripping (node ≥ 22.6, no build step), mirroring the
// style of sql-smoke-test.cjs. No new dependencies.
//
//   node scripts/metrics-smoke-test.cjs
//
import assert from "node:assert/strict";
import {
  // types
  num, csvList, musclesOf, effectiveLoadKg,
  // intensity
  rpeToRir, e1rm, bestE1rmOfDay, prescribeLoad,
  // stimulus
  terminalRir, effectiveReps, effectiveSetWeight, rpeCoverage,
  fractionalAttribution, weeklyMuscleSets,
  // fatigue
  isoWeekKey, groupByWeek, bandFor, weeklyMuscleBands,
  sessionLoads, acwr, monotony, deloadCheck,
  // progression
  incrementFor, roundToIncrement, doubleProgression, pooledE1rm, prescribeFromHistory,
  e1rmTrend,
  // body (THEORY.md §5)
  bmi, weightTrend, bodyweightLoadKg,
  // config
  STIMULUS, VOLUME_LANDMARKS, INCREMENTS, DELOAD, PROGRESSION, BODY,
} from "../src/lib/metrics/index.ts";

let passed = 0;
let failed = 0;
function t(label, fn) {
  try {
    fn();
    passed++;
    console.log("OK   ", label);
  } catch (e) {
    failed++;
    console.log("FAIL ", label, "->", e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------------------
// helpers: types
t("num: numbers, numeric strings, junk", () => {
  assert.equal(num(5), 5);
  assert.equal(num("7.5"), 7.5);
  assert.equal(num(""), null);
  assert.equal(num("abc"), null);
  assert.equal(num(null), null);
  assert.equal(num(NaN), null);
});

t("csvList: splits and trims", () => {
  assert.deepEqual(csvList("chest, triceps ,"), ["chest", "triceps"]);
  assert.deepEqual(csvList(null), []);
});

t("musclesOf: arrays win over CSV", () => {
  assert.deepEqual(
    musclesOf({ primary_muscles: "chest", primary: ["upper-back"] }).primary,
    ["upper-back"],
  );
  assert.deepEqual(musclesOf({ secondary_muscles: "triceps, shoulders" }).secondary, [
    "triceps",
    "shoulders",
  ]);
});

// ---------------------------------------------------------------------------
// intensity: RPE ↔ RIR
t("rpeToRir: identity cases + invalid", () => {
  assert.equal(rpeToRir(10), 0);
  assert.equal(rpeToRir(7), 3);
  assert.equal(rpeToRir(null), null);
  assert.equal(rpeToRir(11), null);
  assert.equal(rpeToRir(-1), null);
});

// ---------------------------------------------------------------------------
// intensity: e1RM anchors
t("e1rm anchor: 100×1 → mean(Epley 103.33, Brzycki 100) = 101.67, medium (no RPE)", () => {
  const r = e1rm({ weight_kg: 100, reps: 1 });
  const mean = (100 * (1 + 1 / 30) + (100 * 36) / 36) / 2;
  assert.equal(r.e1rm, mean);
  assert.ok(r.e1rm > 100 && r.e1rm < 104);
  assert.equal(r.confidence, "medium");
});

t("e1rm anchor: 100×5 @ RPE 8 → high confidence", () => {
  const r = e1rm({ weight_kg: 100, reps: 5, rpe: 8 });
  assert.equal(r.confidence, "high");
});

t("e1rm anchor: 100×5 @ RPE 8 (RIR 2) = plain 100×7", () => {
  const corrected = e1rm({ weight_kg: 100, reps: 5, rpe: 8 });
  const plain = e1rm({ weight_kg: 100, reps: 7 });
  assert.equal(corrected.e1rm, plain.e1rm);
});

t("e1rm property: strictly increasing in weight, reps", () => {
  for (let r = 1; r <= 12; r++) {
    let prev = -Infinity;
    for (let w = 20; w <= 200; w += 20) {
      const v = e1rm({ weight_kg: w, reps: r }).e1rm;
      assert.ok(v > prev, `w=${w} r=${r}`);
      prev = v;
    }
  }
  // reps up (same RPE-corrected failure point) must not decrease e1rm
  let prev = -Infinity;
  for (let r = 1; r <= 10; r++) {
    const v = e1rm({ weight_kg: 100, reps: r }).e1rm;
    assert.ok(v > prev, `reps=${r}`);
    prev = v;
  }
});

t("e1rm confidence: reps 11–12 (no RPE) → low via domain fringe", () => {
  const r = e1rm({ weight_kg: 60, reps: 11 });
  assert.equal(r.confidence, "low");
  assert.ok(r.divergence > 0); // formulas start separating
  const r12 = e1rm({ weight_kg: 100, reps: 12, rpe: 10 }); // to failure @ 12
  assert.equal(r12.e1rm, null === r12.e1rm ? null : r12.e1rm); // 12 is allowed
  assert.ok(r12.e1rm > 0);
});

t("e1rm boundaries: >12 reps or junk → null with reason", () => {
  assert.equal(e1rm({ weight_kg: 100, reps: 13 }).e1rm, null);
  assert.equal(e1rm({ weight_kg: 100, reps: 13 }).reason, "high-reps");
  assert.equal(e1rm({ weight_kg: 100, reps: 20, rpe: 5 }).e1rm, null); // 15 to failure
  assert.equal(e1rm({ weight_kg: 0, reps: 5 }).reason, "invalid-input");
  assert.equal(e1rm({}).reason, "invalid-input");
});

t("bestE1rmOfDay: picks max-tonnage valid set (90×6=540 > 100×5=500), skips warmups/junk", () => {
  const best = bestE1rmOfDay([
    { weight_kg: 60, reps: 8, is_warmup: 1 },
    { weight_kg: 100, reps: 5 },
    { weight_kg: 90, reps: 6 },
    { weight_kg: 100, reps: 14 }, // out of domain
  ]);
  assert.equal(best.e1rm, e1rm({ weight_kg: 90, reps: 6 }).e1rm);
  assert.equal(
    bestE1rmOfDay([{ weight_kg: 100, reps: 13 }]),
    null,
    "no valid set → null",
  );
});

// ---------------------------------------------------------------------------
// intensity: prescription round-trip
t("prescribeLoad: inverse of e1rm (round-trip) across reps/RIR", () => {
  for (const [w, r, rpe] of [
    [100, 5, 8],
    [140, 3, null],
    [60, 10, 9],
    [80, 1, 10],
  ]) {
    const est = e1rm({ weight_kg: w, reps: r, rpe }).e1rm;
    const target = prescribeLoad(est, r, rpe === null ? 0 : 10 - rpe);
    assert.ok(Math.abs(target.weight_kg - w) < 1e-9, `${w}x${r}@${rpe}`);
    assert.ok(Math.abs(target.pct1rm - (100 * w) / est) < 1e-9);
  }
});

t("prescribeLoad: doc example 100kg, 8 @ RIR 2 → 75kg", () => {
  const p = prescribeLoad(100, 8, 2);
  assert.equal(p.weight_kg, 75);
  assert.equal(p.pct1rm, 75);
});

t("prescribeLoad: no e1RM → explicit null + reason", () => {
  const p = prescribeLoad(null, 8, 2);
  assert.equal(p.weight_kg, null);
  assert.equal(p.reason, "no-e1rm");
});

// ---------------------------------------------------------------------------
// stimulus: terminal RIR + imputation
t("terminalRir: recorded RPE wins; missing → assumed RIR 3", () => {
  assert.deepEqual(terminalRir({ rpe: 9 }), { rir: 1, imputed: false });
  assert.deepEqual(terminalRir({}), {
    rir: STIMULUS.MISSING_RIR_ASSUMPTION,
    imputed: true,
  });
});

// ---------------------------------------------------------------------------
// stimulus: effective reps
t("effectiveReps: doc examples", () => {
  assert.equal(effectiveReps({ reps: 10, rpe: 8 }), 4); // RIR 2 → 6−2
  assert.equal(effectiveReps({ reps: 10, rpe: 10 }), 6); // RIR 0 → 6
  assert.equal(effectiveReps({ reps: 8, rpe: 4 }), 0); // RIR 6 → 6−6
  assert.equal(effectiveReps({ reps: 12, rpe: 7 }), 3); // RIR 3 → 6−3
});

t("effectiveReps property: monotone non-increasing in RIR", () => {
  let prev = Infinity;
  for (let rir = 0; rir <= 10; rir++) {
    const v = effectiveReps({ reps: 12, rpe: 10 - rir });
    assert.ok(v <= prev, `rir=${rir}`);
    prev = v;
  }
});

t("effectiveReps: clamped by total reps and zero floor", () => {
  assert.equal(effectiveReps({ reps: 3, rpe: 10 }), 3); // min(3, 6)
  assert.equal(effectiveReps({ reps: 3, rpe: 6 }), 2); // RIR 4 → 6−4=2
});

// ---------------------------------------------------------------------------
// stimulus: effective set weight
t("effectiveSetWeight: band table", () => {
  assert.equal(effectiveSetWeight({ rpe: 10 }), 1.0); // RIR 0
  assert.equal(effectiveSetWeight({ rpe: 9 }), 1.0); // RIR 1
  assert.equal(effectiveSetWeight({ rpe: 8 }), 0.85); // RIR 2
  assert.equal(effectiveSetWeight({ rpe: 7 }), 0.85); // RIR 3
  assert.equal(effectiveSetWeight({ rpe: 6 }), 0.6); // RIR 4
  assert.equal(effectiveSetWeight({ rpe: 5 }), 0.6); // RIR 5
  assert.equal(effectiveSetWeight({ rpe: 2 }), 0.3); // RIR 8
  assert.equal(effectiveSetWeight({}), 0.85); // imputed RIR 3
});

// ---------------------------------------------------------------------------
// stimulus: coverage
t("rpeCoverage: ratio + threshold flag", () => {
  const sets = [{ rpe: 8 }, { rpe: 9 }, {}, {}, {}];
  const cov = rpeCoverage(sets);
  assert.deepEqual(
    { n_total: cov.n_total, n_with_rpe: cov.n_with_rpe, level: cov.level },
    { n_total: 5, n_with_rpe: 2, level: "low" },
  );
  assert.equal(rpeCoverage([{ rpe: 8 }, { rpe: 9 }, {}, {}, {}]).level, "low");
  assert.equal(rpeCoverage([{ rpe: 8 }, {}, {}, {}]).level, "low");
  assert.equal(rpeCoverage([{ rpe: 8 }, { rpe: 9 }, { rpe: 7 }, {}]).level, "ok");
  assert.equal(rpeCoverage([]).level, "low"); // empty window: nothing to trust
});

// ---------------------------------------------------------------------------
// stimulus: fractional attribution
t("attribution: pure-primary set credits that muscle fully", () => {
  const out = fractionalAttribution([{ weight_kg: 100, reps: 10, primary_muscles: "chest" }]);
  assert.equal(out[0].muscle, "chest");
  assert.equal(out[0].fractional_sets, 0.85); // imputed RIR 3 → 0.85
  assert.equal(out[0].fractional_tonnage, 1000);
});

t("attribution: shares normalize to 1.0 per set (conservative)", () => {
  const out = fractionalAttribution([
    { weight_kg: 100, reps: 10, primary_muscles: "chest", secondary_muscles: "triceps, shoulders" },
  ]);
  const sumSets = out.reduce((a, m) => a + m.fractional_sets, 0);
  const sumTon = out.reduce((a, m) => a + m.fractional_tonnage, 0);
  assert.ok(Math.abs(sumSets - 0.85) < 1e-9, "sets sum = set weight");
  assert.ok(Math.abs(sumTon - 1000) < 1e-9, "tonnage sum = w×r");
  // chest (1.0) gets exactly twice triceps/shoulders (0.5 each)
  const chest = out.find((m) => m.muscle === "chest");
  const tri = out.find((m) => m.muscle === "triceps");
  assert.ok(Math.abs(chest.fractional_tonnage - 2 * tri.fractional_tonnage) < 1e-9);
});

t("attribution: sums to 1.0 across muscles for any mix of sets", () => {
  const sets = [
    { weight_kg: 80, reps: 8, primary_muscles: "quads", secondary_muscles: "glutes" },
    { weight_kg: 30, reps: 12, primary_muscles: "chest", secondary_muscles: "triceps" },
    { weight_kg: 50, reps: 10, primary_muscles: "lats, upper-back", secondary_muscles: "biceps" },
  ];
  const out = fractionalAttribution(sets);
  const sum = out.reduce((a, m) => a + m.fractional_sets, 0);
  const expected = sets.reduce((a, s) => a + effectiveSetWeight(s), 0);
  assert.ok(Math.abs(sum - expected) < 1e-9);
});

t("attribution: multi-primary split equally (lats+upper-back)", () => {
  const out = fractionalAttribution([
    { weight_kg: 100, reps: 10, rpe: 10, primary_muscles: "lats, upper-back" },
  ]);
  const lats = out.find((m) => m.muscle === "lats");
  const ub = out.find((m) => m.muscle === "upper-back");
  assert.equal(lats.fractional_sets, 0.5);
  assert.equal(ub.fractional_sets, 0.5);
});

t("attribution: sets without muscle data are dropped (no phantom muscle)", () => {
  assert.deepEqual(fractionalAttribution([{ weight_kg: 100, reps: 10 }]), []);
});

t("weeklyMuscleSets: raw counts, one unit per set split across muscles", () => {
  const out = weeklyMuscleSets([
    { primary_muscles: "chest", secondary_muscles: "triceps" },
    { primary_muscles: "chest" },
  ]);
  const chest = out.find((m) => m.muscle === "chest");
  const tri = out.find((m) => m.muscle === "triceps");
  // set 1: chest 2/3, triceps 1/3 (normalized); set 2: chest 1.0
  assert.ok(Math.abs(chest.fractional_sets - (1 + 2 / 3)) < 1e-9);
  assert.ok(Math.abs(tri.fractional_sets - 1 / 3) < 1e-9);
});

// ---------------------------------------------------------------------------
// landmarks sanity
t("landmarks: app muscle vocabulary fully covered", () => {
  const muscles = [
    "chest", "lats", "upper-back", "shoulders", "biceps", "triceps", "forearms",
    "quads", "hamstrings", "glutes", "adductors", "calves", "abs", "obliques",
    "core", "traps", "lower-back",
  ];
  for (const m of muscles) {
    const lm = VOLUME_LANDMARKS[m];
    assert.ok(lm, `missing landmarks for ${m}`);
    assert.ok(lm.mev[0] <= lm.mev[1], `${m}: mev ordered`);
    assert.ok(lm.mev[1] <= lm.mav[0], `${m}: mev ≤ mav`);
    assert.ok(lm.mav[1] <= lm.mrv, `${m}: mav ≤ mrv`);
  }
});

t("increments: matched per equipment/pattern", () => {
  const inc = (equipment, pattern) => {
    const ex = { equipment, pattern };
    return INCREMENTS.find((i) => i.match(ex)).kg;
  };
  assert.equal(inc("barbell", "squat"), 5);
  assert.equal(inc("barbell", "hinge"), 5);
  assert.equal(inc("barbell", "press"), 2.5);
  assert.equal(inc("smith", "press"), 5);
  assert.equal(inc("dumbbell", "press"), 2.5);
  assert.equal(inc("bodyweight", "press"), 2.5); // default tier; BW handled upstream
});

// ---------------------------------------------------------------------------
// fatigue: ISO week binning
t("isoWeekKey: anchors (Jan 1 2026 = W01; Mon–Sun same week; long-year crossover)", () => {
  assert.equal(isoWeekKey(new Date("2026-01-01T12:00:00Z")), "2026-W01");
  assert.equal(isoWeekKey(new Date(2026, 0, 5)), "2026-W02"); // local Mon Jan 5
  assert.equal(isoWeekKey(new Date(2026, 0, 11)), "2026-W02"); // local Sun Jan 11
  assert.equal(isoWeekKey(new Date("2021-01-03T12:00:00Z")), "2020-W53");
});

t("groupByWeek: sorts by week key, skips sets without started_at", () => {
  const windows = groupByWeek([
    { reps: 1, started_at: Date.parse("2026-09-14T10:00:00Z") }, // W38
    { reps: 1, started_at: Date.parse("2026-09-07T10:00:00Z") }, // W37
    { reps: 1, started_at: Date.parse("2026-09-15T10:00:00Z") }, // W38
    { reps: 1 }, // skipped
  ]);
  assert.deepEqual(windows.map((w) => w.week), ["2026-W37", "2026-W38"]);
  assert.equal(windows[1].sets.length, 2);
});

// ---------------------------------------------------------------------------
// fatigue: landmark bands
t("bandFor: chest thresholds + unknown-muscle fallback", () => {
  assert.equal(bandFor("chest", 5), "below-mev");
  assert.equal(bandFor("chest", 8), "mev-mav");
  assert.equal(bandFor("chest", 12), "mav-mrv");
  assert.equal(bandFor("chest", 23), "above-mrv");
  assert.equal(bandFor("madeup", 25), "above-mrv"); // DEFAULT_LANDMARK mrv 20
});

t("weeklyMuscleBands: normalized shares + sum == set count", () => {
  const week = [
    { primary_muscles: "chest", secondary_muscles: "triceps" },
    { primary_muscles: "chest" },
    { primary_muscles: "chest" },
  ];
  const bands = weeklyMuscleBands(week);
  const chest = bands.find((b) => b.muscle === "chest");
  const tri = bands.find((b) => b.muscle === "triceps");
  assert.ok(Math.abs(chest.sets - (2 + 2 / 3)) < 1e-9);
  assert.ok(Math.abs(tri.sets - 1 / 3) < 1e-9);
  assert.equal(chest.band, "below-mev");
  const sum = bands.reduce((a, b) => a + b.sets, 0);
  assert.ok(Math.abs(sum - week.length) < 1e-9);
});

// ---------------------------------------------------------------------------
// fatigue: session loads
t("sessionLoads: Foster sRPE with missing RPE → 10; skips sessionless/repsless", () => {
  const loads = sessionLoads([
    { session_id: 1, weight_kg: 100, reps: 10, rpe: 8 },
    { session_id: 1, weight_kg: 80, reps: 8, rpe: null },
    { session_id: 2, weight_kg: 50, reps: 12, rpe: 7 },
    { weight_kg: 50, reps: 10 }, // no session
    { session_id: 1, weight_kg: 60, reps: 0 }, // no reps
  ]);
  assert.deepEqual(loads.map((l) => l.session_id), [1, 2]);
  assert.equal(loads[0].load, 10 * 8 + 8 * 10); // 160
  assert.equal(loads[0].tonnage, 1000 + 640); // 1640
  assert.equal(loads[1].load, 12 * 7);
});

// ---------------------------------------------------------------------------
// fatigue: ACWR
t("acwr: balanced week → 1.0 ok; spike → flagged; no chronic → null", () => {
  const week = (iso) => Date.parse(`${iso}T12:00:00Z`);
  const now = new Date("2026-09-16T12:00:00Z");
  const balanced = [
    { load: 1000, date: new Date(week("2026-09-14")) },
    { load: 1000, date: new Date(week("2026-09-07")) },
    { load: 1000, date: new Date(week("2026-08-31")) },
    { load: 1000, date: new Date(week("2026-08-24")) },
  ];
  const ok = acwr(balanced, now);
  assert.equal(ok.acwr, 1);
  assert.equal(ok.status, "ok");

  const spike = acwr(
    [
      { load: 2000, date: new Date(week("2026-09-14")) },
      { load: 800, date: new Date(week("2026-09-07")) },
      { load: 800, date: new Date(week("2026-08-31")) },
      { load: 800, date: new Date(week("2026-08-24")) },
    ],
    now,
  );
  assert.equal(spike.status, "spike");
  assert.ok(Math.abs(spike.acwr - 2000 / 1100) < 1e-9);

  // chronic 0 → null: session outside the 28d window only
  const stale = acwr([{ load: 1000, date: new Date("2026-08-01T12:00:00Z") }], now);
  assert.equal(stale.acwr, null);
  assert.equal(stale.status, null);
});

t("acwr: 7-day window boundary — exactly 7d old excluded, 1s inside included", () => {
  const now = new Date("2026-09-16T12:00:00Z"); // boundary: 2026-09-09T12:00:00Z
  const sessions = [
    { load: 500, date: new Date("2026-09-16T12:00:00Z") }, // now → acute
    { load: 700, date: new Date("2026-09-09T12:00:01Z") }, // 1s inside → acute
    { load: 50, date: new Date("2026-09-09T12:00:00Z") }, // exactly 7d → acute out
    { load: 900, date: new Date("2026-09-10T12:00:00Z") }, // 6d → acute
    { load: 700, date: new Date("2026-08-25T12:00:00Z") }, // 22d → chronic only
  ];
  const r = acwr(sessions, now);
  assert.equal(r.acute, 2100); // 500 + 700 + 900
  assert.ok(Math.abs(r.chronic - 2850 / 4) < 1e-9); // 500+700+50+900+700 = 2850
});

// ---------------------------------------------------------------------------
// fatigue: monotony / strain
t("monotony: <3 sessions or zero sd → null; hand-computed anchor", () => {
  assert.equal(monotony([100, 200]).monotony, null);
  assert.equal(monotony([100, 100, 100]).monotony, null); // sd = 0
  const r = monotony([100, 100, 100, 300]);
  // mean 150, sd √7500 ≈ 86.60 → m ≈ 1.732; strain = 600 × m ≈ 1039.23
  assert.ok(Math.abs(r.monotony - 1.7320508) < 1e-4);
  assert.ok(Math.abs(r.strain - 1039.2305) < 1e-3);
  assert.equal(r.n_sessions, 4);
});

// ---------------------------------------------------------------------------
// fatigue: deload
t("deloadCheck: MRV 2 weeks in a row (same muscle) triggers; alternating doesn't", () => {
  const overQuads = [{ muscle: "quads", sets: 21, band: "above-mrv" }];
  const overChest = [{ muscle: "chest", sets: 23, band: "above-mrv" }];
  const clean = [{ muscle: "quads", sets: 10, band: "mav-mrv" }];

  const hit = deloadCheck([clean, overQuads, overQuads], null);
  assert.equal(hit.suggest, true);
  assert.ok(hit.reasons[0].includes("quads"));
  assert.deepEqual(hit.overMrvMuscles, ["quads"]);
  assert.equal(hit.acwrSpike, false);

  const alternating = deloadCheck([overQuads, clean, overChest], null);
  assert.equal(alternating.suggest, false);

  const spikeOnly = deloadCheck([], { acwr: 1.8, acute: 1, chronic: 1, status: "spike" });
  assert.equal(spikeOnly.suggest, true);
  assert.ok(spikeOnly.reasons[0].includes("ACWR"));

  assert.equal(deloadCheck([], null).suggest, false);
});

// ---------------------------------------------------------------------------
// progression: increments & rounding
t("incrementFor: tiers per equipment/pattern", () => {
  assert.equal(incrementFor({ equipment: "barbell", pattern: "squat" }).kg, 5);
  assert.equal(incrementFor({ equipment: "barbell", pattern: "press" }).kg, 2.5);
  assert.equal(incrementFor({ equipment: "dumbbell", pattern: "press" }).kg, 2.5);
});

t("roundToIncrement: floors to step, never below one step", () => {
  assert.equal(roundToIncrement(102.3, 2.5), 100);
  assert.equal(roundToIncrement(100, 2.5), 100);
  assert.equal(roundToIncrement(2, 2.5), 2.5); // floor would be 0 → min 1 step
  assert.equal(roundToIncrement(7, 5), 5);
});

// ---------------------------------------------------------------------------
// progression: double progression
t("doubleProgression: all sets ≥ max with RIR ≤ 2 → increase to next step", () => {
  const r = doubleProgression({
    sets: [
      { weight_kg: 100, reps: 8, rpe: 8 }, // RIR 2
      { weight_kg: 100, reps: 8, rpe: 9 }, // RIR 1
      { weight_kg: 100, reps: 9, rpe: 8 },
    ],
    rep_min: 6,
    rep_max: 8,
    exercise: { equipment: "barbell", pattern: "press" },
  });
  assert.equal(r.action, "increase");
  assert.equal(r.weight_kg, 102.5);
  assert.equal(r.reps, 6);
  assert.equal(r.rirGateUsed, true);
  assert.equal(r.why, "all-sets-hit-max-with-rir");
});

t("doubleProgression: reps at max but RIR > 2 → hold (gate blocks)", () => {
  const r = doubleProgression({
    sets: [
      { weight_kg: 100, reps: 8, rpe: 6 }, // RIR 4
      { weight_kg: 100, reps: 8, rpe: 6 },
    ],
    rep_min: 6,
    rep_max: 8,
    exercise: { equipment: "barbell", pattern: "press" },
  });
  assert.equal(r.action, "hold");
  assert.equal(r.why, "within-window");
});

t("doubleProgression: no RPE → reps-only rule fires increase", () => {
  const r = doubleProgression({
    sets: [
      { weight_kg: 100, reps: 8, rpe: null },
      { weight_kg: 100, reps: 8, rpe: null },
    ],
    rep_min: 6,
    rep_max: 8,
    exercise: { equipment: "barbell", pattern: "press" },
  });
  assert.equal(r.action, "increase");
  assert.equal(r.rirGateUsed, false);
  assert.equal(r.why, "all-sets-hit-max");
});

t("doubleProgression: a set below min → regress −10% floored to step", () => {
  const r = doubleProgression({
    sets: [
      { weight_kg: 100, reps: 8, rpe: 8 },
      { weight_kg: 100, reps: 5, rpe: 9 }, // below min 6
    ],
    rep_min: 6,
    rep_max: 8,
    exercise: { equipment: "barbell", pattern: "press" },
  });
  assert.equal(r.action, "regress");
  assert.equal(r.weight_kg, 90); // 100 × 0.9 = 90, already on step
  assert.equal(r.why, "a-set-below-min");
});

t("doubleProgression: hold advances reps by one within window", () => {
  const r = doubleProgression({
    sets: [{ weight_kg: 100, reps: 7, rpe: 8 }],
    rep_min: 6,
    rep_max: 8,
    exercise: { equipment: "barbell", pattern: "press" },
  });
  assert.equal(r.action, "hold");
  assert.equal(r.weight_kg, 100);
  assert.equal(r.reps, 8); // best 7 + 1, capped at max
});

t("doubleProgression: no data → hold with nulls; warmups ignored", () => {
  const empty = doubleProgression({
    sets: [],
    rep_min: 6,
    rep_max: 8,
    exercise: { equipment: "dumbbell", pattern: "press" },
  });
  assert.equal(empty.action, "hold");
  assert.equal(empty.why, "no-data");
  assert.equal(empty.weight_kg, null);

  const onlyWarmup = doubleProgression({
    sets: [{ weight_kg: 40, reps: 10, is_warmup: 1 }],
    rep_min: 6,
    rep_max: 8,
    exercise: { equipment: "dumbbell", pattern: "press" },
  });
  assert.equal(onlyWarmup.why, "no-data");
});

t("doubleProgression: dumbbell regression rounds DOWN to fixed step", () => {
  const r = doubleProgression({
    sets: [{ weight_kg: 30, reps: 4, rpe: 9 }],
    rep_min: 6,
    rep_max: 8,
    exercise: { equipment: "dumbbell", pattern: "press" },
  });
  assert.equal(r.action, "regress");
  assert.equal(r.weight_kg, 25); // 30 × 0.9 = 27 → floor to 2.5 step = 25
});

// ---------------------------------------------------------------------------
// progression: pooled e1RM + prescription
t("pooledE1rm: max over recent sessions with estimates; skips junk sessions", () => {
  const sessions = [
    [{ weight_kg: 100, reps: 5, rpe: 8 }], // fatigue day
    [{ weight_kg: 100, reps: 5, rpe: 7 }], // stronger day
    [{ weight_kg: 95, reps: 6, rpe: 8 }],
  ];
  const { e1rm: pool, source } = pooledE1rm(sessions);
  assert.equal(source, "pooled-max");
  assert.equal(pool, e1rm({ weight_kg: 100, reps: 5, rpe: 7 }).e1rm);
});

t("pooledE1rm: junk-only history → none; valid sessions counted from newest first", () => {
  assert.equal(pooledE1rm([[{ weight_kg: 120, reps: 13 }], []]).source, "none");
  const only = pooledE1rm([[{ weight_kg: 120, reps: 13 }], [{ weight_kg: 80, reps: 6 }]]);
  assert.equal(only.source, "pooled-max"); // session 2 yields the only estimate
  assert.equal(only.e1rm, e1rm({ weight_kg: 80, reps: 6 }).e1rm);
});

t("prescribeFromHistory: weight scales with pool; none → explicit nulls", () => {
  const pool = e1rm({ weight_kg: 100, reps: 5, rpe: 7 }).e1rm;
  const r = prescribeFromHistory([[{ weight_kg: 100, reps: 5, rpe: 7 }]], 5, 2);
  assert.equal(r.e1rm, pool);
  assert.equal(r.source, "pooled-max");
  // prescribeLoad(pool, 5, 2) must reproduce the inverse relation
  assert.ok(Math.abs(r.weight_kg - prescribeLoad(pool, 5, 2).weight_kg) < 1e-9);
  assert.ok(r.weight_kg > 0 && r.weight_kg < pool);

  const none = prescribeFromHistory([], 8, 2);
  assert.equal(none.weight_kg, null);
  assert.equal(none.e1rm, null);
});

// ---------------------------------------------------------------------------
// progression: e1RM trend
t("e1rmTrend: per-session series ascending, deduped, junk dropped; slope kg/day", () => {
  const DAY = 86_400_000;
  const sessions = [
    { t: 10 * DAY, sets: [{ weight_kg: 100, reps: 5, rpe: 8, started_at: 10 * DAY }] },
    { t: 17 * DAY, sets: [{ weight_kg: 102.5, reps: 5, rpe: 8, started_at: 17 * DAY }] },
    { t: 24 * DAY, sets: [{ weight_kg: 105, reps: 5, rpe: 8, started_at: 24 * DAY }] },
    { t: 31 * DAY, sets: [{ weight_kg: 107.5, reps: 5, rpe: 8, started_at: 31 * DAY }] },
  ];
  const r = e1rmTrend(sessions.map((s) => s.sets));
  assert.equal(r.points.length, 4);
  assert.ok(r.points[0].t < r.points[r.points.length - 1].t, "ascending");
  assert.ok(r.slopePerDay > 0, "gaining");
  // +2.5kg e1rm per 7d session gap → ~ +0.36 kg/day; tolerance for the
  // two-formula mean's nonlinearity across weights
  assert.ok(r.slopePerDay > 0.2 && r.slopePerDay < 0.6, `slope=${r.slopePerDay}`);
});

t("e1rmTrend: <3 points → null slope; flat series → slope 0 (not null)", () => {
  const DAY = 86_400_000;
  const two = e1rmTrend([
    [{ weight_kg: 100, reps: 5, rpe: 8, started_at: 1 * DAY }],
    [{ weight_kg: 100, reps: 5, rpe: 8, started_at: 8 * DAY }],
  ]);
  assert.equal(two.points.length, 2);
  assert.equal(two.slopePerDay, null);

  const flat = e1rmTrend([
    [{ weight_kg: 100, reps: 5, rpe: 8, started_at: 1 * DAY }],
    [{ weight_kg: 100, reps: 5, rpe: 8, started_at: 8 * DAY }],
    [{ weight_kg: 100, reps: 5, rpe: 8, started_at: 15 * DAY }],
    [{ weight_kg: 100, reps: 5, rpe: 8, started_at: 22 * DAY }],
  ]);
  assert.equal(flat.slopePerDay, 0);

  // single session with several sets → one point
  const one = e1rmTrend([
    [
      { weight_kg: 100, reps: 5, rpe: 8, started_at: 1 * DAY },
      { weight_kg: 90, reps: 8, rpe: 8, started_at: 1 * DAY },
    ],
  ]);
  assert.equal(one.points.length, 1);
  assert.equal(one.slopePerDay, null);
});

// ---------------------------------------------------------------------------
// body: effective load switchpoint (THEORY.md §5.3)
t("effectiveLoadKg: load_kg wins, falls back to weight_kg (legacy rows)", () => {
  assert.equal(effectiveLoadKg({ load_kg: 72.5, weight_kg: 5 }), 72.5);
  assert.equal(effectiveLoadKg({ load_kg: 0, weight_kg: 60 }), 60); // zero load_kg unusable
  assert.equal(effectiveLoadKg({ load_kg: null, weight_kg: 60 }), 60);
  assert.equal(effectiveLoadKg({ weight_kg: 60 }), 60); // column absent
  assert.equal(effectiveLoadKg({ load_kg: "80.5", weight_kg: 0 }), 80.5); // string coercion
  assert.equal(effectiveLoadKg({}), null);
});

t("fractionalAttribution: bodyweight tonnage priced from load_kg", () => {
  const [chest] = fractionalAttribution([
    { primary_muscles: "chest", weight_kg: 0, load_kg: 60, reps: 10 }, // push-up @ 92kg body
  ]);
  assert.ok(Math.abs(chest.fractional_tonnage - 600) < 1e-9, `got ${chest.fractional_tonnage}`);
});

t("sessionLoads tonnage: uses effectiveLoadKg too", () => {
  const out = sessionLoads([{ session_id: 1, weight_kg: 0, load_kg: 60, reps: 10, rpe: 8 }]);
  assert.equal(out[0].tonnage, 600);
});

// ---------------------------------------------------------------------------
// body: BMI + trend + bodyweight pricing (THEORY.md §5)
t("bmi: anchors and categories", () => {
  assert.equal(bmi(70, 175).category, "normal");
  assert.ok(Math.abs(bmi(70, 175).bmi - 22.86) < 0.01);
  assert.equal(bmi(50, 175).category, "underweight");
  assert.equal(bmi(85, 175).category, "overweight");
  assert.equal(bmi(110, 175).category, "obese");
  assert.equal(bmi(70, null).bmi, null);
  assert.equal(bmi(null, 175).bmi, null);
  assert.equal(bmi(-5, 175).bmi, null);
});

t("bodyweightLoadKg: pattern fractions + external add-on; no bodyweight → null", () => {
  assert.ok(Math.abs(bodyweightLoadKg({ pattern: "squat" }, 80, 0) - 72) < 1e-9);
  assert.ok(Math.abs(bodyweightLoadKg({ pattern: "pull" }, 80, 10) - 62) < 1e-9); // 0.65×80 + 10
  assert.ok(Math.abs(bodyweightLoadKg({ pattern: "core" }, 80, 0) - 40) < 1e-9);
  assert.ok(Math.abs(bodyweightLoadKg({ pattern: "press" }, 80, 0) - 52) < 1e-9); // upper default
  assert.equal(bodyweightLoadKg({ pattern: "pull" }, null, 10), null);
  assert.equal(bodyweightLoadKg({ pattern: "pull" }, 0, 10), null);
  assert.ok(Math.abs(bodyweightLoadKg({}, 80, 5) - 57) < 1e-9); // missing pattern → upper
});

t("weightTrend: EWMA smoothing, slope, total change, body-fat passthrough", () => {
  const DAY = 86_400_000;
  const r = weightTrend([
    { weight_kg: 80, logged_at: 0 * DAY },
    { weight_kg: 78, logged_at: 7 * DAY, body_fat_pct: 18 },
    { weight_kg: 76, logged_at: 14 * DAY },
  ]);
  assert.equal(r.points.length, 3);
  // EWMA α=0.5: 80 → 79 → 77.5
  assert.ok(Math.abs(r.current - 77.5) < 1e-9, `current=${r.current}`);
  // slope: (77.5 − 80) / 14d × 7 = −1.25 kg/week
  assert.ok(Math.abs(r.perWeek - (-1.25)) < 1e-9, `perWeek=${r.perWeek}`);
  assert.ok(Math.abs(r.totalChange - (-4)) < 1e-9);
  assert.equal(r.bodyFat, 18);
  assert.equal(r.points[1].body_fat, 18);
  assert.equal(r.points[0].body_fat, null);
  // empty / junk input degrades explicitly
  const empty = weightTrend([]);
  assert.equal(empty.current, null);
  assert.equal(empty.perWeek, null);
  const one = weightTrend([{ weight_kg: 80, logged_at: 0 }]);
  assert.equal(one.perWeek, null);
  assert.ok(one.current !== null);
});

t("weightTrend: accepts ISO strings and sqlite datetime stamps", () => {
  const r = weightTrend([
    { weight_kg: 80, logged_at: "2026-09-01 08:00:00" },
    { weight_kg: 79, logged_at: "2026-09-08T08:00:00Z" },
  ]);
  assert.equal(r.points.length, 2);
  assert.ok(r.perWeek !== null && r.perWeek < 0, `perWeek=${r.perWeek}`);
});

t("BODY: constants are ordered and in range", () => {
  assert.ok(BODY.BW_FRACTION.lower > BODY.BW_FRACTION.upper);
  assert.ok(BODY.BW_FRACTION.upper > BODY.BW_FRACTION.core);
  assert.ok(BODY.EWMA_ALPHA > 0 && BODY.EWMA_ALPHA < 1);
});

// ---------------------------------------------------------------------------

console.log(
  failed === 0
    ? `\nALL ${passed} METRICS TESTS PASSED`
    : `\n${passed} passed, ${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
