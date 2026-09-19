// Fatigue-layer text report over a synthetic 5-week training block
// (THEORY.md §5.3 P2: "脚本输出文本报告供人工核对"). Exercises the full
// pipeline end-to-end: groupByWeek → weeklyMuscleBands → sessionLoads →
// acwr / monotony → deloadCheck. Deterministic (no randomness).
//
// NOTE: ACWR reads "spike" in the first 1–2 weeks because the synthetic
// block has no history before W34 — chronic load is built from partial data.
// Expected artifact of the demo data, not an algorithm bug.
//
//   node scripts/fatigue-report.mjs
//
import {
  groupByWeek, weeklyMuscleBands, sessionLoads, acwr, monotony, deloadCheck,
  rpeCoverage,
} from "../src/lib/metrics/index.ts";

// ---------------------------------------------------------------------------
// Synthetic block: PPL × 5 weeks (2026-08-17 .. 2026-09-14, Mon starts),
// volume ramps weekly so the final weeks push muscles past their landmarks.

const WEEK_MONDAYS = [
  "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14",
];
const NOW = new Date("2026-09-16T12:00:00Z"); // mid final week

// [name, primary, secondary, baseSets, extraSetsPerWeek, weight, reps, rpeBase]
const DAYS = [
  {
    name: "Push", weekday: 0, // Monday
    ex: [
      ["Bench Press", "chest", "triceps,shoulders", 4, 0, 100, 8, 7],
      ["Incline Bench", "chest", "shoulders", 3, 1, 70, 10, 7],
      ["Cable Fly", "chest", "", 3, 2, 25, 12, 8],
      ["Overhead Press", "shoulders", "triceps", 3, 0, 50, 8, 8],
      ["Lateral Raise", "shoulders", "", 3, 1, 10, 15, 8],
      ["Triceps Pushdown", "triceps", "", 3, 1, 30, 12, 8],
    ],
  },
  {
    name: "Pull", weekday: 2, // Wednesday
    ex: [
      ["Barbell Row", "lats", "upper-back,biceps", 4, 0, 80, 8, 7],
      ["Pull-up", "lats", "upper-back", 3, 1, 0, 10, 8],
      ["Face Pull", "upper-back", "", 3, 1, 25, 15, 7],
      ["Barbell Curl", "biceps", "", 3, 1, 30, 10, 8],
      ["Shrug", "traps", "", 3, 0, 90, 12, 7],
    ],
  },
  {
    name: "Legs", weekday: 4, // Friday
    ex: [
      ["Back Squat", "quads", "glutes", 4, 0, 120, 6, 8],
      ["Romanian Deadlift", "hamstrings", "glutes,lower-back", 3, 0, 90, 8, 7],
      ["Leg Press", "quads", "", 3, 1, 180, 10, 8],
      ["Leg Extension", "quads", "", 4, 3, 50, 12, 9],
      ["Leg Curl", "hamstrings", "", 3, 1, 45, 12, 8],
      ["Calf Raise", "calves", "", 4, 0, 80, 15, 7],
      ["Weighted Crunch", "abs", "", 3, 1, 10, 15, 7],
    ],
  },
];

// Every 5th set skips RPE (exercises imputation + coverage flagging).
function rpeFor(globalSetIndex, rpeBase, week) {
  if (globalSetIndex % 5 === 4) return null;
  return Math.min(10, rpeBase + week);
}

let sessionId = 0;
let setIndex = 0;
const sets = [];
const sessionMeta = []; // { id, name, date }

WEEK_MONDAYS.forEach((monday, week) => {
  for (const day of DAYS) {
    const date = new Date(`${monday}T18:00:00Z`);
    date.setUTCDate(date.getUTCDate() + day.weekday);
    const id = ++sessionId;
    sessionMeta.push({ id, name: day.name, date });
    for (const [name, primary, secondary, baseSets, extra, weight, reps, rpeBase] of day.ex) {
      const nSets = baseSets + extra * week;
      for (let s = 0; s < nSets; s++) {
        sets.push({
          session_id: id,
          weight_kg: weight,
          reps: reps - (s % 3), // 8,7,6… / 12,11,10… rotation
          rpe: rpeFor(setIndex, rpeBase, week),
          is_warmup: 0,
          primary_muscles: primary,
          secondary_muscles: secondary,
          started_at: date.getTime(),
        });
        setIndex++;
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Pipeline

const weeks = groupByWeek(sets);
const loads = sessionLoads(sets);
const loadById = new Map(loads.map((l) => [l.session_id, l.load]));

const weeklyBands = weeks.map((w) => weeklyMuscleBands(w.sets));
const weeklyLoads = weeks.map((w) => {
  const ids = new Set(w.sets.map((s) => s.session_id));
  return [...ids].map((id) => loadById.get(id) ?? 0);
});

// ---------------------------------------------------------------------------
// Rendering

const MUSCLE_ZH = {
  chest: "胸", lats: "背阔肌", "upper-back": "上背", shoulders: "三角肌",
  biceps: "肱二头", triceps: "肱三头", forearms: "前臂", quads: "股四头",
  hamstrings: "腘绳肌", glutes: "臀", adductors: "内收肌", calves: "小腿",
  abs: "腹肌", obliques: "腹斜", core: "核心", traps: "斜方肌", "lower-back": "下背",
};
const BAND_LABEL = {
  "below-mev": "低于MEV",
  "mev-mav": "MEV~MAV",
  "mav-mrv": "MAV~MRV",
  "above-mrv": "超过MRV!",
};
const MRV = {
  chest: 22, lats: 26, "upper-back": 26, shoulders: 26, biceps: 26, triceps: 24,
  traps: 20, quads: 20, hamstrings: 20, glutes: 16, calves: 20, abs: 24,
  "lower-back": 16,
};

function bar(sets, mrv) {
  const n = Math.max(0, Math.min(10, Math.round((sets / mrv) * 10)));
  return "█".repeat(n) + "░".repeat(10 - n);
}

const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

console.log(`FitPlan 疲劳报告 — 合成 5 周训练块(PPL × 5,W34–W38)`);
console.log(`基线:每周有效组(归一化分摊,1 组 = 1 份)│ 时间:ISO 周,周一为首日`);
console.log(`RPE 覆盖率: ${rpeCoverage(sets).n_with_rpe}/${rpeCoverage(sets).n_total} 组记录了 RPE\n`);

weeks.forEach((w, i) => {
  const end = new Date(`${WEEK_MONDAYS[i]}T18:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6); // Sunday of that week
  const a = acwr(sessionMeta.filter((s) => s.date <= end).map((s) => ({ load: loadById.get(s.id) ?? 0, date: s.date })), end);
  const m = monotony(weeklyLoads[i]);
  const bands = weeklyBands[i];

  console.log(`━━ ${w.week}(${i + 1}/5 周)`);
  for (const b of bands) {
    const mrv = MRV[b.muscle] ?? 20;
    console.log(
      `   ${MUSCLE_ZH[b.muscle] ?? b.muscle}`.padEnd(8, "　") +
        `${fmt1(b.sets).padStart(5)} 组  ${bar(b.sets, mrv)}  ${BAND_LABEL[b.band]}`,
    );
  }
  const acwrTxt = a.acwr === null ? "无慢性基线" : `${fmt1(a.acwr)}(${a.status === "spike" ? "尖峰!" : "正常"})`;
  const monTxt = m.monotony === null ? "样本不足" : `${fmt1(m.monotony)}`;
  const strainTxt = m.strain === null ? "-" : fmt1(m.strain);
  console.log(`   会话 ${weeklyLoads[i].length} 次 │ ACWR ${acwrTxt} │ 单调性 ${monTxt} │ 应激 ${strainTxt}\n`);
});

const lastAcwr = acwr(
  sessionMeta.map((s) => ({ load: loadById.get(s.id) ?? 0, date: s.date })),
  NOW,
);
const deload = deloadCheck(weeklyBands, lastAcwr);
console.log(`━━ Deload 建议(截至 ${NOW.toISOString().slice(0, 10)})`);
if (deload.suggest) {
  console.log(`   ⚠ 建议减载周(容量 ×${0.5},强度 −10%):`);
  for (const r of deload.reasons) console.log(`   - ${r}`);
} else {
  console.log(`   无触发:各肌群未连续 2 周超过 MRV,ACWR 正常。`);
}
