import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;

/** Load the sqlite database (migrations + seed run automatically on first load). */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:fitplan.db");
  }
  return dbPromise;
}

export type SqlValue = string | number | null;

export async function query<T>(sql: string, params?: SqlValue[]): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(sql, params);
}

export async function execute(sql: string, params?: SqlValue[]): Promise<number> {
  const db = await getDb();
  const result = await db.execute(sql, params);
  return result.lastInsertId ?? 0;
}

export async function run(sql: string, params?: SqlValue[]): Promise<void> {
  const db = await getDb();
  await db.execute(sql, params);
}

/** Parse SQLite `datetime('now')` values ("YYYY-MM-DD HH:MM:SS", UTC) and
 *  ISO strings alike into epoch ms; null when unparseable. Shared by pages
 *  that feed timestamps into the metrics library. */
export function parseSqliteTimestamp(v: string | null | undefined): number | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) {
    const t = Date.parse(v.replace(" ", "T") + "Z");
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}
