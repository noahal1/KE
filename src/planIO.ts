import { query, execute } from "./db";
import type { Plan, PlanDay, PlanExercise } from "./types";

/**
 * Plan import/export.
 *
 * JSON format (full fidelity — used for backup & sharing):
 * {
 *   "format": "fitplan-plan",
 *   "version": 1,
 *   "plans": [
 *     {
 *       "name": "5/3/1",
 *       "notes": "",
 *       "days": [
 *         {
 *           "name": "Push",
 *           "day_order": 0,
 *           "schedule": [1, 4],            // optional weekdays 0=Sun..6=Sat
 *           "exercises": [
 *             {
 *               "exercise_key": "barbell-bench-press",  // exercises.slug
 *               "name_en": "Barbell Bench Press",       // fallback if slug unknown
 *               "name_zh": "杠铃卧推",
 *               "target_sets": 3, "rep_min": 8, "rep_max": 12,
 *               "rest_seconds": 90, "exercise_order": 0, "notes": ""
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *   ]
 * }
 *
 * CSV format (flat, Excel-friendly — one row per plan day):
 *   Plan,Day,Weekdays,Exercises
 *   腿部计划,"腿日","1,4","杠铃深蹲 4x6-8/120; 罗马尼亚硬拉 3x8-12/90"
 * Weekdays: 0=周日..6=周六, comma-separated. Exercises are separated by ";" and
 * each one is "名称 [S]x[R1]-[R2][/rest]" where only the name is required.
 */

const FORMAT = "fitplan-plan";
const VERSION = 1;

export interface PlanExerciseExport {
  exercise_key?: string;
  name_en?: string;
  name_zh?: string;
  target_sets?: number;
  rep_min?: number;
  rep_max?: number;
  rest_seconds?: number;
  exercise_order?: number;
  notes?: string;
}

export interface PlanDayExport {
  name: string;
  day_order?: number;
  schedule?: number[];
  exercises?: PlanExerciseExport[];
}

export interface PlanExport {
  name: string;
  notes?: string;
  days?: PlanDayExport[];
}

export interface PlanBundle {
  format: string;
  version: number;
  plans: PlanExport[];
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function buildPlanBundle(planIds?: number[]): Promise<PlanBundle> {
  const planRows = planIds?.length
    ? await query<Plan>(`SELECT * FROM plans WHERE id IN (${planIds.map((_, i) => `$${i + 1}`).join(",")})`, planIds)
    : await query<Plan>("SELECT * FROM plans ORDER BY id");

  const plans: PlanExport[] = [];
  for (const plan of planRows) {
    const days = await query<PlanDay & { weekdays: string | null }>(
      `SELECT d.*,
        (SELECT GROUP_CONCAT(weekday) FROM plan_day_schedule ps WHERE ps.plan_day_id = d.id) AS weekdays
       FROM plan_days d WHERE d.plan_id = $1 ORDER BY d.day_order`,
      [plan.id],
    );
    const dayExports: PlanDayExport[] = [];
    for (const day of days) {
      const exercises = await query<PlanExercise & { slug: string; name_en: string; name_zh: string }>(
        `SELECT pe.*, e.slug, e.name_en, e.name_zh
         FROM plan_exercises pe JOIN exercises e ON e.id = pe.exercise_id
         WHERE pe.day_id = $1 ORDER BY pe.exercise_order`,
        [day.id],
      );
      dayExports.push({
        name: day.name,
        day_order: day.day_order,
        schedule: day.weekdays
          ? (day.weekdays as string)
              .split(",")
              .map((n) => Number(n))
              .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
          : [],
        exercises: exercises.map((ex) => ({
          exercise_key: ex.slug,
          name_en: ex.name_en,
          name_zh: ex.name_zh,
          target_sets: ex.target_sets,
          rep_min: ex.rep_min,
          rep_max: ex.rep_max,
          rest_seconds: ex.rest_seconds,
          exercise_order: ex.exercise_order,
          notes: ex.notes ?? "",
        })),
      });
    }
    plans.push({ name: plan.name, notes: plan.notes, days: dayExports });
  }
  return { format: FORMAT, version: VERSION, plans };
}

export function bundleToJson(bundle: PlanBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function bundleToCsv(bundle: PlanBundle): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ["Plan,Day,Weekdays,Exercises"];
  for (const plan of bundle.plans) {
    for (const day of plan.days ?? []) {
      const ex = (day.exercises ?? [])
        .map((e) => {
          const name = e.name_zh || e.name_en || e.exercise_key || "";
          const sets = e.target_sets ? `${e.target_sets}x` : "";
          const reps =
            e.rep_min && e.rep_max
              ? `${e.rep_min}-${e.rep_max}`
              : e.rep_min
                ? String(e.rep_min)
                : "";
          const rest = e.rest_seconds ? `/${e.rest_seconds}` : "";
          return `${name} ${sets}${reps}${rest}`.trim();
        })
        .join("; ");
      lines.push(
        [esc(plan.name), esc(day.name), (day.schedule ?? []).join(","), esc(ex)].join(","),
      );
    }
  }
  return lines.join("\r\n");
}

/** Trigger a browser/Tauri-webview download of the given text file. */
export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export interface ParseResult {
  plans: PlanExport[];
  /** non-fatal problems collected while parsing, shown to the user */
  warnings: string[];
}

export function parseJsonPlan(text: string): ParseResult {
  const warnings: string[] = [];
  const data = JSON.parse(text) as PlanBundle | PlanExport | PlanExport[];
  const rawPlans: unknown[] = Array.isArray(data)
    ? data
    : "plans" in (data as PlanBundle)
      ? ((data as PlanBundle).plans as unknown[])
      : [data];
  const plans: PlanExport[] = [];
  for (const raw of rawPlans) {
    const p = raw as PlanExport;
    if (!p || typeof p.name !== "string" || !p.name.trim()) {
      warnings.push("plan without name skipped");
      continue;
    }
    plans.push({
      name: p.name.trim(),
      notes: typeof p.notes === "string" ? p.notes : "",
      days: Array.isArray(p.days) ? p.days.filter((d) => d && typeof d.name === "string") : [],
    });
  }
  if (plans.length === 0) throw new Error("no valid plans found in file");
  return { plans, warnings };
}

/**
 * Parse the flat CSV export. Also tolerates a header-less single-plan file.
 * Returns plan-level structure; exercise lines are parsed per day.
 */
export function parseCsvPlan(text: string): ParseResult {
  const warnings: string[] = [];
  const rows = parseCsvRows(text);
  if (rows.length === 0) throw new Error("empty CSV file");

  // Detect header row
  const header = rows[0].map((c) => c.trim().toLowerCase());
  const hasHeader = header.includes("plan") && header.includes("day");
  const body = hasHeader ? rows.slice(1) : rows;

  const plans = new Map<string, PlanExport>();
  for (const row of body) {
    const [planName, dayName, weekdays, exercises] = row;
    if (!planName || !dayName) continue;
    let plan = plans.get(planName);
    if (!plan) {
      plan = { name: planName, notes: "", days: [] };
      plans.set(planName, plan);
    }
    const schedule = (weekdays ?? "")
      .split(/[,;]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    plan.days!.push({
      name: dayName,
      day_order: plan.days!.length,
      schedule: [...new Set(schedule)],
      exercises: parseExerciseList(exercises ?? "", warnings),
    });
  }
  const result = [...plans.values()];
  if (result.length === 0) throw new Error("no valid rows found in CSV");
  return { plans: result, warnings };
}

/** Minimal RFC-4180-ish CSV splitter handling quotes and CRLF. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse "深蹲 4x6-8/120; 卧推 3x8" into exercise entries. */
export function parseExerciseList(text: string, warnings: string[]): PlanExerciseExport[] {
  return text
    .split(/;|；/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((chunk) => parseExerciseChunk(chunk, warnings))
    .filter((e): e is PlanExerciseExport => e !== null);
}

/** "杠铃深蹲 4x6-8/120" → name + sets/reps/rest */
function parseExerciseChunk(chunk: string, warnings: string[]): PlanExerciseExport | null {
  // Match trailing "<sets>x<reps>" and optional "/rest"
  const m = chunk.match(/^(.*?)(?:\s*(\d+)\s*[x×]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?(?:\s*\/\s*(\d+))?\s*$/);
  if (!m || !m[1].trim()) {
    warnings.push(`cannot parse exercise "${chunk}"`);
    return null;
  }
  const name = m[1].trim();
  return {
    name_zh: name,
    name_en: name,
    target_sets: m[2] ? parseInt(m[2], 10) : undefined,
    rep_min: m[3] ? parseInt(m[3], 10) : undefined,
    rep_max: m[4] ? parseInt(m[4], 10) : undefined,
    rest_seconds: m[5] ? parseInt(m[5], 10) : undefined,
    exercise_order: 0,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportSummary {
  plansCreated: number;
  daysCreated: number;
  exercisesLinked: number;
  exercisesPlaceholder: number;
}

/**
 * Insert parsed plans into the database. Exercises are matched to the library
 * by slug first, then by zh/en name; unknown ones get a placeholder custom
 * exercise so the plan is still complete.
 */
export async function importPlans(
  parsed: PlanExport[],
  onProgress?: (msg: string) => void,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    plansCreated: 0,
    daysCreated: 0,
    exercisesLinked: 0,
    exercisesPlaceholder: 0,
  };

  // Load lookup tables once
  const libRows = await query<{ id: number; slug: string; name_en: string; name_zh: string }>(
    "SELECT id, slug, name_en, name_zh FROM exercises",
  );
  const bySlug = new Map(libRows.map((e) => [e.slug.toLowerCase(), e]));
  const byZh = new Map(libRows.map((e) => [e.name_zh.trim(), e]));
  const byEn = new Map(libRows.map((e) => [e.name_en.toLowerCase().trim(), e]));

  for (const plan of parsed) {
    onProgress?.(plan.name);
    const planId = await execute("INSERT INTO plans (name, notes) VALUES ($1,$2)", [
      plan.name,
      plan.notes ?? "",
    ]);
    summary.plansCreated++;

    const days = [...(plan.days ?? [])].sort((a, b) => (a.day_order ?? 0) - (b.day_order ?? 0));
    for (let di = 0; di < days.length; di++) {
      const day = days[di];
      const dayId = await execute(
        "INSERT INTO plan_days (plan_id, name, day_order) VALUES ($1,$2,$3)",
        [planId, day.name, di],
      );
      summary.daysCreated++;

      for (const sched of day.schedule ?? []) {
        if (Number.isInteger(sched) && sched >= 0 && sched <= 6) {
          await execute(
            "INSERT OR IGNORE INTO plan_day_schedule (plan_day_id, weekday) VALUES ($1,$2)",
            [dayId, sched],
          );
        }
      }

      const exercises = [...(day.exercises ?? [])];
      for (let ei = 0; ei < exercises.length; ei++) {
        const ex = exercises[ei];
        const exerciseId = await matchOrCreateExercise(ex, bySlug, byZh, byEn, summary);
        await execute(
          `INSERT INTO plan_exercises
             (day_id, exercise_id, target_sets, rep_min, rep_max, rest_seconds, exercise_order, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            dayId,
            exerciseId,
            ex.target_sets ?? 3,
            ex.rep_min ?? 8,
            ex.rep_max ?? ex.rep_min ?? 12,
            ex.rest_seconds ?? 90,
            ei,
            ex.notes ?? "",
          ],
        );
      }
    }
  }
  return summary;
}

async function matchOrCreateExercise(
  ex: PlanExerciseExport,
  bySlug: Map<string, { id: number }>,
  byZh: Map<string, { id: number }>,
  byEn: Map<string, { id: number }>,
  summary: ImportSummary,
): Promise<number> {
  const key = ex.exercise_key?.toLowerCase().trim();
  if (key && bySlug.has(key)) {
    summary.exercisesLinked++;
    return bySlug.get(key)!.id;
  }
  const zh = ex.name_zh?.trim();
  if (zh && byZh.has(zh)) {
    summary.exercisesLinked++;
    return byZh.get(zh)!.id;
  }
  const en = ex.name_en?.toLowerCase().trim();
  if (en && byEn.has(en)) {
    summary.exercisesLinked++;
    return byEn.get(en)!.id;
  }

  // Unknown exercise → create a placeholder custom entry
  const name = zh || ex.name_en || ex.exercise_key || "Unnamed";
  const slug = `import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const id = await execute(
    `INSERT INTO exercises (slug, name_en, name_zh, equipment, category, pattern, primary_muscles, secondary_muscles, is_custom)
     VALUES ($1,$2,$3,'barbell','isolation','press','','',1)`,
    [slug, ex.name_en || name, zh || name],
  );
  summary.exercisesPlaceholder++;
  return id;
}
