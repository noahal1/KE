import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { query } from "../db";
import type { Exercise } from "../types";
import { useSettings } from "../SettingsContext";
import { useEscapeToClose } from "./ModalShell";
import MuscleTags from "./MuscleTags";
import ExerciseBrowser from "./ExerciseBrowser";

/** Body-part chips shown in the picker (primary OR secondary match). */
const MUSCLE_CHIPS = [
  "chest",
  "lats",
  "upper-back",
  "shoulders",
  "biceps",
  "triceps",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "abs",
  "obliques",
  "core",
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (exercise: Exercise) => void;
}

export default function ExercisePicker({ open, onClose, onSelect }: Props) {
  const { t } = useTranslation();
  const { lang } = useSettings();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState("");
  const [equipment, setEquipment] = useState("all");
  const [muscle, setMuscle] = useState("all");
  const [browseOpen, setBrowseOpen] = useState(false);

  useEffect(() => {
    if (open) {
      query<Exercise>("SELECT * FROM exercises ORDER BY name_zh").then(setExercises);
    }
  }, [open]);

  useEscapeToClose(onClose, open && !browseOpen);

  const equipmentOptions = useMemo(
    () => [...new Set(exercises.map((e) => e.equipment))],
    [exercises],
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return exercises.filter((e) => {
      if (equipment !== "all" && e.equipment !== equipment) return false;
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
  }, [exercises, search, equipment, muscle]);

  if (!open) return null;

  const handleSelect = (ex: Exercise) => {
    onSelect(ex);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1C1C]/40 px-3 sm:px-6"
      onClick={onClose}
    >
      <div
        className="flex h-[92vh] w-full flex-col border border-[#1C1C1C] bg-[#F9F8F6] p-6 sm:h-[80vh] sm:max-w-[90vw] sm:p-10"
        style={{ maxWidth: "720px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="ed-serif text-2xl">{t("library.addExercise")}</h2>
          <button
            onClick={onClose}
            className="text-[#1C1C1C]/40 transition-colors hover:text-[#1C1C1C]"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-4 sm:gap-6">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("library.searchPlaceholder")}
            className="ed-input min-w-0 flex-1"
          />
          <select
            value={equipment}
            onChange={(e) => setEquipment(e.target.value)}
            className="ed-select mb-1 w-32 shrink-0 sm:w-40"
          >
            <option value="all">{t("common.all")}</option>
            {equipmentOptions.map((eq) => (
              <option key={eq} value={eq}>
                {t(`equipment.${eq}`)}
              </option>
            ))}
          </select>
        </div>

        {/* Body-part filter chips (THE picker's main axis) */}
        <div className="mt-4 flex flex-wrap gap-x-1 gap-y-1.5">
          <button
            onClick={() => setMuscle("all")}
            className={muscle === "all" ? "ed-chip-active" : "ed-chip"}
          >
            {t("common.all")}
          </button>
          {MUSCLE_CHIPS.map((m) => (
            <button
              key={m}
              onClick={() => setMuscle(muscle === m ? "all" : m)}
              className={muscle === m ? "ed-chip-active" : "ed-chip"}
            >
              {t(`muscle.${m}`)}
            </button>
          ))}
        </div>

        <div className="mt-8 flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="py-10 text-center">
              <p className="font-sans text-sm text-[#1C1C1C]/40">{t("library.noResults")}</p>
              <button
                onClick={() => setBrowseOpen(true)}
                className="ed-btn-outline mt-6 text-xs"
              >
                {t("picker.browseAll")}
              </button>
            </div>
          )}
          {filtered.map((ex) => (
            <button
              key={ex.id}
              onClick={() => handleSelect(ex)}
              className="group ed-divider flex w-full items-center justify-between py-3.5 text-left"
            >
              <span className="ed-serif text-base transition-all duration-500 group-hover:italic">
                {lang === "zh" ? ex.name_zh : ex.name_en}
              </span>
              <span className="flex shrink-0 items-center gap-4 text-xs text-[#1C1C1C]/60">
                <span className="ed-label">{t(`equipment.${ex.equipment}`)}</span>
                <MuscleTags primary={ex.primary_muscles} secondary={ex.secondary_muscles} max={2} />
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 border-t border-[#1C1C1C]/10 pt-4">
          <button onClick={() => setBrowseOpen(true)} className="ed-link ed-btn-quiet text-xs">
            {t("picker.browseAll")}
          </button>
        </div>
      </div>

      {/* Full browser (filters, detail, custom exercise) — layered on top. */}
      <ExerciseBrowser
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onSelect={handleSelect}
      />
    </div>
  );
}
