// Smoke-tests the FitPlan database layer: runs the real migrations + seed from
// src-tauri, then executes every SQL query the frontend uses (with $N params
// converted to ?) against an in-memory SQLite database.
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const root = path.join(__dirname, "..", "src-tauri");
const lib = fs.readFileSync(path.join(root, "src", "lib.rs"), "utf8");
const seed = fs.readFileSync(path.join(root, "seed", "exercises.sql"), "utf8");

// Extract raw string literals: const NAME...= r#"...."#;
function extractConst(name) {
  const re = new RegExp('const ' + name + '[^=]*= r#"([\\s\\S]*?)"#;', "m");
  const m = lib.match(re);
  if (!m) throw new Error("could not extract " + name);
  return m[1];
}

const schema = extractConst("MIGRATION_1_SCHEMA");
const sessionEx = extractConst("MIGRATION_3_SESSION_EXERCISES");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
db.exec(schema);
db.exec(seed);
db.exec(sessionEx);

const counts = db.prepare("SELECT (SELECT COUNT(*) FROM exercises) AS ex, (SELECT COUNT(*) FROM plans) AS p, (SELECT COUNT(*) FROM plan_days) AS d, (SELECT COUNT(*) FROM plan_exercises) AS pe, (SELECT COUNT(*) FROM session_exercises) AS se").get();
console.log("seeded:", JSON.stringify(counts));

let failures = 0;
function q(label, sql, params = []) {
  try {
    const converted = sql.replace(/\$(\d+)/g, "?");
    const stmt = db.prepare(converted);
    const res = stmt.all(...params);
    console.log("OK   ", label, "->", Array.isArray(res) ? res.length + " rows" : "ok");
    return res;
  } catch (e) {
    failures++;
    console.log("FAIL ", label, "->", e.message);
    return null;
  }
}

// ---- LibraryPage ----
q("library: all exercises", "SELECT * FROM exercises ORDER BY equipment, name_zh");

// ---- ExercisePicker ----
q("picker: all exercises", "SELECT * FROM exercises ORDER BY name_zh");

// ---- PlansPage ----
q("plans: list", `SELECT p.*,
  (SELECT COUNT(*) FROM plan_days d WHERE d.plan_id = p.id) AS day_count,
  (SELECT MAX(s.started_at) FROM sessions s
    JOIN plan_days d2 ON s.plan_day_id = d2.id
    WHERE d2.plan_id = p.id) AS last_workout
FROM plans p ORDER BY p.created_at DESC`);

// create a plan + days + 2 exercises
db.exec(`INSERT INTO plans (name) VALUES ('Test PPL');
INSERT INTO plan_days (plan_id, name, day_order) VALUES (1, 'Push', 0);
INSERT INTO plan_days (plan_id, name, day_order) VALUES (1, 'Pull', 1);
INSERT INTO plan_exercises (day_id, exercise_id, exercise_order) VALUES (1, 1, 0);
INSERT INTO plan_exercises (day_id, exercise_id, target_sets, rep_min, rep_max, rest_seconds, exercise_order) VALUES (1, 40, 4, 6, 8, 120, 1);`);

q("plans: duplicate copy-insert", `INSERT INTO plan_exercises (day_id, exercise_id, target_sets, rep_min, rep_max, rest_seconds, exercise_order, notes)
SELECT 2, exercise_id, target_sets, rep_min, rep_max, rest_seconds, exercise_order, notes
FROM plan_exercises WHERE day_id = 1 RETURNING id`);

// ---- PlanDetailPage ----
const dayIds = [1, 2];
const placeholders = dayIds.map((_, i) => `$${i + 1}`).join(",");
q("plan detail: exercises for days", `SELECT pe.*, e.name_en, e.name_zh, e.equipment FROM plan_exercises pe
  JOIN exercises e ON e.id = pe.exercise_id
  WHERE pe.day_id IN (${placeholders})
  ORDER BY pe.day_id, pe.exercise_order`, dayIds);
q("plan detail: count", "SELECT COUNT(*) AS c FROM plan_exercises WHERE day_id = $1", [1]);
q("plan detail: move exercise", "UPDATE plan_exercises SET exercise_order = exercise_order + $1 WHERE id = $2 RETURNING id", [1, 1]);

// ---- WorkoutPage ----
q("workout: day lookup", "SELECT * FROM plan_days WHERE id = $1", [1]);
q("workout: create session", "INSERT INTO sessions (plan_day_id, name) VALUES ($1,$2) RETURNING id", [1, "Push"]);
q("workout: prefill session exercises", `INSERT INTO session_exercises (session_id, exercise_id, exercise_order)
  SELECT $1, exercise_id, exercise_order FROM plan_exercises WHERE day_id = $2 RETURNING id`, [1, 1]);
q("workout: free session", "INSERT INTO sessions (name) VALUES ($1) RETURNING id", ["Free · 2026-09-14"]);

// ---- ActiveSessionPage ----
q("session: load session", "SELECT * FROM sessions WHERE id = $1", [1]);
q("session: exercise rows", `SELECT se.id, se.exercise_id, e.name_en, e.name_zh, e.equipment,
  pe.target_sets, pe.rep_min, pe.rep_max, pe.rest_seconds
  FROM session_exercises se
  JOIN exercises e ON e.id = se.exercise_id
  LEFT JOIN plan_days d ON d.id = (
    SELECT plan_day_id FROM sessions WHERE id = se.session_id
  )
  LEFT JOIN plan_exercises pe ON pe.day_id = d.id AND pe.exercise_id = se.exercise_id
  WHERE se.session_id = $1
  ORDER BY se.exercise_order`, [1]);
q("session: set logs", "SELECT * FROM set_logs WHERE session_id = $1 ORDER BY id", [1]);
q("session: count exercises", "SELECT COUNT(*) AS c FROM session_exercises WHERE session_id = $1", [1]);
q("session: prev best", `SELECT sl.weight_kg, sl.reps FROM set_logs sl
  JOIN sessions s ON s.id = sl.session_id
  WHERE sl.exercise_id = $1 AND sl.is_warmup = 0 AND s.id != $2 AND s.started_at < (
    SELECT started_at FROM sessions WHERE id = $2
  )
  ORDER BY sl.weight_kg DESC, sl.reps DESC LIMIT 1`, [1, 1]);
q("session: log set (PR)", "INSERT INTO set_logs (session_id, exercise_id, set_number, weight_kg, reps, rpe, is_warmup, is_pr) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [1, 1, 1, 100, 5, 8, 0, 1]);
q("session: log warmup set", "INSERT INTO set_logs (session_id, exercise_id, set_number, weight_kg, reps, rpe, is_warmup, is_pr) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [1, 1, 2, 60, 8, null, 1, 0]);
q("session: finish", "UPDATE sessions SET finished_at = datetime('now') WHERE id = $1 RETURNING id", [1]);

// ---- HistoryPage ----
q("history: sessions", `SELECT s.*,
  (SELECT COUNT(*) FROM set_logs sl WHERE sl.session_id = s.id) AS set_count,
  (SELECT COALESCE(SUM(sl.weight_kg * sl.reps),0) FROM set_logs sl
    WHERE sl.session_id = s.id AND sl.is_warmup = 0) AS total_volume
FROM sessions s
WHERE s.finished_at IS NOT NULL
ORDER BY s.started_at DESC`);

// ---- SessionDetailPage ----
q("session detail: rows", `SELECT sl.*, e.name_en, e.name_zh, e.equipment
  FROM set_logs sl JOIN exercises e ON e.id = sl.exercise_id
  WHERE sl.session_id = $1 ORDER BY sl.exercise_id, sl.set_number`, [1]);

// ---- StatsPage ----
q("stats: weekly volume", `SELECT strftime('%Y-%W', s.started_at) AS week_start,
  SUM(sl.weight_kg * sl.reps) AS volume,
  COUNT(*) AS set_count
  FROM set_logs sl JOIN sessions s ON s.id = sl.session_id
  WHERE sl.is_warmup = 0
  GROUP BY week_start ORDER BY week_start DESC LIMIT 8`);
q("stats: muscle split", `SELECT e.primary_muscles, SUM(sl.weight_kg * sl.reps) AS volume
  FROM set_logs sl JOIN exercises e ON e.id = sl.exercise_id
  WHERE sl.is_warmup = 0 GROUP BY e.primary_muscles`);
q("stats: PR table", `SELECT sl.exercise_id, e.name_en, e.name_zh,
  MAX(sl.weight_kg) AS max_weight,
  MAX(sl.weight_kg * sl.reps) AS best_volume,
  MAX(sl.reps) AS best_reps,
  MAX(s.started_at) AS pr_date
  FROM set_logs sl
  JOIN exercises e ON e.id = sl.exercise_id
  JOIN sessions s ON s.id = sl.session_id
  WHERE sl.is_warmup = 0
  GROUP BY sl.exercise_id
  ORDER BY max_weight DESC LIMIT 50`);

// ---- StatsPage: fatigue monitor (useFatigueData) ----
q("stats: fatigue rows (35d window)", `SELECT sl.session_id, sl.weight_kg, sl.reps, sl.rpe, sl.is_warmup,
  s.started_at, e.primary_muscles, e.secondary_muscles
  FROM set_logs sl
  JOIN sessions s ON s.id = sl.session_id
  JOIN exercises e ON e.id = sl.exercise_id
  WHERE sl.is_warmup = 0
    AND s.started_at >= datetime('now', '-34 days', 'start of day')
  ORDER BY s.started_at`);

// ---- ActiveSessionPage: past working sets for progression hints ----
q("session: past sets (progression, newest session first)", `SELECT sl.session_id, sl.weight_kg, sl.reps, sl.rpe, sl.is_warmup
  FROM set_logs sl
  JOIN sessions s ON s.id = sl.session_id
  WHERE sl.exercise_id = $1 AND sl.is_warmup = 0 AND s.id != $2
    AND s.started_at < (SELECT started_at FROM sessions WHERE id = $2)
  ORDER BY s.started_at DESC, sl.id DESC
  LIMIT 80`, [1, 1]);

// ---- StatsPage: fractional muscle split + e1RM trend candidates/series ----
q("stats: fractional attribution rows", `SELECT sl.session_id, sl.weight_kg, sl.reps, sl.rpe, sl.is_warmup,
  e.primary_muscles, e.secondary_muscles
  FROM set_logs sl JOIN exercises e ON e.id = sl.exercise_id
  WHERE sl.is_warmup = 0`);
q("stats: e1RM trend candidates", `SELECT e.id, e.name_en, e.name_zh, e.slug, COUNT(DISTINCT s.id) AS n
  FROM set_logs sl
  JOIN exercises e ON e.id = sl.exercise_id
  JOIN sessions s ON s.id = sl.session_id
  WHERE sl.is_warmup = 0 AND sl.weight_kg > 0 AND sl.reps BETWEEN 1 AND 12
  GROUP BY e.id HAVING n >= 3
  ORDER BY n DESC, e.name_zh LIMIT 30`);
q("stats: e1RM trend series", `SELECT sl.session_id, sl.weight_kg, sl.reps, sl.rpe, sl.is_warmup, s.started_at
  FROM set_logs sl
  JOIN sessions s ON s.id = sl.session_id
  WHERE sl.exercise_id = (SELECT id FROM exercises WHERE slug = 'barbell-bench-press')
    AND sl.is_warmup = 0
  ORDER BY s.started_at`);

// ---- SettingsContext ----
q("settings: upsert unit", "INSERT INTO settings (key, value) VALUES ('unit', $1) ON CONFLICT(key) DO UPDATE SET value = $1 RETURNING *", ["lb"]);
q("settings: read back", "SELECT value FROM settings WHERE key = 'unit'");

// FK integrity check
const fk = db.prepare("PRAGMA foreign_key_check").all();
console.log(fk.length === 0 ? "OK    foreign_key_check clean" : "FAIL  FK violations: " + JSON.stringify(fk));

console.log(failures === 0 ? "\nALL QUERIES PASSED" : `\n${failures} QUERIES FAILED`);
process.exit(failures === 0 ? 0 : 1);
