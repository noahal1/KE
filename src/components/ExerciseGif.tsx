/**
 * Exercise animation demo, shown at 180x180 from the open
 * exercises-dataset (https://github.com/hasaneyldrm/exercises-dataset).
 *
 * URLs come from gifUrlsFor(): local copy first, CDN mirrors as fallback.
 * If an <img> fails to load we advance to the next candidate URL.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Exercise } from "../types";
import { gifUrlsFor } from "../exerciseGifs";

export default function ExerciseGif({
  exercise,
  compact = false,
}: {
  exercise: Pick<Exercise, "slug" | "name_en" | "is_custom">;
  /** Compact layout for the active-session page. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const candidates = exercise.is_custom === 1 ? null : gifUrlsFor(exercise.slug);
  const [idx, setIdx] = useState(0);

  // Reset when the exercise changes.
  useEffect(() => setIdx(0), [exercise.slug]);

  if (!candidates || idx >= candidates.length) return null;
  const url = candidates[idx];

  return (
    <div className={compact ? "flex items-center gap-4" : "mt-6 flex items-center gap-6"}>
      <img
        src={url}
        width={180}
        height={180}
        loading="lazy"
        alt={exercise.name_en}
        className="h-[180px] w-[180px] shrink-0 border border-[#1C1C1C]/15 bg-white object-contain"
        onError={() => setIdx((i) => i + 1)}
      />
      <div>
        <div className="ed-label">{t("library.demo")}</div>
      </div>
    </div>
  );
}
