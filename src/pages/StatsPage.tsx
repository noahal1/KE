import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseSqliteTimestamp, query } from "../db";
import { useSettings } from "../SettingsContext";
import { formatWeight, formatVolume } from "../units";
import { useFatigueData } from "../hooks/useFatigueData";
import BodyDiagram, { type BodyDiagramValue } from "../components/BodyDiagram";
import {
  e1rmTrend,
  fractionalAttribution,
  TREND,
  weightTrend,
  type MuscleTrainingLevel,
  type MuscleVolume,
  type MuscleWeeklyBand,
  type SetLike,
} from "../lib/metrics";

/** Per-band cell treatment: four gray steps toward solid ink (ed aesthetic). */
const BAND_CELL: Record<MuscleWeeklyBand["band"], { bg: string; label: string }> = {
  "below-mev": { bg: "bg-[#1C1C1C]/5", label: "stats.fatigue.belowMev" },
  "mev-mav": { bg: "bg-[#1C1C1C]/15", label: "stats.fatigue.mevMav" },
  "mav-mrv": { bg: "bg-[#1C1C1C]/40", label: "stats.fatigue.mavMrv" },
  "above-mrv": { bg: "bg-[#1C1C1C] text-[#F9F8F6]", label: "stats.fatigue.aboveMrv" },
};

/** Training-level treatment: mirrors the fatigue grid's gray ramp so the two
 *  sections read as one scale; "untrained" renders as hollow/outline. */
const LEVEL_CELL: Record<
  MuscleTrainingLevel["level"],
  { bg: string; text: string; label: string }
> = {
  untrained: { bg: "bg-transparent border border-[#1C1C1C]/15", text: "text-[#1C1C1C]/30", label: "stats.trainingLevel.level.untrained" },
  maintenance: { bg: "bg-[#1C1C1C]/5", text: "text-[#1C1C1C]/60", label: "stats.trainingLevel.level.maintenance" },
  developing: { bg: "bg-[#1C1C1C]/20", text: "text-[#1C1C1C]/80", label: "stats.trainingLevel.level.developing" },
  optimal: { bg: "bg-[#1C1C1C]/45", text: "text-[#F9F8F6]", label: "stats.trainingLevel.level.optimal" },
  overreaching: { bg: "bg-[#1C1C1C] text-[#F9F8F6]", text: "text-[#F9F8F6]", label: "stats.trainingLevel.level.overreaching" },
};

interface WeekRow {
  week_start: string;
  volume: number;
  set_count: number;
}

/** Exercise with enough session history to draw an e1RM trend. */
interface TrendExRow {
  id: number;
  name_en: string;
  name_zh: string;
  slug: string;
  n: number;
}

/** Raw row for trend/attribution queries. */
interface MetricsRow extends SetLike {
  session_id: number;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  is_warmup: number;
  started_at?: string | null;
}

interface BodyLogRow {
  id: number;
  logged_at: string;
  weight_kg: number;
  body_fat_pct: number | null;
}

interface TrendState {
  points: Array<{ t: number; e1rm: number }>;
  slopePerDay: number | null;
}

interface PRRow {
  exercise_id: number;
  name_en: string;
  name_zh: string;
  max_weight: number;
  best_volume: number;
  best_reps: number;
  pr_date: string;
}

export default function StatsPage() {
  const { t } = useTranslation();
  const { lang, unit, profile } = useSettings();
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [muscles, setMuscles] = useState<MuscleVolume[]>([]);
  const [prs, setPrs] = useState<PRRow[]>([]);
  const [trendExercises, setTrendExercises] = useState<TrendExRow[]>([]);
  const [trendSlug, setTrendSlug] = useState("");
  const [trendData, setTrendData] = useState<TrendState | null>(null);
  const [bodyLogs, setBodyLogs] = useState<BodyLogRow[]>([]);
  const fatigue = useFatigueData();

  useEffect(() => {
    query<BodyLogRow>(
      "SELECT id, logged_at, weight_kg, body_fat_pct FROM body_logs ORDER BY logged_at DESC LIMIT 200",
    )
      .then(setBodyLogs)
      .catch(() => setBodyLogs([]));
  }, []);

  const weight = useMemo(() => weightTrend(bodyLogs), [bodyLogs]);

  /** Remaining distance to goal weight (display domain): negative when
   *  below the goal, positive above; null without goal/current. */
  const goalProgress =
    profile.goalWeightKg !== null && weight.current !== null
      ? kgToDisplaySafe(weight.current - profile.goalWeightKg, unit)
      : null;
  /** How much of the first→current move toward the goal is done (0–100+). */
  const goalProgressPct = useMemo(() => {
    if (profile.goalWeightKg === null || weight.current === null || weight.points.length < 2)
      return 0;
    const startKg = weight.points[0].weight;
    const total = profile.goalWeightKg - startKg;
    if (Math.abs(total) < 0.05) return weight.current >= profile.goalWeightKg ? 100 : 0;
    const done = (weight.current - startKg) / total;
    return Math.max(0, Math.min(100, done * 100));
  }, [profile.goalWeightKg, weight]);

  useEffect(() => {
    query<WeekRow>(
      `SELECT strftime('%Y-%W', s.started_at) AS week_start,
              SUM(COALESCE(sl.load_kg, sl.weight_kg) * sl.reps) AS volume,
              COUNT(*) AS set_count
       FROM set_logs sl JOIN sessions s ON s.id = sl.session_id
       WHERE sl.is_warmup = 0
       GROUP BY week_start ORDER BY week_start DESC LIMIT 8`,
    ).then(setWeeks);

    // Fractional muscle split (THEORY.md §2.2): every set is split across
    // its muscles (primary full weight, secondary ×0.5, normalized), so
    // assistant muscles show up too instead of the primary muscle eating
    // the whole tonnage.
    query<MetricsRow>(
      `SELECT sl.session_id, sl.weight_kg, sl.load_kg, sl.reps, sl.rpe, sl.is_warmup,
              e.primary_muscles, e.secondary_muscles
       FROM set_logs sl JOIN exercises e ON e.id = sl.exercise_id
       WHERE sl.is_warmup = 0`,
    )
      .then((rows) =>
        setMuscles(
          fractionalAttribution(rows).sort((a, b) => b.fractional_tonnage - a.fractional_tonnage),
        ),
      )
      .catch(() => {});

    query<PRRow>(
      `SELECT sl.exercise_id, e.name_en, e.name_zh,
              MAX(sl.weight_kg) AS max_weight,
              MAX(COALESCE(sl.load_kg, sl.weight_kg) * sl.reps) AS best_volume,
              MAX(sl.reps) AS best_reps,
              MAX(s.started_at) AS pr_date
       FROM set_logs sl
       JOIN exercises e ON e.id = sl.exercise_id
       JOIN sessions s ON s.id = sl.session_id
       WHERE sl.is_warmup = 0
       GROUP BY sl.exercise_id
       ORDER BY max_weight DESC LIMIT 50`,
    ).then(setPrs);

    // Exercises with ≥ TREND.MIN_POINTS sessions carrying estimable sets
    // (candidates for the e1RM trend picker).
    query<TrendExRow>(
      `SELECT e.id, e.name_en, e.name_zh, e.slug, COUNT(DISTINCT s.id) AS n
       FROM set_logs sl
       JOIN exercises e ON e.id = sl.exercise_id
       JOIN sessions s ON s.id = sl.session_id
       WHERE sl.is_warmup = 0 AND sl.weight_kg > 0
         AND sl.reps BETWEEN 1 AND 12
       GROUP BY e.id
       HAVING n >= 3
       ORDER BY n DESC, e.name_zh
       LIMIT 30`,
    )
      .then((rows) => {
        setTrendExercises(rows);
        if (rows.length > 0) setTrendSlug((cur) => cur || rows[0].slug);
      })
      .catch(() => {});
  }, []);

  const maxWeekVolume = useMemo(
    () => Math.max(1, ...weeks.map((w) => w.volume ?? 0)),
    [weeks],
  );

  const totalStats = useMemo(() => {
    const totalVol = weeks.reduce((a, w) => a + (w.volume ?? 0), 0);
    const totalSets = weeks.reduce((a, w) => a + (w.set_count ?? 0), 0);
    return { totalVol, totalSets };
  }, [weeks]);

  const maxMuscleVol = Math.max(1, ...muscles.map((m) => m.fractional_tonnage));

  /** Region intensities for the body diagram, normalized to the max tonnage
   *  (same scale as the bar list); tooltip carries the formatted volume. */
  const diagramValues = useMemo(() => {
    const map = new Map<string, BodyDiagramValue>();
    for (const m of muscles) {
      if (m.fractional_tonnage <= 0) continue;
      map.set(m.muscle, {
        intensity: m.fractional_tonnage / maxMuscleVol,
        detail: `${formatVolume(m.fractional_tonnage, unit)} ${unit}`,
      });
    }
    return map;
  }, [muscles, maxMuscleVol, unit]);

  // e1RM trend series whenever the picked exercise changes.
  useEffect(() => {
    if (!trendSlug) return;
    let alive = true;
    query<MetricsRow>(
      `SELECT sl.session_id, sl.weight_kg, sl.reps, sl.rpe, sl.is_warmup, s.started_at
       FROM set_logs sl
       JOIN sessions s ON s.id = sl.session_id
       WHERE sl.exercise_id = (SELECT id FROM exercises WHERE slug = $1)
         AND sl.is_warmup = 0
       ORDER BY s.started_at`,
      [trendSlug],
    )
      .then((rows) => {
        if (!alive) return;
        // group by session, keep session order (ascending started_at)
        const perSession: MetricsRow[][] = [];
        let cur: number | null = null;
        for (const r of rows) {
          const ts = parseSqliteTimestamp(r.started_at ?? null);
          if (ts === null) continue;
          r.started_at = ts as unknown as string;
          if (r.session_id !== cur) {
            perSession.push([]);
            cur = r.session_id;
          }
          perSession[perSession.length - 1].push(r);
        }
        setTrendData(e1rmTrend(perSession));
      })
      .catch(() => alive && setTrendData(null));
    return () => {
      alive = false;
    };
  }, [trendSlug]);

  return (
    <div className="bg-[#F9F8F6] px-5 py-8 text-[#1C1C1C] lg:px-10 lg:py-12">
      <h1 className="ed-serif text-3xl lg:text-4xl">{t("stats.title")}</h1>
      <div className="mt-3 h-px w-full bg-[#1C1C1C]/10" />

      {/* Headline figures */}
      <div className="mt-12 grid grid-cols-3 gap-4 sm:gap-12">
        <div>
          <div className="ed-label">{t("stats.totalVolume")} (8w)</div>
          <div className="mt-2 ed-serif text-3xl leading-none lg:text-5xl">
            {formatVolume(totalStats.totalVol, unit)}
            <span className="ml-1 text-lg text-[#1C1C1C]/60 lg:text-xl">{unit}</span>
          </div>
        </div>
        <div>
          <div className="ed-label">{t("stats.totalSets")} (8w)</div>
          <div className="mt-2 ed-serif text-3xl leading-none lg:text-5xl">{totalStats.totalSets}</div>
        </div>
        <div>
          <div className="ed-label">{t("stats.prs")}</div>
          <div className="mt-2 ed-serif text-3xl leading-none lg:text-5xl">{prs.length}</div>
        </div>
      </div>

      {/* Weekly volume */}
      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-[#1C1C1C]/10 pb-4">
          <h2 className="ed-serif text-2xl">{t("stats.weeklyVolume")}</h2>
        </div>
        {weeks.length === 0 ? (
          <p className="mt-8 font-sans text-sm text-[#1C1C1C]/40">{t("common.empty")}</p>
        ) : (
          <div className="mt-10 flex h-44 items-end gap-6">
            {[...weeks].reverse().map((w) => (
              <div key={w.week_start} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                <div className="font-mono text-[0.55rem] text-[#1C1C1C]/40 max-sm:hidden">
                  {formatVolume(w.volume ?? 0, unit)}
                </div>
                <div className="flex h-full w-full items-end border-b border-[#1C1C1C]/10">
                  <div
                    className="w-full bg-[#1C1C1C] transition-all duration-500"
                    style={{ height: `${Math.max(2, ((w.volume ?? 0) / maxWeekVolume) * 100)}%` }}
                  />
                </div>
                <div className="font-mono text-[0.6rem] text-[#1C1C1C]/40">
                  {w.week_start.slice(5)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Muscle split */}
      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-[#1C1C1C]/10 pb-4">
          <h2 className="ed-serif text-2xl">{t("stats.muscleSplit")}</h2>
        </div>
        {muscles.length === 0 ? (
          <p className="mt-8 font-sans text-sm text-[#1C1C1C]/40">{t("common.empty")}</p>
        ) : (
          <div className="mt-8 flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-16">
            {/* Body map: darker region = larger share of tonnage */}
            <div className="shrink-0">
              <BodyDiagram values={diagramValues} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="space-y-4">
                {muscles.slice(0, 10).map((m) => (
                  <div key={m.muscle} className="flex items-center gap-3 sm:gap-6">
                    <span className="w-20 shrink-0 text-xs tracking-wide text-[#1C1C1C]/60 sm:w-28">
                      {t(`muscle.${m.muscle}`)}
                    </span>
                    <div className="h-px flex-1 relative">
                      <div className="absolute inset-x-0 top-1/2 h-px bg-[#1C1C1C]/10" />
                      <div
                        className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 bg-[#1C1C1C] transition-all duration-500"
                        style={{ width: `${(m.fractional_tonnage / maxMuscleVol) * 100}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right font-mono text-xs text-[#1C1C1C]/60">
                      {formatVolume(m.fractional_tonnage, unit)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="pt-4 font-sans text-xs text-[#1C1C1C]/40">
                {t("stats.fractionalNote")}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Training level by muscle */}
      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-[#1C1C1C]/10 pb-4">
          <h2 className="ed-serif text-2xl">{t("stats.trainingLevel.title")}</h2>
          <span className="ed-label">{t("stats.trainingLevel.window")}</span>
        </div>
        {!fatigue.ready || fatigue.levels.length === 0 ? (
          <p className="mt-8 font-sans text-sm text-[#1C1C1C]/40">{t("common.empty")}</p>
        ) : (
          <>
            <div className="mt-8 space-y-3">
              {fatigue.levels
                .slice()
                .sort((a, b) => b.level_ratio - a.level_ratio)
                .map((lv) => {
                  const style = LEVEL_CELL[lv.level];
                  const pct = Math.min(125, lv.level_ratio * 100);
                  return (
                    <div key={lv.muscle} className="flex items-center gap-3 sm:gap-6">
                      <span className="w-20 shrink-0 text-xs tracking-wide text-[#1C1C1C]/60 sm:w-28">
                        {t(`muscle.${lv.muscle}`)}
                      </span>
                      <div className="relative h-5 flex-1">
                        <div className="absolute inset-y-0 left-0 right-0 border-b border-[#1C1C1C]/10" />
                        <div
                          className={`absolute inset-y-0 left-0 transition-all duration-500 ${style.bg} ${lv.level === "untrained" ? "border border-[#1C1C1C]/15" : ""}`}
                          style={{ width: `${Math.max(pct, lv.level === "untrained" ? 0 : 4)}%` }}
                        />
                        <span
                          className={`absolute top-1/2 -translate-y-1/2 font-mono text-[0.6rem] ${style.text}`}
                          style={{ left: `calc(${Math.min(pct, 100)}% + 8px)` }}
                        >
                          {lv.weekly_sets > 0 ? lv.weekly_sets.toFixed(1) : "0"}
                        </span>
                      </div>
                      <span className={`w-20 shrink-0 text-right text-xs tracking-wide ${style.text === "text-[#F9F8F6]" ? "text-[#1C1C1C]/60" : style.text} max-sm:hidden`}>
                        {lv.weekly_sets > 0
                          ? t("stats.trainingLevel.weeklySets", { n: lv.weekly_sets.toFixed(1) })
                          : t(`stats.trainingLevel.level.${lv.level}`)}
                      </span>
                      <span className={`hidden w-24 shrink-0 text-right text-xs tracking-wide xl:inline ${style.text === "text-[#F9F8F6]" ? "text-[#1C1C1C]/60" : style.text}`}>
                        {lv.weeks_trained > 0
                          ? t("stats.trainingLevel.sessions", { n: lv.sessions })
                          : ""}
                      </span>
                    </div>
                  );
                })}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5">
              {(["maintenance", "developing", "optimal", "overreaching", "untrained"] as const).map((k) => (
                <span key={k} className="flex items-center gap-1.5 font-sans text-xs text-[#1C1C1C]/50">
                  <span className={`inline-block h-3 w-3 ${k === "untrained" ? "border border-[#1C1C1C]/15" : LEVEL_CELL[k].bg}`} />
                  {t(`stats.trainingLevel.level.${k}`)}
                </span>
              ))}
            </div>
            <p className="mt-6 font-sans text-xs text-[#1C1C1C]/40">{t("stats.trainingLevel.hint")}</p>
          </>
        )}
      </section>

      {/* PR table */}
      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-[#1C1C1C]/10 pb-4">
          <h2 className="ed-serif text-2xl">{t("stats.prs")}</h2>
          <span className="ed-label">{prs.length}</span>
        </div>
        {prs.length === 0 ? (
          <p className="mt-8 font-sans text-sm text-[#1C1C1C]/40">{t("stats.noPrs")}</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left ed-label">
                <th className="py-3 pr-4 font-normal">{t("common.name")}</th>
                <th className="py-3 pr-4 font-normal">{t("stats.prWeight")}</th>
                <th className="hidden py-3 pr-4 font-normal sm:table-cell">{t("stats.prVolume")}</th>
                <th className="hidden py-3 pr-4 font-normal sm:table-cell">{t("stats.prReps")}</th>
                <th className="py-3 font-normal">{t("stats.prDate")}</th>
              </tr>
            </thead>
            <tbody>
              {prs.map((p) => (
                <tr key={p.exercise_id} className="border-t border-[#1C1C1C]/10">
                  <td className="max-w-32 truncate py-2.5 pr-4">
                    <span className="ed-serif text-base">
                      {lang === "zh" ? p.name_zh : p.name_en}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-[#1C1C1C]">
                    {formatWeight(p.max_weight, unit)}
                    {unit}
                  </td>
                  <td className="hidden py-2.5 pr-4 font-mono text-[#1C1C1C]/80 sm:table-cell">
                    {formatVolume(p.best_volume, unit)}
                  </td>
                  <td className="hidden py-2.5 pr-4 font-mono text-[#1C1C1C]/80 sm:table-cell">{p.best_reps}</td>
                  <td className="py-2.5 font-mono text-xs text-[#1C1C1C]/40">
                    {p.pr_date.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Weight trend (THEORY.md §5) */}
      <section className="mt-20">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[#1C1C1C]/10 pb-4">
          <h2 className="ed-serif text-2xl">{t("stats.weight.title")}</h2>
          <div className="flex flex-wrap items-baseline gap-x-5">
            {weight.bodyFat !== null && (
              <span className="font-mono text-xs text-[#1C1C1C]/50">
                {t("stats.weight.bodyFat", { value: weight.bodyFat })}
              </span>
            )}
            {weight.perWeek !== null && (
              <span
                className={`font-mono text-xs ${weight.perWeek >= 0 ? "text-[#1C1C1C]/60" : "text-[#8C2F1B]"}`}
              >
                {weight.perWeek >= 0 ? "▲" : "▼"}{" "}
                {t("stats.weight.slope", {
                  value: Math.abs(Math.round(kgToDisplaySafe(weight.perWeek, unit) * 100) / 100),
                  unit,
                })}
              </span>
            )}
            {weight.current !== null && (
              <span className="font-mono text-xs text-[#1C1C1C]/60">
                {t("stats.weight.current")}: {formatWeight(weight.current, unit)}{unit}
              </span>
            )}
            {goalProgress !== null && (
              <span className="font-mono text-xs text-[#1C1C1C]/60">
                {t("stats.weight.goalProgress", {
                  value: Math.round(Math.abs(kgToDisplaySafe(goalProgress, unit)) * 10) / 10,
                  unit,
                  pct: Math.round(goalProgressPct),
                })}
              </span>
            )}
          </div>
        </div>
        {weight.points.length < 2 ? (
          <p className="mt-8 font-sans text-sm text-[#1C1C1C]/40">{t("stats.weight.noData")}</p>
        ) : (
          <>
            <WeightChart points={weight.points} unit={unit} totalChange={weight.totalChange} />
            {/* Strength-to-weight ratio: external-load PRs ÷ current
                bodyweight (bodyweight-only PRs have no external load to
                normalize — filtered out). */}
            {weight.current != null && weight.current > 0 && prs.some((p) => p.max_weight > 0) && (
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {prs.filter((p) => p.max_weight > 0).slice(0, 4).map((p) => (
                  <div key={p.exercise_id}>
                    <div className="truncate font-sans text-xs text-[#1C1C1C]/50">
                      {lang === "zh" ? p.name_zh : p.name_en}
                    </div>
                    <div className="mt-1 font-mono text-lg">
                      {(p.max_weight / weight.current!).toFixed(2)}
                      <span className="ml-1 text-xs text-[#1C1C1C]/40">×</span>
                    </div>
                  </div>
                ))}
                <div className="col-span-2 sm:col-span-4">
                  <p className="font-sans text-xs text-[#1C1C1C]/40">
                    {t("stats.weight.strengthRatio")}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* e1RM trend (THEORY.md §4.4) */}
      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-[#1C1C1C]/10 pb-4">
          <h2 className="ed-serif text-2xl">{t("stats.trend.title")}</h2>
          {trendData?.slopePerDay != null && (
            <span
              className={`font-mono text-xs ${trendData.slopePerDay >= 0 ? "text-[#1C1C1C]/60" : "text-[#8C2F1B]"}`}
            >
              {trendData.slopePerDay >= 0 ? "▲" : "▼"} {t("stats.trend.slope", { value: (trendData.slopePerDay * 7).toFixed(2), unit })}
            </span>
          )}
        </div>
        {trendExercises.length === 0 ? (
          <p className="mt-8 font-sans text-sm text-[#1C1C1C]/40">{t("stats.trend.noData")}</p>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              {trendExercises.map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => setTrendSlug(ex.slug)}
                  className={`border px-3 py-1.5 text-xs transition-colors ${
                    trendSlug === ex.slug
                      ? "border-[#1C1C1C] bg-[#1C1C1C] text-[#F9F8F6]"
                      : "border-[#1C1C1C]/20 text-[#1C1C1C]/60 hover:border-[#1C1C1C] hover:text-[#1C1C1C]"
                  }`}
                >
                  {lang === "zh" ? ex.name_zh : ex.name_en}
                </button>
              ))}
            </div>
            <TrendChart
              points={trendData?.points ?? []}
              unit={unit}
              emptyLabel={t("common.empty")}
              footer={
                trendData && trendData.points.length > 0
                  ? `${t("stats.trend.bestOfDay", { n: trendData.points.length })} · ${formatWeight(trendData.points[trendData.points.length - 1].e1rm, unit)}${unit} · ${new Date(trendData.points[trendData.points.length - 1].t).toISOString().slice(5, 10)}`
                  : t("common.empty")
              }
            />
          </>
        )}
      </section>

      {/* Fatigue monitor (THEORY.md §3) */}
      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-[#1C1C1C]/10 pb-4">
          <h2 className="ed-serif text-2xl">{t("stats.fatigue.title")}</h2>
          <span className="ed-label">{t("stats.fatigue.window")}</span>
        </div>

        {fatigue.deload.suggest && fatigue.ready && (
          <div className="mt-6 border border-[#1C1C1C] bg-[#1C1C1C] px-5 py-4 text-[#F9F8F6]">
            <div className="ed-label">{t("stats.fatigue.deloadTitle")}</div>
            <p className="mt-1.5 font-sans text-sm leading-relaxed">
              {fatigue.deload.overMrvMuscles.length > 0 &&
                t("stats.fatigue.deloadOverMrv", {
                  weeks: 2,
                  muscles: fatigue.deload.overMrvMuscles.map((m) => t(`muscle.${m}`)).join("、"),
                })}
              {fatigue.deload.overMrvMuscles.length > 0 && fatigue.deload.acwrSpike && " "}
              {fatigue.deload.acwrSpike &&
                t("stats.fatigue.deloadAcwr", { value: fatigue.acwr?.acwr?.toFixed(1) ?? "" })}
            </p>
            <p className="mt-1 font-sans text-xs text-[#F9F8F6]/60">
              {t("stats.fatigue.deloadHint")}
            </p>
          </div>
        )}

        {!fatigue.ready ? null : fatigue.weeks.length === 0 ? (
          <p className="mt-8 font-sans text-sm text-[#1C1C1C]/40">{t("common.empty")}</p>
        ) : (
          <>
            {/* Weekly per-muscle landmark heat grid */}
            <div className="mt-8 overflow-x-auto">
              <table className="w-full min-w-[560px] border-separate border-spacing-[3px]">
                <thead>
                  <tr>
                    <th className="w-24" />
                    {fatigue.weeks.map((w) => (
                      <th
                        key={w.key}
                        className={`ed-label px-1 pb-2 text-center font-normal ${w.key === fatigue.currentWeek ? "text-[#1C1C1C]" : "text-[#1C1C1C]/40"}`}
                      >
                        {w.key.replace(/^(\d{4})-W/, "W")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allMuscles(fatigue.weeks).map((muscle) => (
                    <tr key={muscle}>
                      <td className="w-24 pr-2 text-xs tracking-wide text-[#1C1C1C]/60">
                        {t(`muscle.${muscle}`)}
                      </td>
                      {fatigue.weeks.map((w) => {
                        const cell = w.bands.find((b) => b.muscle === muscle);
                        const band = cell?.band ?? "below-mev";
                        const style = BAND_CELL[band];
                        return (
                          <td key={w.key} className="text-center">
                            <div
                              className={`flex h-9 items-center justify-center font-mono text-[0.65rem] ${style.bg} ${
                                band === "above-mrv" ? "text-[#F9F8F6]" : "text-[#1C1C1C]/70"
                              }`}
                              title={`${t(`muscle.${muscle}`)} · ${cell ? cell.sets.toFixed(1) : "0"} ${t("stats.fatigue.setsUnit")} · ${t(style.label)}`}
                            >
                              {cell ? cell.sets.toFixed(1) : "–"}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5">
              {(Object.keys(BAND_CELL) as Array<keyof typeof BAND_CELL>).map((band) => (
                <span key={band} className="flex items-center gap-1.5 font-sans text-xs text-[#1C1C1C]/50">
                  <span className={`inline-block h-3 w-3 ${BAND_CELL[band].bg}`} />
                  {t(BAND_CELL[band].label)}
                </span>
              ))}
            </div>

            {/* Rolling indicators */}
            <div className="mt-8 grid grid-cols-3 gap-4">
              <FatigueStat
                label={t("stats.fatigue.acwr")}
                value={fatigue.acwr?.acwr != null ? fatigue.acwr.acwr.toFixed(2) : "–"}
                hint={
                  fatigue.acwr === null
                    ? t("stats.fatigue.noBaseline")
                    : fatigue.acwr.status === "spike"
                      ? t("stats.fatigue.acwrSpike")
                      : t("stats.fatigue.acwrOk")
                }
                emphasized={fatigue.acwr?.status === "spike"}
              />
              <FatigueStat
                label={t("stats.fatigue.monotony")}
                value={fatigue.monotony?.monotony != null ? fatigue.monotony.monotony.toFixed(2) : "–"}
                hint={
                  fatigue.monotony?.monotony == null
                    ? t("stats.fatigue.lowSample")
                    : fatigue.monotony.monotony > 2
                      ? t("stats.fatigue.monotonyHigh")
                      : t("stats.fatigue.monotonyOk")
                }
                emphasized={(fatigue.monotony?.monotony ?? 0) > 2}
              />
              <FatigueStat
                label={t("stats.fatigue.strain")}
                value={fatigue.monotony?.strain != null ? Math.round(fatigue.monotony.strain).toLocaleString() : "–"}
                hint={t("stats.fatigue.strainHint")}
                emphasized={false}
              />
            </div>

            {/* RPE coverage — never silently mixed (THEORY.md §2.4) */}
            <p className="mt-6 font-sans text-xs text-[#1C1C1C]/40">
              {t("stats.fatigue.coverage", {
                with: fatigue.coverage.n_with_rpe,
                total: fatigue.coverage.n_total,
              })}
              {fatigue.coverage.level === "low" && ` · ${t("stats.fatigue.coverageLow")}`}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

/** Union of muscles across the window's weeks, stable order. */
function allMuscles(weeks: Array<{ bands: MuscleWeeklyBand[] }>): string[] {
  const seen = new Set<string>();
  for (const w of weeks) for (const b of w.bands) seen.add(b.muscle);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function kgToDisplaySafe(kg: number, unit: string): number {
  return unit === "lb" ? kg * 2.2046226218 : kg;
}

/** Minimal SVG line chart of the smoothed weight series; point size shrinks
 *  as entries age, body-fat dots render hollow. Same visual language as the
 *  e1RM trend chart. Footer shows total change; hollow dots = logged body-fat. */
function WeightChart({
  points,
  unit,
  totalChange,
}: {
  points: Array<{ t: number; weight: number; body_fat: number | null }>;
  unit: string;
  totalChange: number | null;
}) {
  const { t } = useTranslation();
  const W = 640;
  const H = 180;
  const PAD_X = 8;
  const PAD_TOP = 14;
  const PAD_BOTTOM = 22;
  const conv = (kg: number) => (unit === "lb" ? kg * 2.2046226218 : kg);

  const xs = points.map((p) => p.t);
  const ys = points.map((p) => conv(p.weight));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys) * 0.97;
  const yMax = Math.max(...ys) * 1.03;
  const spanX = Math.max(1, xMax - xMin);
  const spanY = Math.max(1, yMax - yMin);
  const px = (t: number) => PAD_X + ((t - xMin) / spanX) * (W - 2 * PAD_X);
  const py = (v: number) => PAD_TOP + (1 - (v - yMin) / spanY) * (H - PAD_TOP - PAD_BOTTOM);

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.t).toFixed(1)},${py(conv(p.weight)).toFixed(1)}`).join(" ");

  const fmtDate = (t: number) => new Date(t).toISOString().slice(5, 10);

  return (
    <div className="mt-6">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        <line x1={PAD_X} y1={H - PAD_BOTTOM} x2={W - PAD_X} y2={H - PAD_BOTTOM} stroke="#1C1C1C" strokeOpacity={0.15} strokeWidth={1} />
        <path d={path} stroke="#1C1C1C" strokeWidth={1.5} fill="none" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={px(p.t)}
            cy={py(conv(p.weight))}
            r={p.body_fat !== null ? 3 : 2}
            fill={p.body_fat !== null ? "none" : "#1C1C1C"}
            stroke="#1C1C1C"
            strokeWidth={1.2}
          />
        ))}
        <text x={PAD_X} y={H - 6} fontSize={9} fill="#1C1C1C" fillOpacity={0.4} fontFamily="monospace">
          {fmtDate(points[0].t)}
        </text>
        <text x={W - PAD_X} y={H - 6} fontSize={9} fill="#1C1C1C" fillOpacity={0.4} fontFamily="monospace" textAnchor="end">
          {fmtDate(points[points.length - 1].t)}
        </text>
        <text x={PAD_X} y={12} fontSize={9} fill="#1C1C1C" fillOpacity={0.4} fontFamily="monospace">
          {Math.round(yMax)} {unit}
        </text>
      </svg>
      <p className="mt-1 font-sans text-xs text-[#1C1C1C]/40">
        {totalChange !== null &&
          t("stats.weight.totalChange", {
            value: `${totalChange >= 0 ? "+" : "−"}${Math.abs(Math.round(kgToDisplaySafe(totalChange, unit) * 10) / 10)}`,
            unit,
          })}
        {totalChange !== null && " · "}
        {t("stats.weight.bfHollow")}
      </p>
    </div>
  );
}

/** Minimal SVG line chart of the e1RM series with an OLS trend hairline
 *  over the last TREND.WINDOW points (descriptive — THEORY.md §4.4). */
function TrendChart({
  points,
  unit,
  emptyLabel,
  footer,
}: {
  points: Array<{ t: number; e1rm: number }>;
  unit: string;
  emptyLabel: string;
  footer: string;
}) {
  if (points.length === 0) {
    return <p className="mt-8 font-sans text-sm text-[#1C1C1C]/40">{emptyLabel}</p>;
  }

  const W = 640;
  const H = 200;
  const PAD_X = 8;
  const PAD_TOP = 14;
  const PAD_BOTTOM = 22;
  const kgToDisplayV = (kg: number) => (unit === "lb" ? kg * 2.2046226218 : kg);

  const xs = points.map((p) => p.t);
  const ys = points.map((p) => kgToDisplayV(p.e1rm));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys) * 0.97;
  const yMax = Math.max(...ys) * 1.03;
  const spanX = Math.max(1, xMax - xMin);
  const spanY = Math.max(1, yMax - yMin);
  const px = (t: number) => PAD_X + ((t - xMin) / spanX) * (W - 2 * PAD_X);
  const py = (v: number) => PAD_TOP + (1 - (v - yMin) / spanY) * (H - PAD_TOP - PAD_BOTTOM);

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.t).toFixed(1)},${py(kgToDisplayV(p.e1rm)).toFixed(1)}`).join(" ");

  // OLS hairline over the last WINDOW points (same window as the slope).
  const win = points.slice(-TREND.WINDOW);
  let linePath = "";
  if (win.length >= 2) {
    const wx = win.map((p) => p.t);
    const wy = win.map((p) => kgToDisplayV(p.e1rm));
    const mx = wx.reduce((a, b) => a + b, 0) / wx.length;
    const my = wy.reduce((a, b) => a + b, 0) / wy.length;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < wx.length; i++) {
      sxy += (wx[i] - mx) * (wy[i] - my);
      sxx += (wx[i] - mx) ** 2;
    }
    if (sxx > 0) {
      const slope = sxy / sxx;
      const at = (t: number) => my + slope * (t - mx);
      linePath = `M${px(wx[0]).toFixed(1)},${py(at(wx[0])).toFixed(1)} L${px(wx[wx.length - 1]).toFixed(1)},${py(at(wx[wx.length - 1])).toFixed(1)}`;
    }
  }

  const first = points[0];
  const last = points[points.length - 1];
  const fmtDate = (t: number) => new Date(t).toISOString().slice(5, 10);

  return (
    <div className="mt-6">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        <line x1={PAD_X} y1={H - PAD_BOTTOM} x2={W - PAD_X} y2={H - PAD_BOTTOM} stroke="#1C1C1C" strokeOpacity={0.15} strokeWidth={1} />
        {linePath && <path d={linePath} stroke="#1C1C1C" strokeOpacity={0.25} strokeWidth={1} strokeDasharray="4 4" fill="none" />}
        <path d={path} stroke="#1C1C1C" strokeWidth={1.5} fill="none" />
        {points.map((p, i) => (
          <circle key={i} cx={px(p.t)} cy={py(kgToDisplayV(p.e1rm))} r={2.5} fill="#1C1C1C" />
        ))}
        <text x={PAD_X} y={H - 6} fontSize={9} fill="#1C1C1C" fillOpacity={0.4} fontFamily="monospace">
          {fmtDate(first.t)}
        </text>
        <text x={W - PAD_X} y={H - 6} fontSize={9} fill="#1C1C1C" fillOpacity={0.4} fontFamily="monospace" textAnchor="end">
          {fmtDate(last.t)}
        </text>
        <text x={PAD_X} y={12} fontSize={9} fill="#1C1C1C" fillOpacity={0.4} fontFamily="monospace">
          {Math.round(yMax)} {unit}
        </text>
      </svg>
      <p className="mt-1 font-sans text-xs text-[#1C1C1C]/40">{footer}</p>
    </div>
  );
}

function FatigueStat({
  label,
  value,
  hint,
  emphasized,
}: {
  label: string;
  value: string;
  hint: string;
  emphasized: boolean;
}) {
  return (
    <div>
      <div className="ed-label">{label}</div>
      <div
        className={`mt-2 ed-serif text-2xl leading-none lg:text-3xl ${
          emphasized ? "text-[#8C2F1B]" : ""
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 font-sans text-xs text-[#1C1C1C]/40">{hint}</div>
    </div>
  );
}
