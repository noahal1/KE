import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { Exercise } from "../types";
import { useSettings } from "../SettingsContext";
import ExerciseGif from "./ExerciseGif";
import BodyMap from "./BodyMap";
import { ModalShell } from "./ModalShell";

/**
 * Shared exercise-detail modal: name, equipment/category/pattern, body map,
 * primary/secondary muscles, demo GIF.
 *
 * Used by the exercise browser (with optional pick/delete actions) and by the
 * plan detail page (read-only inspection of a planned exercise).
 */
export default function ExerciseDetailModal({
  exercise,
  onClose,
  footer,
}: {
  exercise: Exercise;
  onClose: () => void;
  /** Optional footer content (e.g. pick / delete buttons in the browser). */
  footer?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { lang } = useSettings();
  const muscles = exercise.primary_muscles.split(",").filter(Boolean);
  const secondary = exercise.secondary_muscles.split(",").filter(Boolean);

  return (
    <ModalShell onClose={onClose} width="640px">
      <div className="flex items-start justify-between gap-6">
        <h2 className="ed-serif text-2xl leading-snug">
          {lang === "zh" ? exercise.name_zh : exercise.name_en}
        </h2>
        <button
          onClick={onClose}
          className="text-[#1C1C1C]/40 transition-colors hover:text-[#1C1C1C]"
          aria-label={t("common.close")}
        >
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </div>
      <div className="mt-3 ed-label">
        {t(`equipment.${exercise.equipment}`)} · {t(`category.${exercise.category}`)} ·{" "}
        {t(`pattern.${exercise.pattern}`)}
      </div>

      <div className="mt-6 flex items-start gap-8 max-sm:flex-col max-sm:gap-6">
        <BodyMap
          primaryMuscles={exercise.primary_muscles}
          secondaryMuscles={exercise.secondary_muscles}
        />
        <div className="min-w-0 flex-1">
          <div className="ed-label">{t("library.primary")}</div>
          <div className="mt-3 ed-serif text-base leading-relaxed text-[#1C1C1C]/80">
            {muscles.map((m) => t(`muscle.${m}`)).join(" · ")}
          </div>
          {secondary.length > 0 && (
            <>
              <div className="mt-5 ed-label">{t("library.secondary")}</div>
              <div className="mt-3 font-sans text-sm leading-relaxed text-[#1C1C1C]/60">
                {secondary.map((m) => t(`muscle.${m}`)).join(" · ")}
              </div>
            </>
          )}
        </div>
      </div>

      <ExerciseGif exercise={exercise} />

      {footer && (
        <>
          <div className="my-7 h-px w-full bg-[#1C1C1C]/10" />
          <div className="flex items-center justify-between">{footer}</div>
        </>
      )}
    </ModalShell>
  );
}
