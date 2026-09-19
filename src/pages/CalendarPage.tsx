import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { query, execute, run } from "../db";
import type { Plan, PlanDay, Session } from "../types";
import { useSettings } from "../SettingsContext";
import { displayToKg, formatWeight, unitLabel } from "../units";

interface SessionAgg extends Session {
  set_count: number;
  total_volume: number;
}

/** One weight log keyed by local calendar day. */
interface WeightDay {
  /** "YYYY-M-D" local key, matching dateKey(). */
  key: string;
  weight_kg: number;
  body_fat_pct: number | null;
}

interface PlanWithDays {
  plan: Plan;
  days: PlanDay[];
  /** weekday numbers (0=Sun..6=Sat) this plan's days are scheduled on */
  schedule: Map<number, number[]>; // plan_day_id -> weekdays[]
}

interface DayCellInfo {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  sessions: SessionAgg[];
  /** plan days scheduled weekly on this weekday */
  scheduled: { plan: Plan; day: PlanDay }[];
  /** Weight logged on this day (latest entry of the day). */
  weight: { weight_kg: number; body_fat_pct: number | null } | null;
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Convert a UTC "YYYY-MM-DD HH:MM:SS" sqlite timestamp to local Date. */
function parseLocal(sql: string): Date {
  const [datePart, timePart = "00:00:00"] = sql.split(" ");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi, s] = timePart.split(":").map(Number);
  return new Date(y, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0);
}

const WEEKDAYS_ALL = [0, 1, 2, 3, 4, 5, 6];

/**
 * One-click schedule templates: N training days per week spread evenly.
 * weekday 0=Sun..6=Sat. Days are assigned round-robin to the chosen weekdays.
 */
const SCHEDULE_TEMPLATES: { key: string; weekdays: number[] }[] = [
  { key: "2", weekdays: [1, 4] },
  { key: "3", weekdays: [1, 3, 5] },
  { key: "4", weekdays: [1, 2, 4, 6] },
  { key: "5", weekdays: [1, 2, 3, 5, 6] },
  { key: "6", weekdays: [1, 2, 3, 4, 5, 6] },
];

export default function CalendarPage() {
  const { t } = useTranslation();
  const { unit } = useSettings();
  const today = useMemo(() => new Date(), []);

  const [cursor, setCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [sessions, setSessions] = useState<SessionAgg[]>([]);
  const [plans, setPlans] = useState<PlanWithDays[]>([]);
  const [weights, setWeights] = useState<Map<string, WeightDay>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sessRows = await query<SessionAgg>(
      `SELECT s.*,
        (SELECT COUNT(*) FROM set_logs sl WHERE sl.session_id = s.id) AS set_count,
        (SELECT COALESCE(SUM(COALESCE(sl.load_kg, sl.weight_kg) * sl.reps),0) FROM set_logs sl
          WHERE sl.session_id = s.id AND sl.is_warmup = 0) AS total_volume
      FROM sessions s WHERE s.finished_at IS NOT NULL`,
    );
    setSessions(sessRows);

    // Weight logs → local-day key (same keying as the grid cells).
    const wRows = await query<{ logged_at: string; weight_kg: number; body_fat_pct: number | null }>(
      "SELECT logged_at, weight_kg, body_fat_pct FROM body_logs ORDER BY logged_at",
    );
    const wMap = new Map<string, WeightDay>();
    for (const w of wRows) {
      const d = parseLocal(w.logged_at.replace("T", " ").slice(0, 19));
      wMap.set(dateKey(d), {
        key: dateKey(d),
        weight_kg: w.weight_kg,
        body_fat_pct: w.body_fat_pct,
      });
    }
    setWeights(wMap);

    const planRows = await query<Plan>("SELECT * FROM plans ORDER BY created_at");
    const dayRows = await query<PlanDay>("SELECT * FROM plan_days ORDER BY day_order");
    const schedRows = await query<{ plan_day_id: number; weekday: number }>(
      "SELECT plan_day_id, weekday FROM plan_day_schedule",
    );
    setPlans(
      planRows.map((plan) => ({
        plan,
        days: dayRows.filter((d) => d.plan_id === plan.id),
        schedule: new Map(
          schedRows
            .filter((s) => dayRows.some((d) => d.id === s.plan_day_id && d.plan_id === plan.id))
            .reduce((acc, s) => {
              const list = acc.get(s.plan_day_id) ?? [];
              list.push(s.weekday);
              acc.set(s.plan_day_id, list);
              return acc;
            }, new Map<number, number[]>()),
        ),
      })),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 6-week grid (42 cells) starting on Sunday, matching the app's Date.getDay convention. */
  const grid = useMemo((): DayCellInfo[] => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const cells: DayCellInfo[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dateKey(d);
      const dow = d.getDay();
      cells.push({
        date: d,
        inMonth: d.getMonth() === cursor.getMonth(),
        isToday: dateKey(today) === key,
        sessions: sessions.filter((s) => parseLocal(s.started_at).toDateString() === d.toDateString()),
        scheduled: plans.flatMap((p) =>
          p.days
            .filter((day) => (p.schedule.get(day.id) ?? []).includes(dow))
            .map((day) => ({ plan: p.plan, day })),
        ),
        weight: weights.get(key) ?? null,
      });
    }
    return cells;
  }, [cursor, sessions, plans, weights, today]);

  const toggleSchedule = async (dayId: number, weekday: number, current: number[]) => {
    if (current.includes(weekday)) {
      await run("DELETE FROM plan_day_schedule WHERE plan_day_id = $1 AND weekday = $2", [
        dayId,
        weekday,
      ]);
    } else {
      await execute(
        "INSERT OR IGNORE INTO plan_day_schedule (plan_day_id, weekday) VALUES ($1,$2)",
        [dayId, weekday],
      );
    }
    load();
  };

  /**
   * One-click template: replace every schedule entry of this plan with the
   * template's weekdays, distributing the plan's days round-robin across them.
   */
  const applyTemplatePlan = async (
    plan: Plan,
    dayIds: number[],
    weekdays: number[],
  ) => {
    await run("DELETE FROM plan_day_schedule WHERE plan_day_id IN (SELECT id FROM plan_days WHERE plan_id = $1)", [
      plan.id,
    ]);
    for (let i = 0; i < dayIds.length; i++) {
      const wd = weekdays[i % weekdays.length];
      await execute(
        "INSERT OR IGNORE INTO plan_day_schedule (plan_day_id, weekday) VALUES ($1,$2)",
        [dayIds[i], wd],
      );
    }
    load();
  };

  const monthLabel = cursor.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  const selectedInfo = selected ? grid.find((c) => dateKey(c.date) === selected) : undefined;

  // Lock body scroll while the mobile bottom sheet is open (restores on
  // close and if the viewport crosses the breakpoint while open).
  useEffect(() => {
    if (!selected) return;
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = () => {
      document.body.style.overflow = mq.matches ? "hidden" : "";
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      document.body.style.overflow = "";
    };
  }, [selected]);

  const hasAnyPlan = plans.length > 0;
  const weekHeaderLabels = t("calendar.weekHeader", { returnObjects: true }) as unknown as string[];

  return (
    <div className="bg-[#F9F8F6] px-5 py-8 text-[#1C1C1C] lg:px-10 lg:py-12">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <h1 className="ed-serif text-3xl lg:text-4xl">{t("calendar.title")}</h1>
        <button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))} className="ed-link ed-btn-quiet">
          {t("calendar.today")}
        </button>
      </div>
      <div className="mt-3 h-px w-full bg-[#1C1C1C]/10" />

      {hasAnyPlan && (
        <p className="mt-6 max-w-2xl font-sans text-sm leading-relaxed text-[#1C1C1C]/60">
          {t("calendar.scheduleHint")}
        </p>
      )}

      {/* Month navigation */}
      <div className="mt-8 flex items-center justify-between">
        <div className="flex items-baseline gap-6">
          <button
            aria-label={t("calendar.prevMonth")}
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="text-[#1C1C1C]/40 transition-colors hover:text-[#1C1C1C]"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <h2 className="ed-serif text-3xl">{monthLabel}</h2>
          <button
            aria-label={t("calendar.nextMonth")}
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="text-[#1C1C1C]/40 transition-colors hover:text-[#1C1C1C]"
          >
            <ChevronRight className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Month grid */}
      <div className="-mx-5 mt-6 overflow-x-auto px-5 pb-2 sm:mx-0 sm:overflow-visible sm:px-0">
      <div className="min-w-[640px] grid grid-cols-7 border-l border-t border-[#1C1C1C]/10 sm:min-w-0">
        {weekHeaderLabels.map((wd) => (
          <div key={wd} className="ed-label border-b border-r border-[#1C1C1C]/10 py-3 pl-3">
            {wd}
          </div>
        ))}
        {grid.map((cell, i) => {
          const key = dateKey(cell.date);
          const isSelected = selected === key;
          return (
            <button
              key={i}
              onClick={() => setSelected(isSelected ? null : key)}
              className={`group relative min-h-20 border-b border-r border-[#1C1C1C]/10 p-1.5 text-left transition-colors duration-200 sm:min-h-24 sm:p-2 ${
                cell.inMonth ? "bg-transparent" : "bg-[#1C1C1C]/[0.03]"
              } ${isSelected ? "bg-[#1C1C1C]/[0.06]" : "hover:bg-[#1C1C1C]/[0.03]"}`}
            >
              <CellHoverCard cell={cell} flipX={i % 7 >= 5} flipY={i >= 35} />
              <span
                className={`font-mono text-[0.65rem] ${
                  cell.isToday
                    ? "inline-flex h-5 w-5 items-center justify-center bg-[#1C1C1C] text-[#F9F8F6]"
                    : cell.inMonth
                      ? "text-[#1C1C1C]/50"
                      : "text-[#1C1C1C]/30"
                }`}
              >
                {cell.date.getDate()}
              </span>

              <div className="mt-1 space-y-1">
                {cell.weight && (
                  <div
                    className="truncate text-[0.6rem] leading-tight text-[#1C1C1C]/45"
                    title={`${t("body.logWeight")}: ${formatWeight(cell.weight.weight_kg, unit)}${unitLabel(unit)}`}
                  >
                    ◦ {formatWeight(cell.weight.weight_kg, unit)}
                  </div>
                )}
                {cell.scheduled.slice(0, 2).map(({ plan, day }) => {
                  const done = cell.sessions.some((s) => s.plan_day_id === day.id);
                  return (
                    <div
                      key={`${plan.id}-${day.id}`}
                      className={`truncate border-l-2 pl-1 text-[0.6rem] leading-tight sm:pl-1.5 sm:text-[0.65rem] ${
                        done
                          ? "border-[#1C1C1C]/30 text-[#1C1C1C]/40 line-through"
                          : "border-[#1C1C1C] text-[#1C1C1C]"
                      }`}
                      title={`${plan.name} · ${day.name}`}
                    >
                      {day.name}
                    </div>
                  );
                })}
                {cell.scheduled.length > 2 && (
                  <div className="text-[0.6rem] text-[#1C1C1C]/40">
                    +{cell.scheduled.length - 2}
                  </div>
                )}
                {cell.sessions
                  .filter((s) => !cell.scheduled.some(({ day }) => day.id === s.plan_day_id))
                  .slice(0, 2)
                  .map((s) => (
                    <div
                      key={s.id}
                      className="truncate pl-1.5 text-[0.65rem] leading-tight text-[#1C1C1C]/50"
                      title={s.name}
                    >
                      ● {s.name}
                    </div>
                  ))}
              </div>
            </button>
          );
        })}
      </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-8 text-[0.65rem] tracking-wide text-[#1C1C1C]/50">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-0.5 bg-[#1C1C1C]" />
          {t("calendar.scheduled")}
        </span>
        <span className="flex items-center gap-2">● {t("calendar.completed")}</span>
        <span className="flex items-center gap-2">◦ {t("body.logWeight")}</span>
      </div>

      {/* Selected day: inline panel on desktop, bottom sheet on mobile.
          The sheet lives outside the grid's overflow-x container, so it
          never gets clipped by the mobile grid's horizontal scrolling. */}
      {selectedInfo && (
        <>
          <div className="mt-10 hidden border border-[#1C1C1C]/10 p-8 sm:block">
            <DayDetailContent
              info={selectedInfo}
              onLogged={load}
              onClose={() => setSelected(null)}
            />
          </div>
          <div className="sm:hidden">
            <div
              className="fixed inset-0 z-40 bg-[#1C1C1C]/25"
              onClick={() => setSelected(null)}
            />
            <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto border-t border-[#1C1C1C]/15 bg-[#F9F8F6] px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_40px_rgba(28,28,28,0.15)]">
              <div aria-hidden className="mx-auto mt-1 h-1 w-10 bg-[#1C1C1C]/15" />
              <DayDetailContent
                info={selectedInfo}
                onLogged={load}
                onClose={() => setSelected(null)}
              />
            </div>
          </div>
        </>
      )}

      {/* Weekly schedule editor */}
      {hasAnyPlan && (
        <section className="mt-16">
          <div className="flex items-baseline justify-between border-b border-[#1C1C1C]/10 pb-4">
            <h2 className="ed-serif text-2xl">{t("calendar.editSchedule")}</h2>
          </div>
          <div className="mt-8 space-y-12">
            {plans.map(({ plan, days, schedule }) => (
              <div key={plan.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="ed-serif text-xl">{plan.name}</h3>
                  {days.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="ed-label mr-1">{t("calendar.templates")}</span>
                      {SCHEDULE_TEMPLATES.map((tpl) => (
                        <button
                          key={tpl.key}
                          onClick={() => applyTemplatePlan(plan, days.map((d) => d.id), tpl.weekdays)}
                          className="ed-chip"
                          title={tpl.weekdays.join(",")}
                        >
                          {t("calendar.templateLabel", { n: tpl.weekdays.length })}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {days.length === 0 && (
                    <p className="font-sans text-sm text-[#1C1C1C]/40">{t("plans.noExercises")}</p>
                  )}
                  {days.map((day) => {
                    const current = schedule.get(day.id) ?? [];
                    return (
                      <div key={day.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2 sm:flex-nowrap">
                        <span className="w-40 max-w-full shrink-0 truncate ed-serif text-base sm:w-48">{day.name}</span>
                        <div className="flex flex-wrap gap-1.5">
                          {WEEKDAYS_ALL.map((wd) => {
                            const active = current.includes(wd);
                            const labels = weekHeaderLabels;
                            return (
                              <button
                                key={wd}
                                onClick={() => toggleSchedule(day.id, wd, current)}
                                className={`h-7 w-7 font-mono text-[0.65rem] transition-colors duration-200 ${
                                  active
                                    ? "bg-[#1C1C1C] text-[#F9F8F6]"
                                    : "text-[#1C1C1C]/40 hover:text-[#1C1C1C] shadow-[inset_0_0_0_1px_rgba(28,28,28,0.2)]"
                                }`}
                                title={labels[wd]}
                              >
                                {labels[wd]}
                              </button>
                            );
                          })}
                          {current.length > 0 && (
                            <button
                              onClick={async () => {
                                await run("DELETE FROM plan_day_schedule WHERE plan_day_id = $1", [day.id]);
                                load();
                              }}
                              className="ed-link ed-btn-quiet ml-3 text-[0.65rem] text-[#1C1C1C]/40 hover:text-[#1C1C1C]"
                            >
                              {t("calendar.removeSlot")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!hasAnyPlan && (
        <p className="mt-16 max-w-md font-sans text-sm leading-relaxed text-[#1C1C1C]/60">
          {t("calendar.noPlans")}
        </p>
      )}
    </div>
  );
}

/** Floating hover summary of a day cell (desktop only — touch devices use
 *  the click-selected panel below the grid). Pure CSS reveal via group-hover
 *  with a short delay so skimming the grid doesn't flicker; pointer-events
 *  are disabled so the card never blocks the cell's click. */
function CellHoverCard({
  cell,
  flipX,
  flipY,
}: {
  cell: DayCellInfo;
  /** Anchor to the cell's right edge (last columns) instead of the left. */
  flipX: boolean;
  /** Anchor above the cell (last row) instead of below. */
  flipY: boolean;
}) {
  const { t } = useTranslation();
  const { unit } = useSettings();
  const unscheduledDone = cell.sessions.filter(
    (s) => !cell.scheduled.some(({ day }) => day.id === s.plan_day_id),
  );
  const empty =
    cell.sessions.length === 0 && cell.scheduled.length === 0 && !cell.weight;
  return (
    <div
      className={`pointer-events-none absolute z-30 hidden w-56 max-w-[70vw] border border-[#1C1C1C]/15 bg-[#F9F8F6] p-3 opacity-0 shadow-[0_8px_24px_rgba(28,28,28,0.10)] transition-opacity delay-150 duration-150 group-hover:opacity-100 sm:block ${
        flipY ? "bottom-full mb-1.5" : "top-full mt-1.5"
      } ${flipX ? "right-0" : "left-0"}`}
    >
      <div className="ed-label">
        {cell.date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          weekday: "short",
        })}
      </div>
      {empty ? (
        <p className="mt-2 font-sans text-xs text-[#1C1C1C]/40">{t("calendar.restDay")}</p>
      ) : (
        <div className="mt-2 space-y-2">
          {cell.weight && (
            <div className="truncate font-mono text-xs text-[#1C1C1C]/60">
              ◦ {formatWeight(cell.weight.weight_kg, unit)}{unitLabel(unit)}
              {cell.weight.body_fat_pct !== null &&
                ` · ${t("body.bodyFatShort")} ${cell.weight.body_fat_pct}%`}
            </div>
          )}
          {cell.scheduled.map(({ plan, day }) => {
            const done = cell.sessions.some((s) => s.plan_day_id === day.id);
            return (
              <div key={`hs-${plan.id}-${day.id}`} className="min-w-0">
                <div
                  className={`truncate border-l-2 pl-1.5 text-xs leading-snug ${
                    done
                      ? "border-[#1C1C1C]/30 text-[#1C1C1C]/40 line-through"
                      : "border-[#1C1C1C] text-[#1C1C1C]"
                  }`}
                >
                  {day.name}
                </div>
                <div className="truncate pl-2.5 text-[0.65rem] text-[#1C1C1C]/40">
                  {plan.name}
                  {done && ` · ${t("calendar.completed")}`}
                </div>
              </div>
            );
          })}
          {unscheduledDone.map((s) => (
            <div key={`hs-${s.id}`} className="min-w-0">
              <div className="truncate pl-1.5 text-xs leading-snug text-[#1C1C1C]/60">
                ● {s.name}
              </div>
              <div className="truncate pl-2.5 font-mono text-[0.65rem] text-[#1C1C1C]/40">
                {t("calendar.sets", { n: s.set_count })} ·{" "}
                {Math.round(s.total_volume).toLocaleString()} {unitLabel(unit)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Shared day-detail content: date header, scheduled plan days, past
 *  sessions, weight quick log. Rendered both in the desktop panel and the
 *  mobile bottom sheet. Rows truncate instead of wrapping on narrow screens. */
function DayDetailContent({
  info,
  onLogged,
  onClose,
}: {
  info: DayCellInfo;
  onLogged: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { unit } = useSettings();
  const navigate = useNavigate();
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="ed-serif text-2xl">
          {info.date.toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            weekday: "long",
          })}
        </h3>
        <button
          onClick={onClose}
          className="text-[#1C1C1C]/40 transition-colors hover:text-[#1C1C1C]"
          aria-label={t("common.close")}
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="mt-3 h-px w-full bg-[#1C1C1C]/10" />

      {/* Scheduled plan days for that date */}
      {info.scheduled.length > 0 && (
        <div className="mt-6">
          <div className="ed-label">{t("calendar.scheduled")}</div>
          <div className="mt-2">
            {info.scheduled.map(({ plan, day }) => {
              const done = info.sessions.some((s) => s.plan_day_id === day.id);
              return (
                <div key={`${plan.id}-${day.id}`} className="ed-divider flex items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <div className={`ed-serif text-lg ${done ? "text-[#1C1C1C]/40 line-through" : ""}`}>
                      {day.name}
                    </div>
                    <div className="mt-0.5 truncate text-xs tracking-wide text-[#1C1C1C]/50">{plan.name}</div>
                  </div>
                  {done ? (
                    <span className="ed-label shrink-0">{t("calendar.completed")}</span>
                  ) : (
                    <button
                      onClick={() => navigate(`/workout/day/${day.id}`)}
                      className="ed-link ed-btn-quiet shrink-0"
                    >
                      {t("calendar.start")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Past sessions on that date */}
      {info.sessions.length > 0 && (
        <div className="mt-6">
          <div className="ed-label">{t("calendar.sessionsInDay")}</div>
          <div className="mt-2">
            {info.sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => navigate(`/history/${s.id}`)}
                className="ed-divider flex cursor-pointer items-center justify-between gap-3 py-4"
              >
                <div className="min-w-0">
                  <div className="ed-serif text-lg transition-all duration-500 hover:italic">{s.name}</div>
                  <div className="mt-0.5 text-xs tracking-wide text-[#1C1C1C]/50">
                    {t("calendar.sets", { n: s.set_count })} · {Math.round(s.total_volume).toLocaleString()} {unitLabel(unit)}
                  </div>
                </div>
                <span className="ed-label shrink-0">{t("history.viewDetail")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log a weight for the selected day (backfill included) */}
      <WeightQuickLog date={info.date} existing={info.weight} onLogged={onLogged} />

      {info.scheduled.length === 0 && info.sessions.length === 0 && (
        <p className="mt-6 font-sans text-sm text-[#1C1C1C]/40">{t("calendar.restDay")}</p>
      )}
    </div>
  );
}

/** Inline weight log for the selected calendar day: shows the existing entry
 *  (replaceable) or a quick input. Backfills body_logs with the chosen date. */
function WeightQuickLog({
  date,
  existing,
  onLogged,
}: {
  date: Date;
  existing: { weight_kg: number; body_fat_pct: number | null } | null;
  onLogged: () => void;
}) {
  const { t } = useTranslation();
  const { unit, logWeight } = useSettings();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return;
    setBusy(true);
    try {
      // Backfill: stamp the log with the selected day at noon local, so it
      // lands on the same calendar day regardless of later DST shifts.
      const stamp = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
      const pad = (n: number) => String(n).padStart(2, "0");
      const sql = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}:${pad(stamp.getSeconds())}`;
      await logWeight(displayToKg(v, unit), existing?.body_fat_pct ?? null, sql);
      setValue("");
      onLogged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="ed-label">{t("body.logWeight")}</span>
      {existing && (
        <span className="font-mono text-xs text-[#1C1C1C]/50">
          {formatWeight(existing.weight_kg, unit)}{unitLabel(unit)}
          {existing.body_fat_pct !== null && ` · ${t("body.bodyFatShort")} ${existing.body_fat_pct}%`}
        </span>
      )}
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
        placeholder={existing ? String(Math.round(existing.weight_kg * 10) / 10) : "70.0"}
        className="w-24 border-b border-[#1C1C1C]/20 bg-transparent pb-1 font-mono text-sm outline-none focus:border-[#1C1C1C]"
      />
      <span className="ed-label">{unitLabel(unit)}</span>
      <button
        onClick={() => void submit()}
        disabled={value.trim() === "" || busy}
        className="ed-link ed-btn-quiet text-xs uppercase disabled:opacity-30"
      >
        {existing ? t("body.replace") : t("common.save")}
      </button>
    </div>
  );
}
