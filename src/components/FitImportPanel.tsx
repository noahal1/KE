import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../SettingsContext";
import { formatWeight, unitLabel } from "../units";
import { query } from "../db";
import {
  annotateMatches,
  commitImport,
  parseStrengthFile,
  type ExerciseCatalogEntry,
  type FitImportPreview,
} from "../lib/fitImport";

/** Garmin .fit import panel: pick files → preview parsed sessions → confirm
 *  write. Rendered inline on HistoryPage. */
export default function FitImportPanel({ onImported }: { onImported: () => void }) {
  const { t } = useTranslation();
  const { lang, unit } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previews, setPreviews] = useState<FitImportPreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const catalogRef = useRef<ExerciseCatalogEntry[]>([]);

  const exerciseName = (p: FitImportPreview, garminName: string): string => {
    const g = p.groups.find((x) => x.name === garminName);
    if (g?.matchedId != null) {
      const ex = catalogRef.current.find((e) => e.id === g.matchedId);
      if (ex) return lang === "zh" ? ex.name_zh : ex.name_en;
    }
    return garminName;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      catalogRef.current = await query<ExerciseCatalogEntry>(
        "SELECT id, slug, name_en, name_zh FROM exercises",
      );
      const parsed: FitImportPreview[] = [];
      for (const file of Array.from(files)) {
        const buffer = await file.arrayBuffer();
        const preview = await parseStrengthFile(buffer, file.name);
        annotateMatches(preview, catalogRef.current);
        parsed.push(preview);
      }
      const withSets = parsed.filter((p) => p.sets.length > 0);
      const empty = parsed.length - withSets.length;
      setPreviews(withSets.length > 0 ? withSets : null);
      if (withSets.length === 0) {
        setError(
          empty > 0
            ? t("fitimport.noSets")
            : t("fitimport.failed"),
        );
      } else if (empty > 0) {
        setError(t("fitimport.someSkipped", { n: empty }));
      }
    } catch (e) {
      setError(`${t("fitimport.failed")}: ${e instanceof Error ? e.message : String(e)}`);
      setPreviews(null);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCommit = async () => {
    if (!previews || previews.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let created = 0;
      for (const p of previews) {
        const res = await commitImport(p, sessionNameFor(p));
        created += res.createdExercises;
      }
      setSuccess(
        created > 0
          ? t("fitimport.successCustom", { n: previews.length, c: created })
          : t("fitimport.success", { n: previews.length }),
      );
      setPreviews(null);
      onImported();
    } catch (e) {
      setError(`${t("fitimport.failed")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const sessionNameFor = (p: FitImportPreview): string => {
    const when = p.startedAtIso
      ? new Date(p.startedAtIso).toLocaleDateString()
      : new Date().toLocaleDateString();
    return `${t("fitimport.sessionPrefix")} · ${when}`;
  };

  return (
    <div className="mt-8 border border-[#1C1C1C]/15 p-6 lg:p-8">
      <input
        ref={fileInputRef}
        type="file"
        accept=".fit"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="ed-serif text-2xl">{t("fitimport.title")}</h2>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="ed-btn-outline"
        >
          {busy ? t("fitimport.parsing") : t("fitimport.pick")}
        </button>
      </div>
      <p className="mt-3 max-w-2xl font-sans text-sm leading-relaxed text-[#1C1C1C]/60">
        {t("fitimport.desc")}
      </p>

      {error && (
        <p className="mt-4 font-sans text-sm text-red-700">{error}</p>
      )}
      {success && (
        <p className="mt-4 font-sans text-sm text-[#1C1C1C]">{success}</p>
      )}

      {previews && previews.length > 0 && (
        <div className="mt-6">
          {previews.map((p) => (
            <div key={p.fileName} className="ed-divider py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="ed-serif text-lg">
                  {sessionNameFor(p)}
                </span>
                <span className="ed-label">
                  {t("fitimport.totalSets", { n: p.sets.length })}
                </span>
              </div>
              <div className="mt-2 font-mono text-xs text-[#1C1C1C]/40">
                {p.fileName}
                {p.startedAtIso &&
                  ` · ${p.startedAtIso.slice(0, 16).replace("T", " ")}`}
              </div>
              <div className="mt-3 space-y-1.5">
                {p.groups.map((g, i) => {
                  const first = g.sets[0];
                  const volume = g.sets.reduce((acc, s) => acc + s.weightKg * s.reps, 0);
                  return (
                    <div key={i} className="flex flex-wrap items-baseline gap-x-3 font-sans text-sm">
                      <span>{exerciseName(p, g.name)}</span>
                      {g.matchedId === null && (
                        <span className="border border-[#1C1C1C]/25 px-1.5 py-px text-[10px] tracking-wider text-[#1C1C1C]/60">
                          {t("fitimport.custom")}
                        </span>
                      )}
                      <span className="font-mono text-xs text-[#1C1C1C]/60">
                        {g.sets.length} × {first.reps} @ {formatWeight(first.weightKg, unit)}
                        {unitLabel(unit)} · {t("fitimport.volume", { v: Math.round(volume) })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="mt-6 flex items-center gap-6">
            <button onClick={handleCommit} disabled={busy} className="ed-btn">
              {busy ? t("fitimport.importing") : t("fitimport.importBtn", { n: previews.length })}
            </button>
            <button
              onClick={() => setPreviews(null)}
              disabled={busy}
              className="ed-btn-quiet"
            >
              {t("common.cancel")}
            </button>
          </div>
          <p className="mt-3 font-sans text-xs text-[#1C1C1C]/50">
            {t("fitimport.duplicateHint")}
          </p>
        </div>
      )}
    </div>
  );
}
