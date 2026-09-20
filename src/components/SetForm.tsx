import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import type { Unit } from "../types";
import { kgToDisplay } from "../units";

interface Props {
  setNumber: number;
  lastSet?: { weight_kg: number; reps: number };
  repMin: number | null;
  repMax: number | null;
  targetSets: number | null;
  unit: Unit;
  /** Progression hint (kg domain) — prefills the form when no set of this
   *  exercise has been logged yet this session. */
  suggested?: { weightKg: number; reps: number };
  /** Live tonnage preview (display-unit domain): maps the current weight
   *  input to the effective load the set will count as (bodyweight pricing).
   *  Return null to hide the preview. */
  effectiveLoad?: (weightDisplay: number) => number | null;
  onLog: (weightDisplay: number, reps: number, rpe: number | null, warmup: boolean) => void;
}

const WEIGHT_STEP: Record<Unit, number> = { kg: 2.5, lb: 5 };

function StepButton({
  onClick,
  label,
  disabled,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center border border-[#1C1C1C]/20 text-[#1C1C1C]/60 transition-colors hover:border-[#1C1C1C] hover:text-[#1C1C1C] disabled:opacity-30"
    >
      {label === "+" ? (
        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
      ) : (
        <Minus className="h-3.5 w-3.5" strokeWidth={1.5} />
      )}
    </button>
  );
}

export default function SetForm({
  setNumber,
  lastSet,
  repMin,
  repMax,
  targetSets,
  unit,
  suggested,
  effectiveLoad,
  onLog,
}: Props) {
  const { t } = useTranslation();
  const step = WEIGHT_STEP[unit];
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState(
    repMin && repMax ? String(Math.round((repMin + repMax) / 2)) : "",
  );
  const [rpe, setRpe] = useState("");
  const [warmup, setWarmup] = useState(false);

  useEffect(() => {
    if (lastSet) {
      setWeight(String(Math.round(kgToDisplay(lastSet.weight_kg, unit) * 10) / 10));
      setReps(String(lastSet.reps));
    } else if (suggested) {
      setWeight(String(Math.round(kgToDisplay(suggested.weightKg, unit) * 10) / 10));
      setReps(String(suggested.reps));
    } else if (repMin && repMax) {
      setReps(String(Math.round((repMin + repMax) / 2)));
    }
  }, [lastSet, repMin, repMax, unit, suggested]);

  const bumpWeight = (delta: number) => {
    const cur = parseFloat(weight) || 0;
    const next = Math.max(0, Math.round((cur + delta) * 10) / 10);
    setWeight(String(next));
  };

  const bumpReps = (delta: number) => {
    const cur = parseInt(reps, 10);
    const next = Math.max(0, (Number.isNaN(cur) ? 0 : cur) + delta);
    setReps(String(next));
  };

  const bumpRpe = (delta: number) => {
    const cur = parseFloat(rpe) || 7.5;
    const next = Math.min(10, Math.max(5, Math.round((cur + delta) * 2) / 2));
    setRpe(String(next));
  };

  const submit = () => {
    const w = parseFloat(weight);
    const r = parseInt(reps, 10);
    if (Number.isNaN(r) || r < 0) return;
    const rp = rpe ? parseFloat(rpe) : null;
    onLog(Number.isNaN(w) ? 0 : w, r, rp, warmup);
    setRpe("");
    setWarmup(false);
  };

  const targetDone = targetSets != null && setNumber - 1 >= targetSets;

  // Live effective-load preview (bodyweight pricing): shown beside the
  // weight input so the user sees what the set's tonnage will count as.
  const wNum = parseFloat(weight);
  const previewLoad =
    effectiveLoad && Number.isFinite(wNum) ? effectiveLoad(Number.isNaN(wNum) ? 0 : wNum) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[#1C1C1C]/10 py-5">
      <span className="ed-label">
        {t("workout.setNumber", { n: setNumber })}
        {targetSets != null && (
          <span
            className={`ml-2 font-mono text-[0.6rem] ${targetDone ? "text-[#1C1C1C]/80" : "text-[#1C1C1C]/40"}`}
          >
            {targetDone ? "✓ " : ""}
            {setNumber - 1}/{targetSets}
          </span>
        )}
      </span>

      <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-3 max-sm:order-3 sm:contents">
        <label className="flex items-center gap-1.5">
          <StepButton onClick={() => bumpWeight(-step)} label="-" />
          <input
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="0"
            className="ed-num w-16"
            inputMode="decimal"
          />
          <span className="ed-label">{unit}</span>
          <StepButton onClick={() => bumpWeight(step)} label="+" />
          {previewLoad !== null && (
            <span
              className="font-mono text-[0.65rem] text-[#1C1C1C]/45"
              title={t("body.inclBodyweight")}
            >
              ≈ {Math.round(previewLoad * 10) / 10} {unit}
            </span>
          )}
        </label>

        <span className="text-xs text-[#1C1C1C]/40">×</span>

        <label className="flex items-center gap-1.5">
          <StepButton onClick={() => bumpReps(-1)} label="-" />
          <input
            type="number"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="10"
            className="ed-num w-14"
            inputMode="numeric"
          />
          <span className="ed-label">{t("common.reps")}</span>
          <StepButton onClick={() => bumpReps(1)} label="+" />
        </label>

        <label className="flex items-center gap-1.5">
          <StepButton onClick={() => bumpRpe(-0.5)} label="-" />
          <input
            type="number"
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="RPE"
            className="ed-num w-12"
            inputMode="decimal"
          />
          <StepButton onClick={() => bumpRpe(0.5)} label="+" />
        </label>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs tracking-wide text-[#1C1C1C]/60">
        <input
          type="checkbox"
          checked={warmup}
          onChange={(e) => setWarmup(e.target.checked)}
          className="h-3.5 w-3.5 appearance-none border border-[#1C1C1C]/40 checked:border-[#1C1C1C] checked:bg-[#1C1C1C]"
        />
        {t("common.warmup")}
      </label>

      <button
        onClick={submit}
        className="ed-btn ml-auto px-6 max-sm:order-2 max-sm:w-full max-sm:py-3"
      >
        {t("common.done")}
      </button>
    </div>
  );
}
