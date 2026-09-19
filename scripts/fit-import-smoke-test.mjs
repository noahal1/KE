// Smoke-tests the Garmin .fit import logic (src/lib/fitImport.ts): enum
// resolution, name matching, grouping, and the SQL the commit path executes
// (against an in-memory SQLite with the real migrations + seed). Runs the
// TypeScript sources natively under Node's type-stripping (node ≥ 22.6),
// mirroring metrics-smoke-test.mjs.
//
//   node scripts/fit-import-smoke-test.mjs
//
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  humanizeEnumName,
  resolveExerciseName,
  matchExercise,
  guessEquipment,
  guessPattern,
  categoryForPattern,
  groupSetsByExercise,
  sortSets,
  toSqliteTimestamp,
} from "../src/lib/fitImport.ts";

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
// Enum resolution

t("humanize: snake_case → Title Case", () => {
  assert.equal(humanizeEnumName("barbell_bench_press"), "Barbell Bench Press");
  assert.equal(humanizeEnumName("incline_dumbbell_bench_press"), "Incline Dumbbell Bench Press");
});

t("humanize: drops NUL sentinel", () => {
  assert.equal(humanizeEnumName("deadlift\0garbage"), "Deadlift");
  assert.equal(humanizeEnumName("\0"), "");
});

t("resolve: bench_press 1 → Barbell Bench Press", () => {
  assert.equal(resolveExerciseName([0], [1]), "Barbell Bench Press");
});

t("resolve: squat 0 → resolves via squat table (leg_press)", () => {
  assert.equal(resolveExerciseName([28], [0]), "Leg Press");
});

t("resolve: scalar inputs work too", () => {
  assert.equal(resolveExerciseName(0, 1), "Barbell Bench Press");
});

t("resolve: unknown category → null", () => {
  assert.equal(resolveExerciseName([999], [0]), null);
  assert.equal(resolveExerciseName(null, null), null);
});

t("resolve: unknown subtype falls back to category name", () => {
  const name = resolveExerciseName([8], [12345]); // deadlift, bogus subtype
  assert.equal(name, "Deadlift");
});

// ---------------------------------------------------------------------------
// Library matching

const CATALOG = [
  { id: 1, slug: "bb-bench-press", name_en: "Barbell Bench Press", name_zh: "杠铃卧推" },
  { id: 2, slug: "bb-incline-bench-press", name_en: "Barbell Incline Bench Press", name_zh: "杠铃上斜卧推" },
  { id: 3, slug: "db-lateral-raise", name_en: "Dumbbell Lateral Raise", name_zh: "哑铃侧平举" },
  { id: 4, slug: "bb-conventional-deadlift", name_en: "Barbell Conventional Deadlift", name_zh: "杠铃传统硬拉" },
];

t("match: exact name", () => {
  assert.equal(matchExercise("Barbell Bench Press", CATALOG), 1);
});

t("match: word-order insensitive", () => {
  assert.equal(matchExercise("Incline Barbell Bench Press", CATALOG), 2);
  assert.equal(matchExercise("Lateral Raise Dumbbell", CATALOG), 3);
});

t("match: no match → null", () => {
  assert.equal(matchExercise("Total Gym Leg Press Thing", CATALOG), null);
  assert.equal(matchExercise("", CATALOG), null);
});

t("match: prefers closest word count among set-matches", () => {
  // "Bench Press" (2 words) should map to the 3-word exact-set entry, not
  // the 5-word incline variant, because both are word-set matches of
  // different sizes.
  const cat = [
    ...CATALOG,
    { id: 9, slug: "bench-press", name_en: "Bench Press", name_zh: "卧推" },
  ];
  assert.equal(matchExercise("Press Bench", cat), 9);
});

// ---------------------------------------------------------------------------
// Custom-exercise heuristics

t("guessEquipment", () => {
  assert.equal(guessEquipment("Barbell Hack Squat"), "barbell");
  assert.equal(guessEquipment("Dumbbell Hammer Curl"), "dumbbell");
  assert.equal(guessEquipment("Cable Triceps Pushdown"), "cable");
  assert.equal(guessEquipment("Smith Machine Row"), "smith");
  assert.equal(guessEquipment("Plank"), "bodyweight");
  assert.equal(guessEquipment("Abduction Machine"), "machine");
});

t("guessPattern", () => {
  assert.equal(guessPattern("Barbell Back Squat"), "squat");
  assert.equal(guessPattern("Romanian Deadlift"), "hinge");
  assert.equal(guessPattern("Seated Cable Row"), "pull");
  assert.equal(guessPattern("Barbell Bench Press"), "press");
  assert.equal(guessPattern("Bulgarian Split Squat"), "squat"); // squat wins over lunge keyword
  assert.equal(guessPattern("Plank"), "core");
});

t("categoryForPattern", () => {
  assert.equal(categoryForPattern("press"), "compound");
  assert.equal(categoryForPattern("core"), "isolation");
});

// ---------------------------------------------------------------------------
// Grouping + sorting

const mk = (name, weightKg, reps, minutes) => ({
  name,
  weightKg,
  reps,
  startTime: minutes != null ? new Date(Date.UTC(2026, 8, 14, 18, minutes)) : null,
});

t("group: consecutive same-exercise sets merge", () => {
  const groups = groupSetsByExercise([
    mk("Bench Press", 60, 10, 0),
    mk("Bench Press", 60, 9, 3),
    mk("Row", 50, 10, 7),
    mk("Bench Press", 60, 8, 11), // superset → separate group
  ]);
  assert.deepEqual(groups.map((g) => [g.name, g.sets.length]), [
    ["Bench Press", 2],
    ["Row", 1],
    ["Bench Press", 1],
  ]);
});

t("group: empty list", () => {
  assert.deepEqual(groupSetsByExercise([]), []);
});

t("sort: by start time, nulls keep file order last", () => {
  const sorted = sortSets([
    mk("C", 10, 5, 5),
    mk("A", 10, 5, null),
    mk("B", 10, 5, 1),
    mk("D", 10, 5, null),
  ]);
  assert.deepEqual(sorted.map((s) => s.name), ["B", "C", "A", "D"]);
});

// ---------------------------------------------------------------------------
// Timestamp helper

t("toSqliteTimestamp formats UTC", () => {
  const d = new Date(Date.UTC(2026, 8, 14, 18, 30, 5));
  assert.equal(toSqliteTimestamp(d), "2026-09-14 18:30:05");
});

// ---------------------------------------------------------------------------
// Commit-path SQL against real schema (mirrors sql-smoke-test.cjs)

const root = path.join(import.meta.dirname, "..", "src-tauri");
const lib = fs.readFileSync(path.join(root, "src", "lib.rs"), "utf8");
const seed = fs.readFileSync(path.join(root, "seed", "exercises.sql"), "utf8");
function extractConst(name) {
  const re = new RegExp('const ' + name + '[^=]*= r#"([\\s\\S]*?)"#;', "m");
  const m = lib.match(re);
  if (!m) throw new Error("could not extract " + name);
  return m[1];
}

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
db.exec(extractConst("MIGRATION_1_SCHEMA"));
db.exec(seed);
db.exec(extractConst("MIGRATION_3_SESSION_EXERCISES"));

function q(label, sql, params = []) {
  try {
    const stmt = db.prepare(sql.replace(/\$(\d+)/g, "?"));
    const res = stmt.all(...params);
    console.log("OK   ", label, "->", Array.isArray(res) ? res.length + " rows" : "ok");
    return res;
  } catch (e) {
    failed++;
    console.log("FAIL ", label, "->", e.message);
    return null;
  }
}

q("import: catalog query", "SELECT id, slug, name_en, name_zh FROM exercises");

q("import: create custom exercise", `INSERT INTO exercises
  (slug, name_en, name_zh, equipment, category, pattern, primary_muscles, secondary_muscles, is_custom)
  VALUES ($1,$2,$3,$4,$5,$6,'','',1) RETURNING id`,
  ["garmin-test-1", "Bosu Ball Pec Fly", "Bosu Ball Pec Fly", "machine", "isolation", "press"]);

q("import: create session with timestamps", "INSERT INTO sessions (name, started_at, finished_at) VALUES ($1,$2,$3) RETURNING id",
  ["佳明训练 · 2026/9/14", "2026-09-14 18:00:00", "2026-09-14 19:00:00"]);

q("import: log set rows", `INSERT INTO set_logs
  (session_id, exercise_id, set_number, weight_kg, reps, rpe, is_warmup, is_pr)
  VALUES ($1,$2,$3,$4,$5,NULL,0,0) RETURNING id`, [1, 1, 1, 80, 10]);

q("import: session aggregates render in history", `SELECT s.*,
  (SELECT COUNT(*) FROM set_logs sl WHERE sl.session_id = s.id) AS set_count,
  (SELECT COALESCE(SUM(sl.weight_kg * sl.reps),0) FROM set_logs sl
    WHERE sl.session_id = s.id AND sl.is_warmup = 0) AS total_volume
  FROM sessions s WHERE s.finished_at IS NOT NULL`);

const fk = db.prepare("PRAGMA foreign_key_check").all();
if (fk.length !== 0) {
  failed++;
  console.log("FAIL  foreign_key_check ->", JSON.stringify(fk));
} else {
  console.log("OK    foreign_key_check clean");
}

console.log(failed === 0 ? `\nALL ${passed} CHECKS PASSED` : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);
