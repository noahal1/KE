import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { execute, query, run } from "../db";
import type { Exercise } from "../types";
import { useSettings } from "../SettingsContext";
import MuscleTags from "./MuscleTags";
import BodyMap from "./BodyMap";
import ExerciseDetailModal from "./ExerciseDetailModal";
import { useEscapeToClose } from "./ModalShell";
import CustomExerciseForm from "./CustomExerciseForm";

const EQUIPMENT_ORDER = [
  "barbell",
  "dumbbell",
  "ez-bar",
  "kettlebell",
  "cable",
  "machine",
  "smith",
  "trap-bar",
  "bodyweight",
  "band",
  "cardio",
  "stretch",
];

const MUSCLES = [
  "chest",
  "lats",
  "upper-back",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "quads",
  "hamstrings",
  "glutes",
  "adductors",
  "calves",
  "abs",
  "obliques",
  "core",
  "traps",
  "lower-back",
];

const PATTERNS = [
  "press",
  "pull",
  "squat",
  "hinge",
  "single-leg",
  "rotation",
  "carry",
  "full-body",
  "cardio",
  "core",
];

/**
 * Full exercise browser, opened from the exercise picker ("browse all" /
 * "create custom"). Browsing is only ever reached through an add-exercise
 * flow — there is no standalone library page anymore.
 *
 * Rendered on top of the picker (higher z); while it is open the picker
 * below stays untouched.
 */
export default function ExerciseBrowser({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  /** Selecting an exercise closes the browser AND the picker underneath. */
  onSelect: (exercise: Exercise) => void;
}) {
  const { t } = useTranslation();
  const { lang } = useSettings();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState("");
  const [equipment, setEquipment] = useState("all");
  const [muscle, setMuscle] = useState("all");
  const [pattern, setPattern] = useState("all");
  const [selected, setSelected] = useState<Exercise | null>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);

  useEffect(() => {
    if (open) {
      query<Exercise>("SELECT * FROM exercises ORDER BY equipment, name_zh").then(setExercises);
    }
  }, [open]);

  useEscapeToClose(onClose, open && !selected && !showCustomForm);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return exercises.filter((e) => {
      if (equipment !== "all" && e.equipment !== equipment) return false;
      if (pattern !== "all" && e.pattern !== pattern) return false;
      if (muscle !== "all") {
        const all = `${e.primary_muscles},${e.secondary_muscles}`;
        if (!all.split(",").includes(muscle)) return false;
      }
      if (!s) return true;
      return (
        e.name_en.toLowerCase().includes(s) ||
        e.name_zh.includes(search.trim()) ||
        e.primary_muscles.includes(s)
      );
    });
  }, [exercises, search, equipment, muscle, pattern]);

  const addCustom = async (
    nameEn: string,
    nameZh: string,
    equipment_: string,
    primary: string,
  ) => {
    const slug = `custom-${Date.now()}`;
    await execute(
      "INSERT INTO exercises (slug, name_en, name_zh, equipment, category, pattern, primary_muscles, secondary_muscles, is_custom) VALUES ($1,$2,$3,$4,'isolation','press',$5,'',1)",
      [slug, nameEn, nameZh, equipment_, primary],
    );
    setShowCustomForm(false);
    const rows = await query<Exercise>("SELECT * FROM exercises ORDER BY equipment, name_zh");
    setExercises(rows);
    // Hand the freshly created exercise straight to the caller.
    const created = rows.find((e) => e.slug === slug);
    if (created) {
      onSelect(created);
    }
  };

  const deleteCustom = async (ex: Exercise) => {
    if (!confirm(t("library.deleteConfirm"))) return;
    await run("DELETE FROM exercises WHERE id = $1 AND is_custom = 1", [ex.id]);
    setSelected(null);
    setExercises((rows) => rows.filter((e) => e.id !== ex.id));
  };

  const nameOf = (ex: Exercise) => (lang === "zh" ? ex.name_zh : ex.name_en);
  const hasFilters = search !== "" || equipment !== "all" || muscle !== "all" || pattern !== "all";
  const clearFilters = () => {
    setSearch("");
    setEquipment("all");
    setMuscle("all");
    setPattern("all");
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount =
    (equipment !== "all" ? 1 : 0) + (muscle !== "all" ? 1 : 0) + (pattern !== "all" ? 1 : 0);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#1C1C1C]/40 px-3 sm:px-6"
      onClick={onClose}
    >
      <div
        className="flex h-[92vh] w-full flex-col border border-[#1C1C1C] bg-[#F9F8F6] sm:h-[88vh] sm:max-w-[90vw]"
        style={{ maxWidth: "860px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex lg:flex-row flex-1 min-h-0">
          {/* Mobile filter toggle row */}
          <div className="flex w-full items-center justify-between gap-4 px-5 pt-5 lg:hidden">
            <button onClick={() => setFiltersOpen((v) => !v)} className="ed-btn-outline px-4 py-2 text-xs">
              {t("library.filters")}
              {activeFilterCount > 0 && ` · ${activeFilterCount}`}
            </button>
            <button onClick={() => setShowCustomForm(true)} className="ed-link ed-btn-quiet">
              + {t("library.addCustom")}
            </button>
          </div>

          {/* Filter rail: drawer on mobile, static column on desktop */}
          <aside
            className={`${
              filtersOpen ? "block" : "hidden"
            } w-full shrink-0 overflow-y-auto border-b border-[#1C1C1C]/10 px-5 py-6 lg:block lg:w-64 lg:border-b-0 lg:border-r lg:px-8 lg:py-10`}
          >
            <div className="hidden ed-label lg:block">{t("library.title")}</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("library.searchPlaceholder")}
              className="ed-input mt-6 mb-8"
            />

            <div className="ed-label mb-3">{t("library.equipment")}</div>
            <div className="mb-8 flex flex-wrap gap-x-1 gap-y-1.5">
              <Chip active={equipment === "all"} onClick={() => setEquipment("all")}>
                {t("common.all")}
              </Chip>
              {EQUIPMENT_ORDER.map((eq) => (
                <Chip key={eq} active={equipment === eq} onClick={() => setEquipment(eq)}>
                  {t(`equipment.${eq}`)}
                </Chip>
              ))}
            </div>

            <div className="ed-label mb-3">{t("library.muscle")}</div>
            <div className="mb-8 flex flex-wrap gap-x-1 gap-y-1.5">
              <Chip active={muscle === "all"} onClick={() => setMuscle("all")}>
                {t("common.all")}
              </Chip>
              {MUSCLES.map((m) => (
                <Chip key={m} active={muscle === m} onClick={() => setMuscle(m)}>
                  {t(`muscle.${m}`)}
                </Chip>
              ))}
            </div>

            <div className="ed-label mb-3">{t("library.pattern")}</div>
            <div className="flex flex-wrap gap-x-1 gap-y-1.5">
              <Chip active={pattern === "all"} onClick={() => setPattern("all")}>
                {t("common.all")}
              </Chip>
              {PATTERNS.map((p) => (
                <Chip key={p} active={pattern === p} onClick={() => setPattern(p)}>
                  {t(`pattern.${p}`)}
                </Chip>
              ))}
            </div>

            <div className="mt-auto hidden pt-10 lg:block">
              <button onClick={() => setShowCustomForm(true)} className="ed-link ed-btn-quiet">
                + {t("library.addCustom")}
              </button>
            </div>
          </aside>

          {/* Exercise grid */}
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 sm:px-8 sm:pt-8">
              <span className="ed-label">
                {filtered.length} {t("library.exercises")}
              </span>
              <button
                onClick={onClose}
                className="text-[#1C1C1C]/40 transition-colors hover:text-[#1C1C1C]"
                aria-label={t("common.close")}
              >
                <X className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-3 sm:px-8">
              {filtered.length === 0 && (
                <div className="mt-10">
                  <p className="max-w-md font-sans text-sm leading-relaxed text-[#1C1C1C]/60">
                    {t("library.noResults")}
                  </p>
                  {hasFilters && (
                    <button onClick={clearFilters} className="ed-btn-outline mt-6 text-xs">
                      {t("common.clearFilters")}
                    </button>
                  )}
                </div>
              )}

              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-0 max-sm:grid-cols-1">
                {filtered.map((ex, i) => (
                  <button
                    key={ex.id}
                    onClick={() => setSelected(ex)}
                    className="group ed-divider flex flex-col items-start py-4 text-left"
                  >
                    <div className="flex w-full items-baseline justify-between gap-3">
                      <span className="ed-serif text-base leading-snug transition-all duration-500 group-hover:italic">
                        {nameOf(ex)}
                      </span>
                      <span className="font-mono text-[0.6rem] text-[#1C1C1C]/40">
                        {String(i + 1).padStart(3, "0")}
                      </span>
                    </div>
                    <div className="mt-1.5 text-xs tracking-wide text-[#1C1C1C]/60">
                      {t(`equipment.${ex.equipment}`)} · {t(`pattern.${ex.pattern}`)}
                    </div>
                    <div className="mt-2 flex w-full items-center justify-between gap-3">
                      <span className="text-[0.65rem] tracking-[0.15em] uppercase text-[#1C1C1C]/40">
                        <MuscleTags primary={ex.primary_muscles} secondary={ex.secondary_muscles} />
                      </span>
                      <BodyMap
                        primaryMuscles={ex.primary_muscles}
                        secondaryMuscles={ex.secondary_muscles}
                        both={false}
                        className="shrink-0 [&_svg]:h-10 [&_svg]:w-auto [&_figcaption]:hidden"
                      />
                      {ex.is_custom === 1 && (
                        <span className="italic text-[#1C1C1C]/60">— {t("library.custom")}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </main>
        </div>
      </div>

      {selected && (
        <BrowserDetail
          exercise={selected}
          onClose={() => setSelected(null)}
          onPick={(ex) => {
            setSelected(null);
            onSelect(ex);
          }}
          onDelete={deleteCustom}
        />
      )}
      {showCustomForm && (
        <CustomExerciseForm onClose={() => setShowCustomForm(false)} onSave={addCustom} />
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className={active ? "ed-chip-active" : "ed-chip"}>
      {children}
    </button>
  );
}

/** Detail modal on top of the browser (z 70): pick or inspect, delete custom. */
function BrowserDetail({
  exercise,
  onClose,
  onPick,
  onDelete,
}: {
  exercise: Exercise;
  onClose: () => void;
  onPick: (ex: Exercise) => void;
  onDelete: (ex: Exercise) => void;
}) {
  const { t } = useTranslation();
  return (
    <ExerciseDetailModal
      exercise={exercise}
      onClose={onClose}
      footer={
        <>
          {exercise.is_custom === 1 ? (
            <button
              onClick={() => onDelete(exercise)}
              className="ed-btn-quiet text-[#1C1C1C]/60 hover:text-[#1C1C1C]"
            >
              {t("common.delete")}
            </button>
          ) : (
            <span />
          )}
          <button onClick={() => onPick(exercise)} className="ed-btn px-6 text-xs">
            {t("library.pick")}
          </button>
        </>
      }
    />
  );
}
