// Garmin .fit import — parse + extract + match + commit.
//
// Strength-training activity files exported from Garmin Connect carry one
// `set` message per logged set (repetitions, weight, set_type, and the
// exercise as a numeric (category, category_subtype) pair). This module turns
// those messages into FitPlan sessions: grouping consecutive same-exercise
// sets, resolving the enum pair to a readable name via the generated tables
// in data/fit-enums.ts, matching that name against the built-in + custom
// exercise library (creating custom entries as a fallback), and writing
// sessions/set_logs rows — the same tables the in-app workout logger uses.
//
// The commit layer touches the DB and the DOM (FitParser reads the file
// bytes); everything below `parseStrengthFile` is pure and unit-tested by
// scripts/fit-import-smoke-test.mjs.

import {
  FIT_EXERCISE_CATEGORIES,
  FIT_EXERCISE_NAME_TABLES,
} from "../data/fit-enums.ts";
import { execute, query, run } from "../db.ts";

// Lazy-loaded so the parser (plus its buffer polyfill) stays out of the main
// bundle; Vite code-splits it into its own chunk.

// ---------------------------------------------------------------------------
// Parsed shape (subset — the parser's full profile types are not re-exported)

interface RawSet {
  repetitions?: number | null;
  weight?: number | null;
  set_type?: string | number | null;
  category?: unknown; // enum array or scalar
  category_subtype?: unknown; // enum array or scalar
  start_time?: Date | null;
  timestamp?: Date | null;
}

interface RawParsed {
  sets?: RawSet[];
  sessions?: Array<{ start_time?: Date | null; sport?: string | number | null }>;
}

// ---------------------------------------------------------------------------
// Public types

export interface FitImportSet {
  /** Resolved Garmin exercise name, e.g. "Barbell Bench Press". */
  name: string;
  weightKg: number;
  reps: number;
  startTime: Date | null;
}

export interface FitImportGroup {
  name: string;
  sets: FitImportSet[];
  /** Local exercise id when matched against the library, else null. */
  matchedId: number | null;
}

export interface FitImportPreview {
  fileName: string;
  /** Session start (FIT session.start_time, else first set) as ISO string. */
  startedAtIso: string | null;
  finishedAtIso: string | null;
  sets: FitImportSet[];
  groups: FitImportGroup[];
  /** Unique Garmin names with no library match (will be created as custom). */
  unmatched: string[];
}

export interface ExerciseCatalogEntry {
  id: number;
  slug: string;
  name_en: string;
  name_zh: string;
}

// ---------------------------------------------------------------------------
// Garmin enum resolution (pure)

/** `barbell_bench_press` → "Barbell Bench Press"; null-terminated names drop
 *  the sentinel (some SDK tables still carry it). */
export function humanizeEnumName(raw: string): string {
  const cleaned = raw.replace(/\0.*/, "").trim();
  if (!cleaned) return "";
  return cleaned
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Numeric (category, category_subtype) pair → readable exercise name.
 *  Falls back to the bare category name when the subtype is unknown. */
export function resolveExerciseName(
  category: unknown,
  categorySubtype: unknown,
): string | null {
  const catIdx = firstEnumValue(category);
  if (catIdx === null) return null;
  const cat = FIT_EXERCISE_CATEGORIES[String(catIdx)];
  if (!cat || cat === "unknown") return null;

  const table = FIT_EXERCISE_NAME_TABLES[`${cat}_exercise_name`];
  const subIdx = firstEnumValue(categorySubtype);
  const sub = table && subIdx !== null ? table[String(subIdx)] : undefined;
  if (sub) {
    const humanized = humanizeEnumName(sub);
    if (humanized) return humanized;
  }
  const humanizedCat = humanizeEnumName(cat);
  return humanizedCat || null;
}

/** Category fields are declared as enum arrays in the FIT profile; parsers
 *  and devices vary between arrays and scalars, so accept both. */
function firstEnumValue(v: unknown): string | null {
  if (v == null) return null;
  const arr = Array.isArray(v) ? v : [v];
  for (const item of arr) {
    if (item == null) continue;
    return String(item);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Library matching (pure)

/** Lowercase, collapse every non-alphanumeric run into single spaces. */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function wordSet(s: string): Set<string> {
  return new Set(normalizeName(s).split(" ").filter(Boolean));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const w of a) if (!b.has(w)) return false;
  return true;
}

function wordCount(s: string): number {
  return normalizeName(s).split(" ").filter(Boolean).length;
}

/** Match a Garmin exercise name against the local library. Word-order
 *  insensitive ("Incline Barbell Bench Press" → "Barbell Incline Bench
 *  Press"); among candidates the closest word count wins. Returns null when
 *  nothing matches — caller creates a custom exercise. */
export function matchExercise(
  name: string,
  catalog: ExerciseCatalogEntry[],
): number | null {
  const target = normalizeName(name);
  if (!target) return null;
  const targetWords = wordSet(name);

  let best: { id: number; penalty: number } | null = null;
  for (const ex of catalog) {
    const candidates = [ex.name_en, ex.slug, ex.name_zh];
    let penalty: number | null = null;
    for (const cand of candidates) {
      const norm = normalizeName(cand);
      if (!norm) continue;
      if (norm === target) {
        penalty = 0;
        break;
      }
      if (setsEqual(wordSet(cand), targetWords)) {
        // Word-set match: prefer the candidate with the least word drift.
        const p = 10 + Math.abs(wordCount(cand) - targetWords.size);
        if (penalty === null || p < penalty) penalty = p;
      }
    }
    if (penalty !== null && (best === null || penalty < best.penalty)) {
      best = { id: ex.id, penalty };
    }
  }
  return best ? best.id : null;
}

/** Guess the equipment tag for a custom exercise from its name tokens. */
export function guessEquipment(name: string): string {
  const n = normalizeName(name);
  if (/\bsmith\b/.test(n)) return "smith";
  if (/\bbarbell\b|\bt bar\b|\bt-bar\b|\blandmine\b/.test(n)) return "barbell";
  if (/\bdumbbell\b/.test(n)) return "dumbbell";
  if (/\bkettlebell\b|\bkb\b/.test(n)) return "kettlebell";
  if (/\bcable\b|\bpulley\b/.test(n)) return "cable";
  if (/\bmachine\b|\bleg press\b|\bpec deck\b/.test(n)) return "machine";
  if (/\bband\b|\bresistance\b|\bsuspension\b|\btrx\b/.test(n)) return "band";
  if (
    /\bplank\b|\bcrunch\b|\bsit up\b|\bpush up\b|\bpull up\b|\bchin up\b|\bbridge\b|\bdead bug\b|\bsuperman\b/.test(n)
  ) {
    return "bodyweight";
  }
  return "machine";
}

/** Guess the movement pattern for a custom exercise from its name tokens. */
export function guessPattern(name: string): string {
  const n = normalizeName(name);
  if (/\bsquat\b|\bbox squat\b/.test(n)) return "squat";
  if (/\bdeadlift\b|\brdl\b|\bgood morning\b|\bhip thrust\b|\bhip raise\b|\bswing\b|\bhinge\b/.test(n)) return "hinge";
  if (/\blunge\b|\bsplit squat\b|\bstep up\b|\bstep\b/.test(n)) return "single-leg";
  if (/\brow\b|\bpull up\b|\bchin up\b|\bpull\b|\bcurl\b|\bshrug\b|\brate\b/.test(n)) return "pull";
  if (/\bpress\b|\bbench\b|\bpush up\b|\bpush\b|\bdip\b|\braise\b|\bchest\b|\bshoulder\b/.test(n)) return "press";
  if (/\bclean\b|\bsnatch\b|\bjerk\b/.test(n)) return "olympic";
  if (/\btwist\b|\brotation\b|\bchop\b/.test(n)) return "rotation";
  if (/\bplank\b|\bcrunch\b|\bsit up\b|\bcore\b|\bab\b/.test(n)) return "core";
  return "press";
}

const COMPOUND_PATTERNS = new Set(["squat", "hinge", "pull", "press", "single-leg", "olympic", "full-body"]);

export function categoryForPattern(pattern: string): string {
  return COMPOUND_PATTERNS.has(pattern) ? "compound" : "isolation";
}

// ---------------------------------------------------------------------------
// Grouping (pure)

/** Group consecutive same-exercise sets (Garmin logs sets strictly in
 *  workout order; supersets therefore become separate groups). */
export function groupSetsByExercise(sets: FitImportSet[]): FitImportGroup[] {
  const groups: FitImportGroup[] = [];
  for (const s of sets) {
    const last = groups[groups.length - 1];
    if (last && last.name === s.name) {
      last.sets.push(s);
    } else {
      groups.push({ name: s.name, sets: [s], matchedId: null });
    }
  }
  return groups;
}

/** Sort by start time (stable; timestamp-less sets keep file order last). */
export function sortSets(sets: FitImportSet[]): FitImportSet[] {
  return sets
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ta = a.s.startTime?.getTime() ?? Number.POSITIVE_INFINITY;
      const tb = b.s.startTime?.getTime() ?? Number.POSITIVE_INFINITY;
      return ta !== tb ? ta - tb : a.i - b.i;
    })
    .map(({ s }) => s);
}

// ---------------------------------------------------------------------------
// File parsing (needs the parser, but no DB/DOM)

const SET_TYPE_ACTIVE = new Set(["1", "active"]);
const MAX_SANE_WEIGHT_KG = 1000;
const MAX_SANE_REPS = 500;

/** Parse one .fit file and extract its strength-training sets. Returns an
 *  empty `sets` list for non-strength files (runs, rides, …). */
export async function parseStrengthFile(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<FitImportPreview> {
  const { default: FitParser } = await import("fit-file-parser");
  const parser = new FitParser({ force: true, mode: "list" });
  const data = (await parser.parseAsync(buffer)) as unknown as RawParsed;

  const rawSets = Array.isArray(data.sets) ? data.sets : [];
  const sets: FitImportSet[] = [];
  for (const rs of rawSets) {
    // Rest entries have no repetitions; anything nonsensical is skipped.
    const reps = rs.repetitions;
    if (typeof reps !== "number" || reps < 1 || reps > MAX_SANE_REPS) continue;
    if (rs.set_type != null && !SET_TYPE_ACTIVE.has(String(rs.set_type))) continue;

    // `weight` is profile-scaled to kg (scale 16) by the parser; the display
    // unit only describes device UI preference. Bodyweight sets report no
    // weight → stored as 0, matching FitPlan's own convention.
    const w = rs.weight;
    const weightKg =
      typeof w === "number" && w > 0 && w < MAX_SANE_WEIGHT_KG ? w : 0;

    const name =
      resolveExerciseName(rs.category, rs.category_subtype) ?? "Unknown Exercise";
    const startTime = rs.start_time ?? rs.timestamp ?? null;
    sets.push({ name, weightKg, reps, startTime });
  }

  const ordered = sortSets(sets);
  const startedAtIso =
    data.sessions?.[0]?.start_time?.toISOString() ??
    ordered[0]?.startTime?.toISOString() ??
    null;
  const finishedAtIso =
    ordered.length > 0
      ? (ordered[ordered.length - 1].startTime?.toISOString() ?? startedAtIso)
      : null;

  const preview: FitImportPreview = {
    fileName,
    startedAtIso,
    finishedAtIso,
    sets: ordered,
    groups: groupSetsByExercise(ordered),
    unmatched: [],
  };
  return preview;
}

/** Resolve group matches against the catalog and collect unmatched names. */
export function annotateMatches(
  preview: FitImportPreview,
  catalog: ExerciseCatalogEntry[],
): void {
  for (const g of preview.groups) {
    g.matchedId = matchExercise(g.name, catalog);
  }
  preview.unmatched = [
    ...new Set(preview.groups.filter((g) => g.matchedId === null).map((g) => g.name)),
  ];
}

// ---------------------------------------------------------------------------
// Commit (DB)

/** UTC "YYYY-MM-DD HH:MM:SS" — matches SQLite datetime('now') format used by
 *  sessions.started_at / finished_at. */
export function toSqliteTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

export interface CommitResult {
  sessionId: number;
  createdExercises: number;
}

/** Write one preview as a finished session. Unmatched exercise names are
 *  created as custom exercises (is_custom=1) first. */
export async function commitImport(
  preview: FitImportPreview,
  sessionName: string,
): Promise<CommitResult> {
  if (preview.sets.length === 0) {
    throw new Error("no strength sets to import");
  }

  const catalog = await query<ExerciseCatalogEntry>(
    "SELECT id, slug, name_en, name_zh FROM exercises",
  );
  const idFor = new Map<string, number>();
  let createdExercises = 0;

  const ensureExercise = async (name: string): Promise<number> => {
    const cached = idFor.get(name);
    if (cached != null) return cached;
    let id = matchExercise(name, catalog);
    if (id === null) {
      const slug = `garmin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const pattern = guessPattern(name);
      id = await execute(
        `INSERT INTO exercises (slug, name_en, name_zh, equipment, category, pattern, primary_muscles, secondary_muscles, is_custom)
         VALUES ($1,$2,$3,$4,$5,$6,'','',1)`,
        [slug, name, name, guessEquipment(name), categoryForPattern(pattern), pattern],
      );
      createdExercises++;
      catalog.push({
        id,
        slug,
        name_en: name,
        name_zh: name,
      });
    }
    idFor.set(name, id);
    return id;
  };

  const startedAt = toSqliteTimestamp(
    preview.startedAtIso ? new Date(preview.startedAtIso) : new Date(),
  );
  const finishedAt = preview.finishedAtIso
    ? toSqliteTimestamp(new Date(preview.finishedAtIso))
    : startedAt;

  const sessionId = await execute(
    "INSERT INTO sessions (name, started_at, finished_at) VALUES ($1,$2,$3)",
    [sessionName, startedAt, finishedAt],
  );

  for (const group of preview.groups) {
    const exerciseId = await ensureExercise(group.name);
    let setNumber = 0;
    for (const s of group.sets) {
      setNumber++;
      await run(
        `INSERT INTO set_logs (session_id, exercise_id, set_number, weight_kg, reps, rpe, is_warmup, is_pr)
         VALUES ($1,$2,$3,$4,$5,NULL,0,0)`,
        [sessionId, exerciseId, setNumber, s.weightKg, s.reps],
      );
    }
  }

  return { sessionId, createdExercises };
}
