import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../SettingsContext";
import { bmi } from "../lib/metrics/body";
import { query } from "../db";
import { displayToKg, formatWeight, kgToDisplay, unitLabel } from "../units";
import { APP_VERSION } from "../version";

interface WeightLogRow {
  id: number;
  logged_at: string;
  weight_kg: number;
  body_fat_pct: number | null;
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { lang, unit, soundCue, profile, setLang, setUnit, setSoundCue, logWeight, deleteWeightLog, saveProfile } =
    useSettings();

  const [weightInput, setWeightInput] = useState("");
  const [bfInput, setBfInput] = useState("");
  const [logs, setLogs] = useState<WeightLogRow[]>([]);

  const reloadLogs = () => {
    query<WeightLogRow>(
      "SELECT id, logged_at, weight_kg, body_fat_pct FROM body_logs ORDER BY logged_at DESC, id DESC LIMIT 30",
    )
      .then(setLogs)
      .catch(() => undefined);
  };

  useEffect(reloadLogs, []);

  const latestWeight = logs.length > 0 ? logs[0].weight_kg : profile.weightKg;
  const bmiResult = bmi(latestWeight, profile.heightCm);

  const submitWeight = async () => {
    const w = Number(weightInput);
    if (!Number.isFinite(w) || w <= 0) return;
    const bf = bfInput.trim() === "" ? null : Number(bfInput);
    await logWeight(displayToKg(w, unit), bf !== null && Number.isFinite(bf) ? bf : null);
    setWeightInput("");
    setBfInput("");
    reloadLogs();
  };

  return (
    <div className="bg-[#F9F8F6] px-5 py-8 text-[#1C1C1C] lg:px-10 lg:py-12">
      <h1 className="ed-serif text-3xl lg:text-4xl">{t("settings.title")}</h1>
      <div className="mt-3 h-px w-full bg-[#1C1C1C]/10" />

      <div className="mt-14 max-w-xl space-y-16">
        <section>
          <div className="flex items-baseline justify-between border-b border-[#1C1C1C]/10 pb-4">
            <h2 className="ed-serif text-2xl">{t("settings.language")}</h2>
            <span className="ed-label">{lang === "zh" ? "中文" : "English"}</span>
          </div>
          <div className="mt-6 flex gap-10">
            <button
              onClick={() => setLang("zh")}
              className="ed-link text-xs tracking-[0.2em] uppercase text-[#1C1C1C]/60 transition-colors hover:text-[#1C1C1C]"
              style={lang === "zh" ? { color: "#1C1C1C" } : undefined}
            >
              中文
            </button>
            <button
              onClick={() => setLang("en")}
              className="ed-link text-xs tracking-[0.2em] uppercase text-[#1C1C1C]/60 transition-colors hover:text-[#1C1C1C]"
              style={lang === "en" ? { color: "#1C1C1C" } : undefined}
            >
              English
            </button>
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-[#1C1C1C]/10 pb-4">
            <h2 className="ed-serif text-2xl">{t("settings.units")}</h2>
            <span className="ed-label">{unit}</span>
          </div>
          <div className="mt-6 flex gap-10">
            <button
              onClick={() => setUnit("kg")}
              className="ed-link text-xs tracking-[0.2em] uppercase text-[#1C1C1C]/60 transition-colors hover:text-[#1C1C1C]"
              style={unit === "kg" ? { color: "#1C1C1C" } : undefined}
            >
              公制 kg
            </button>
            <button
              onClick={() => setUnit("lb")}
              className="ed-link text-xs tracking-[0.2em] uppercase text-[#1C1C1C]/60 transition-colors hover:text-[#1C1C1C]"
              style={unit === "lb" ? { color: "#1C1C1C" } : undefined}
            >
              英制 lb
            </button>
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-[#1C1C1C]/10 pb-4">
            <h2 className="ed-serif text-2xl">{t("settings.soundCue")}</h2>
            <span className="ed-label">{soundCue ? "ON" : "OFF"}</span>
          </div>
          <div className="mt-6 flex gap-10">
            <button
              onClick={() => setSoundCue(true)}
              className="ed-link text-xs tracking-[0.2em] uppercase text-[#1C1C1C]/60 transition-colors hover:text-[#1C1C1C]"
              style={soundCue ? { color: "#1C1C1C" } : undefined}
            >
              ON
            </button>
            <button
              onClick={() => setSoundCue(false)}
              className="ed-link text-xs tracking-[0.2em] uppercase text-[#1C1C1C]/60 transition-colors hover:text-[#1C1C1C]"
              style={!soundCue ? { color: "#1C1C1C" } : undefined}
            >
              OFF
            </button>
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-[#1C1C1C]/10 pb-4">
            <h2 className="ed-serif text-2xl">{t("settings.body")}</h2>
            {bmiResult.bmi !== null && (
              <span className="ed-label">
                BMI {bmiResult.bmi.toFixed(1)} · {t(`bmi.${bmiResult.category}`)}
              </span>
            )}
          </div>

          {/* Profile: sex / age / height / goal weight */}
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="ed-label block">{t("body.sex")}</label>
              <div className="mt-2 flex gap-6">
                {(["male", "female"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => saveProfile({ sex: s })}
                    className="ed-link text-xs tracking-[0.2em] uppercase transition-colors"
                    style={{
                      color: profile.sex === s ? "#1C1C1C" : "rgba(28,28,28,0.4)",
                    }}
                  >
                    {t(`body.${s}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="ed-label block">{t("body.age")}</label>
              <input
                type="number"
                inputMode="numeric"
                value={profile.age ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  saveProfile({ age: v === "" ? null : Math.max(0, Math.round(Number(v))) });
                }}
                className="mt-2 w-full border-b border-[#1C1C1C]/20 bg-transparent pb-1 font-mono text-sm outline-none focus:border-[#1C1C1C]"
              />
            </div>
            <div>
              <label className="ed-label block">{t("body.height")} (cm)</label>
              <input
                type="number"
                inputMode="decimal"
                value={profile.heightCm ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  saveProfile({ heightCm: v === "" ? null : Number(v) });
                }}
                className="mt-2 w-full border-b border-[#1C1C1C]/20 bg-transparent pb-1 font-mono text-sm outline-none focus:border-[#1C1C1C]"
              />
            </div>
            <div>
              <label className="ed-label block">
                {t("body.goalWeight")} ({unitLabel(unit)})
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={
                  profile.goalWeightKg !== null
                    ? Math.round(kgToDisplay(profile.goalWeightKg, unit) * 10) / 10
                    : ""
                }
                onChange={(e) => {
                  const v = e.target.value;
                  saveProfile({
                    goalWeightKg: v === "" ? null : displayToKg(Number(v), unit),
                  });
                }}
                className="mt-2 w-full border-b border-[#1C1C1C]/20 bg-transparent pb-1 font-mono text-sm outline-none focus:border-[#1C1C1C]"
              />
            </div>
          </div>

          {/* Log weight */}
          <div className="mt-10">
            <label className="ed-label block">{t("body.logWeight")} ({unitLabel(unit)})</label>
            <div className="mt-3 flex items-end gap-4">
              <input
                type="number"
                inputMode="decimal"
                placeholder={latestWeight !== null ? kgToDisplay(latestWeight, unit).toFixed(1) : "70.0"}
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                className="w-32 border-b border-[#1C1C1C]/20 bg-transparent pb-1 font-mono text-lg outline-none focus:border-[#1C1C1C]"
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder={t("body.bodyFatOptional")}
                value={bfInput}
                onChange={(e) => setBfInput(e.target.value)}
                className="w-32 border-b border-[#1C1C1C]/20 bg-transparent pb-1 font-mono text-sm outline-none focus:border-[#1C1C1C]"
              />
              <button
                onClick={() => void submitWeight()}
                disabled={weightInput.trim() === ""}
                className="ed-link px-4 py-1 text-xs tracking-[0.2em] uppercase transition-opacity disabled:opacity-30"
                style={{ border: "1px solid #1C1C1C" }}
              >
                {t("body.save")}
              </button>
            </div>
          </div>

          {/* Recent logs */}
          {logs.length > 0 && (
            <div className="mt-10">
              <div className="ed-label">{t("body.recentLogs")}</div>
              <div className="mt-3 divide-y divide-[#1C1C1C]/10">
                {logs.slice(0, 10).map((l) => (
                  <div key={l.id} className="flex items-center justify-between py-2">
                    <span className="font-mono text-xs text-[#1C1C1C]/60">{l.logged_at.slice(0, 10)}</span>
                    <span className="font-mono text-sm">
                      {formatWeight(l.weight_kg, unit)} {unitLabel(unit)}
                      {l.body_fat_pct !== null && (
                        <span className="ml-3 text-xs text-[#1C1C1C]/50">
                          {t("body.bodyFatShort")} {l.body_fat_pct}%
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => {
                        void deleteWeightLog(l.id).then(reloadLogs);
                      }}
                      className="ed-link text-xs text-[#1C1C1C]/40 hover:text-[#1C1C1C]"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-[#1C1C1C]/10 pb-4">
            <h2 className="ed-serif text-2xl">{t("settings.about")}</h2>
          </div>
          <p className="mt-6 max-w-md font-sans text-sm leading-relaxed text-[#1C1C1C]/60">
            {t("settings.aboutText")}
          </p>
          <a
            href="https://github.com/noahal1/KE"
            target="_blank"
            rel="noopener noreferrer"
            className="ed-link ed-btn-quiet mt-4 inline-flex items-center gap-2 text-sm"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            {t("settings.github")}
          </a>
          <p className="mt-4 font-mono text-xs text-[#1C1C1C]/40">KE v{APP_VERSION} · Tauri 2 + React + SQLite</p>
        </section>
      </div>
    </div>
  );
}
