import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Lang, Unit } from "./types";
import { setAppLanguage } from "./i18n";
import { execute, getDb, query, run } from "./db";

export interface BodyProfileState {
  sex: "male" | "female" | null;
  age: number | null;
  heightCm: number | null;
  /** Latest logged bodyweight in kg, for load pricing. */
  weightKg: number | null;
  /** Target bodyweight in kg, for the trend progress readout. */
  goalWeightKg: number | null;
}

const EMPTY_PROFILE: BodyProfileState = {
  sex: null,
  age: null,
  heightCm: null,
  weightKg: null,
  goalWeightKg: null,
};

interface ProfileUpdate {
  sex?: "male" | "female" | null;
  age?: number | null;
  heightCm?: number | null;
  goalWeightKg?: number | null;
}

interface SettingsState {
  lang: Lang;
  unit: Unit;
  soundCue: boolean;
  profile: BodyProfileState;
  setLang: (l: Lang) => void;
  setUnit: (u: Unit) => void;
  setSoundCue: (v: boolean) => void;
  /** Persist a bodyweight log; returns the insert id. `loggedAtSql`
   *  ("YYYY-MM-DD HH:MM:SS") backfills a past day; omit for now. */
  logWeight: (weightKg: number, bodyFatPct: number | null, loggedAtSql?: string) => Promise<number>;
  deleteWeightLog: (id: number) => Promise<void>;
  saveProfile: (p: ProfileUpdate) => void;
  /** Called after weight edits so pricing stays fresh. */
  refreshProfile: () => void;
}

const Ctx = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem("fitplan.lang") as Lang) || "zh",
  );
  const [unit, setUnitState] = useState<Unit>(
    () => (localStorage.getItem("fitplan.unit") as Unit) || "kg",
  );
  const [soundCue, setSoundCueState] = useState<boolean>(() => {
    const v = localStorage.getItem("fitplan.soundCue");
    return v === null ? true : v === "1";
  });
  const [profile, setProfile] = useState<BodyProfileState>(EMPTY_PROFILE);

  // Load body profile (settings keys + latest weight log) on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await query<{ key: string; value: string }>(
          "SELECT key, value FROM settings WHERE key LIKE 'profile.%'",
        );
        const map = new Map(rows.map((r) => [r.key, r.value]));
        const sex = map.get("profile.sex");
        const age = map.get("profile.age");
        const height = map.get("profile.height_cm");
        const goal = map.get("profile.goal_weight_kg");
        const numOrNull = (v: string | undefined) =>
          v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;
        const w = await query<{ weight_kg: number }>(
          "SELECT weight_kg FROM body_logs ORDER BY logged_at DESC, id DESC LIMIT 1",
        );
        if (cancelled) return;
        setProfile({
          sex: sex === "male" || sex === "female" ? sex : null,
          age: numOrNull(age),
          heightCm: numOrNull(height),
          goalWeightKg: numOrNull(goal),
          weightKg: w.length > 0 ? w[0].weight_kg : null,
        });
      } catch {
        // Table not migrated yet or DB unavailable — keep empty profile.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist unit to DB (best-effort) whenever it changes
  useEffect(() => {
    getDb()
      .then((db) =>
        db.execute(
          "INSERT INTO settings (key, value) VALUES ('unit', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
          [unit],
        ),
      )
      .catch(() => undefined);
  }, [unit]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setAppLanguage(l);
  }, []);

  const setUnit = useCallback((u: Unit) => setUnitState(u), []);

  const setSoundCue = useCallback((v: boolean) => {
    setSoundCueState(v);
    localStorage.setItem("fitplan.soundCue", v ? "1" : "0");
  }, []);

  const logWeight = useCallback(
    async (weightKg: number, bodyFatPct: number | null, loggedAtSql?: string) => {
      const id = await execute(
        "INSERT INTO body_logs (logged_at, weight_kg, body_fat_pct) VALUES (COALESCE($3, datetime('now')), $1, $2)",
        [weightKg, bodyFatPct, loggedAtSql ?? null],
      );
      setProfile((p) => ({ ...p, weightKg }));
      return id;
    },
    [],
  );

  const deleteWeightLog = useCallback(async (id: number) => {
    await run("DELETE FROM body_logs WHERE id = $1", [id]);
    const w = await query<{ weight_kg: number }>(
      "SELECT weight_kg FROM body_logs ORDER BY logged_at DESC, id DESC LIMIT 1",
    );
    setProfile((p) => ({ ...p, weightKg: w.length > 0 ? w[0].weight_kg : null }));
  }, []);

  const saveProfile = useCallback((u: ProfileUpdate) => {
    setProfile((p) => {
      const next = { ...p, ...u };
      if (u.sex !== undefined) {
        void run(
          "INSERT INTO settings (key, value) VALUES ('profile.sex', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
          [next.sex ?? ""],
        ).catch(() => undefined);
      }
      if (u.age !== undefined) {
        void run(
          "INSERT INTO settings (key, value) VALUES ('profile.age', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
          [next.age === null ? "" : String(next.age)],
        ).catch(() => undefined);
      }
      if (u.heightCm !== undefined) {
        void run(
          "INSERT INTO settings (key, value) VALUES ('profile.height_cm', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
          [next.heightCm === null ? "" : String(next.heightCm)],
        ).catch(() => undefined);
      }
      if (u.goalWeightKg !== undefined) {
        void run(
          "INSERT INTO settings (key, value) VALUES ('profile.goal_weight_kg', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
          [next.goalWeightKg === null ? "" : String(next.goalWeightKg)],
        ).catch(() => undefined);
      }
      return next;
    });
  }, []);

  const refreshProfile = useCallback(() => {
    query<{ weight_kg: number }>(
      "SELECT weight_kg FROM body_logs ORDER BY logged_at DESC, id DESC LIMIT 1",
    )
      .then((w) => setProfile((p) => ({ ...p, weightKg: w.length > 0 ? w[0].weight_kg : null })))
      .catch(() => undefined);
  }, []);

  return (
    <Ctx.Provider
      value={{
        lang,
        unit,
        soundCue,
        profile,
        setLang,
        setUnit,
        setSoundCue,
        logWeight,
        deleteWeightLog,
        saveProfile,
        refreshProfile,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSettings(): SettingsState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
