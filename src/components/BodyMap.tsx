/**
 * Human body muscle map (front + back) drawn from polygon geometry.
 *
 * Highlights the muscles targeted by an exercise in three gray levels:
 *   - primary muscles   → solid ink (near-black)
 *   - secondary muscles → mid gray (solid, stays legible at small sizes)
 *   - everything else   → faint base tint
 *
 * Geometry comes from src/data/body-model.json — per-muscle polygon sets
 * vendored from react-body-highlighter@2.0.5 (MIT); see
 * scripts/body-model-LICENSE and scripts/generate-body-model.cjs.
 * Region keys are this app's muscle vocabulary (chest, quads, lats, …);
 * per-view aliasing (front deltoids vs rear deltoids, soleus, …) is
 * resolved at data-generation time.
 *
 * Rendering: each view draws every region twice — an oversized base-tint
 * pass so the figure is always gap-free, then a highlight pass limited by
 * a clip path of the true silhouette so neighboring regions never bleed
 * over the body outline. Per-region strokes supply the contour lines.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { parseMuscles } from "../muscles";
import bodyModel from "../data/body-model.json";

export interface BodyMapColors {
  primary: string;
  secondary: string;
  base: string;
  line: string;
}

const DEFAULT_COLORS: BodyMapColors = {
  primary: "#1C1C1C", // solid ink
  secondary: "#9A9A9A", // mid gray, ~40% ink
  base: "#1C1C1C14", // ~8% ink
  line: "#1C1C1C40", // contour strokes
};

/** Base pass is drawn scaled about the center to hide seams between regions. */
const PAD = "translate(50 110) scale(1.05) translate(-50 -110)";
const STROKE = 0.4;

type ViewKey = "front" | "back";

interface Props {
  primaryMuscles: string;
  secondaryMuscles?: string;
  /** Show both front and back views (default true). */
  both?: boolean;
  colors?: Partial<BodyMapColors>;
  className?: string;
}

let uidSeq = 0;

export default function BodyMap({
  primaryMuscles,
  secondaryMuscles = "",
  both = true,
  colors,
  className = "",
}: Props) {
  const { t } = useTranslation();
  const c = { ...DEFAULT_COLORS, ...colors };
  const { primary, secondary } = parseMuscles(primaryMuscles, secondaryMuscles);
  const uid = useMemo(() => `bm-${++uidSeq}`, []);

  /** Highlight state of a region: primary ink > secondary mid gray > base. */
  const stateOf = (key: string): "primary" | "secondary" | "base" => {
    if (primary.includes(key)) return "primary";
    if (secondary.includes(key)) return "secondary";
    return "base";
  };

  /** Plain render function (not a component) — safe to call inline. */
  const renderView = (view: ViewKey, label: string) => {
    const clipId = `${uid}-${view}`;
    const regions = bodyModel[view];
    return (
      <svg viewBox={bodyModel.viewBox} className="h-40 w-auto" role="img" aria-label={label}>
        <defs>
          {/* clipPath children are unioned — one <polygon> per region shape;
              NEVER join disjoint polygons into a single points list, that
              would draw connecting lines straight across the figure. */}
          <clipPath id={clipId}>
            {regions.flatMap((r) => r.p).map((pts, i) => (
              <polygon key={i} points={pts} />
            ))}
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`} strokeLinejoin="round">
          {/* pass 1 — oversized base tint so the figure is always complete */}
          {regions.map((r, i) =>
            r.p.map((pts, j) => (
              <polygon key={`b${i}.${j}`} points={pts} fill={c.base} stroke={c.line} strokeWidth={STROKE} transform={PAD} />
            )),
          )}
          {/* pass 2 — highlights, clipped to the true silhouette */}
          {regions.map((r, i) => {
            const s = stateOf(r.m);
            if (s === "base") return null;
            return r.p.map((pts, j) => (
              <polygon
                key={`h${i}.${j}`}
                points={pts}
                fill={s === "primary" ? c.primary : c.secondary}
                stroke={c.line}
                strokeWidth={STROKE}
              />
            ));
          })}
        </g>
      </svg>
    );
  };

  return (
    <div className={`flex items-start justify-center gap-3 ${className}`}>
      <figure className="flex flex-col items-center">
        {renderView("front", t("muscle.front"))}
        {both && <figcaption className="ed-label mt-1.5 text-[0.55rem]">{t("muscle.front")}</figcaption>}
      </figure>
      {both && (
        <figure className="flex flex-col items-center">
          {renderView("back", t("muscle.back"))}
          <figcaption className="ed-label mt-1.5 text-[0.55rem]">{t("muscle.back")}</figcaption>
        </figure>
      )}
    </div>
  );
}
