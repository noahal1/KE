use tauri_plugin_sql::{Migration, MigrationKind};

// Core database schema for KE
const MIGRATION_1_SCHEMA: &str = r#"
    CREATE TABLE exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        name_en TEXT NOT NULL,
        name_zh TEXT NOT NULL,
        equipment TEXT NOT NULL,
        category TEXT NOT NULL,
        pattern TEXT NOT NULL,
        primary_muscles TEXT NOT NULL,
        secondary_muscles TEXT NOT NULL,
        is_custom INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE plan_days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        day_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE plan_exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_id INTEGER NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
        exercise_id INTEGER NOT NULL REFERENCES exercises(id),
        target_sets INTEGER NOT NULL DEFAULT 3,
        rep_min INTEGER NOT NULL DEFAULT 8,
        rep_max INTEGER NOT NULL DEFAULT 12,
        rest_seconds INTEGER NOT NULL DEFAULT 90,
        exercise_order INTEGER NOT NULL DEFAULT 0,
        notes TEXT DEFAULT ''
    );

    CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_day_id INTEGER REFERENCES plan_days(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        notes TEXT DEFAULT ''
    );

    CREATE TABLE set_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        exercise_id INTEGER NOT NULL REFERENCES exercises(id),
        set_number INTEGER NOT NULL,
        weight_kg REAL NOT NULL DEFAULT 0,
        reps INTEGER NOT NULL DEFAULT 0,
        rpe REAL,
        is_warmup INTEGER NOT NULL DEFAULT 0,
        is_pr INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE INDEX idx_plan_days_plan ON plan_days(plan_id);
    CREATE INDEX idx_plan_exercises_day ON plan_exercises(day_id);
    CREATE INDEX idx_sessions_day ON sessions(plan_day_id);
    CREATE INDEX idx_set_logs_session ON set_logs(session_id);
    CREATE INDEX idx_set_logs_exercise ON set_logs(exercise_id);
"#;

// Seed the built-in exercise library. INSERT OR IGNORE keeps user
// data/custom exercises intact if this ever runs again.
const SEED_SQL: &str = include_str!("../seed/exercises.sql");

const MIGRATION_3_SESSION_EXERCISES: &str = r#"
    CREATE TABLE session_exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        exercise_id INTEGER NOT NULL REFERENCES exercises(id),
        exercise_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_session_exercises_session ON session_exercises(session_id);
"#;

// Weekly recurring schedule: which weekday(s) a plan day should be trained.
// weekday: 0 = Sunday ... 6 = Saturday (matches JS Date.getDay()).
const MIGRATION_4_PLAN_DAY_SCHEDULE: &str = r#"
    CREATE TABLE plan_day_schedule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_day_id INTEGER NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
        weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        UNIQUE (plan_day_id, weekday)
    );
    CREATE INDEX idx_plan_day_schedule_day ON plan_day_schedule(plan_day_id);
    CREATE INDEX idx_plan_day_schedule_weekday ON plan_day_schedule(weekday);
"#;

// Body data: periodic weight (and optional body-fat %) logs used for the
// stats weight trend and for pricing bodyweight-exercise load.
const MIGRATION_5_BODY_LOGS: &str = r#"
    CREATE TABLE body_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        logged_at TEXT NOT NULL DEFAULT (datetime('now')),
        weight_kg REAL NOT NULL,
        body_fat_pct REAL,
        note TEXT DEFAULT ''
    );
    CREATE INDEX idx_body_logs_date ON body_logs(logged_at);
"#;

// Effective load of a logged set in kg. For weighted exercises it equals
// weight_kg; for bodyweight work it captures the body-relative portion at
// logging time (set from the UI, so it degrades gracefully to weight_kg).
const MIGRATION_6_SET_LOGS_LOAD: &str = r#"
    ALTER TABLE set_logs ADD COLUMN load_kg REAL;
"#;

fn build_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_core_tables",
            kind: MigrationKind::Up,
            sql: MIGRATION_1_SCHEMA,
        },
        Migration {
            version: 2,
            description: "seed_exercise_library",
            kind: MigrationKind::Up,
            sql: SEED_SQL,
        },
        Migration {
            version: 3,
            description: "create_session_exercises",
            kind: MigrationKind::Up,
            sql: MIGRATION_3_SESSION_EXERCISES,
        },
        Migration {
            version: 4,
            description: "create_plan_day_schedule",
            kind: MigrationKind::Up,
            sql: MIGRATION_4_PLAN_DAY_SCHEDULE,
        },
        Migration {
            version: 5,
            description: "create_body_logs",
            kind: MigrationKind::Up,
            sql: MIGRATION_5_BODY_LOGS,
        },
        Migration {
            version: 6,
            description: "add_set_logs_load_kg",
            kind: MigrationKind::Up,
            sql: MIGRATION_6_SET_LOGS_LOAD,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// One-time migration: the app identifier changed from com.noaha.fitplan to
/// com.noaha.ke (v0.2.0). Copy the old per-user app-data directory (containing
/// the SQLite database and its sidecar files) into the new location so
/// existing users keep their history. Best-effort: on any failure the new
/// directory simply starts fresh.
fn migrate_legacy_data_dir() {
    let Some(base) = data_root() else { return };
    let old_dir = base.join("com.noaha.fitplan");
    let new_dir = base.join("com.noaha.ke");
    if !old_dir.exists() || new_dir.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&new_dir);
    for name in ["fitplan.db", "fitplan.db-wal", "fitplan.db-shm"] {
        let from = old_dir.join(name);
        if from.exists() {
            let _ = std::fs::copy(&from, new_dir.join(name));
        }
    }
}

/// Per-user application-data parent directory (mirrors Tauri's identifier-
/// based data dir convention per platform).
#[allow(unused_variables)]
fn data_root() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(std::path::PathBuf::from)
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME")
            .map(|h| std::path::PathBuf::from(h).join("Library/Application Support"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(|h| std::path::PathBuf::from(h).join(".local/share"))
            })
    }
}

pub fn run() {
    migrate_legacy_data_dir();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:fitplan.db", build_migrations())
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
