import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { ModalShell } from "./ModalShell";
import {
  buildPlanBundle,
  bundleToCsv,
  bundleToJson,
  downloadText,
  importPlans,
  parseCsvPlan,
  parseJsonPlan,
  type ImportSummary,
} from "../planIO";
import type { Plan } from "../types";

interface Props {
  open: boolean;
  plans: Plan[];
  onClose: () => void;
  onImported: () => void;
}

export default function PlanIOModal({ open, plans, onClose, onImported }: Props) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  if (!open) return null;

  const exportAs = async (kind: "json" | "csv") => {
    setBusy(true);
    try {
      const bundle = await buildPlanBundle();
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === "json") {
        downloadText(`fitplan-plans-${stamp}.json`, bundleToJson(bundle), "application/json");
      } else {
        downloadText(`fitplan-plans-${stamp}.csv`, "\uFEFF" + bundleToCsv(bundle), "text/csv");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    setError("");
    setSummary(null);
    setBusy(true);
    try {
      const text = await file.text();
      const lower = file.name.toLowerCase();
      const parsed = lower.endsWith(".csv")
        ? parseCsvPlan(text)
        : parseJsonPlan(text); // .json or fallback
      const result = await importPlans(parsed.plans);
      setSummary(result);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <ModalShell onClose={onClose} width="560px">
      <div className="flex items-start justify-between gap-6">
        <h2 className="ed-serif text-2xl">{t("io.title")}</h2>
        <button
          onClick={onClose}
          className="text-[#1C1C1C]/40 transition-colors hover:text-[#1C1C1C]"
          aria-label={t("common.close")}
        >
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </div>
      <div className="mt-3 h-px w-full bg-[#1C1C1C]/10" />

      {/* Export */}
      <section className="mt-8">
        <div className="ed-label">{t("io.exportTitle")}</div>
        <p className="mt-2 font-sans text-sm leading-relaxed text-[#1C1C1C]/60">
          {t("io.exportHint", { n: plans.length })}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => exportAs("json")} className="ed-btn text-xs">
            JSON
          </button>
          <button disabled={busy} onClick={() => exportAs("csv")} className="ed-btn-outline text-xs">
            CSV (Excel)
          </button>
        </div>
      </section>

      <div className="my-8 h-px w-full bg-[#1C1C1C]/10" />

      {/* Import */}
      <section>
        <div className="ed-label">{t("io.importTitle")}</div>
        <p className="mt-2 font-sans text-sm leading-relaxed text-[#1C1C1C]/60">
          {t("io.importHint")}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.csv,text/csv,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <button
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="ed-btn mt-4 text-xs"
        >
          {busy ? t("io.working") : t("io.chooseFile")}
        </button>

        {error && (
          <p className="mt-4 border-l-2 border-[#1C1C1C] pl-3 font-sans text-sm text-[#1C1C1C]">
            {t("io.importFailed")}: {error}
          </p>
        )}

        {summary && (
          <div className="mt-4 border border-[#1C1C1C]/10 p-4 font-sans text-sm">
            <div className="ed-label">{t("io.importDone")}</div>
            <ul className="mt-2 space-y-1 text-[#1C1C1C]/70">
              <li>{t("io.resultPlans", { n: summary.plansCreated })}</li>
              <li>{t("io.resultDays", { n: summary.daysCreated })}</li>
              <li>{t("io.resultLinked", { n: summary.exercisesLinked })}</li>
              {summary.exercisesPlaceholder > 0 && (
                <li>{t("io.resultPlaceholder", { n: summary.exercisesPlaceholder })}</li>
              )}
            </ul>
          </div>
        )}
      </section>
    </ModalShell>
  );
}
