import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalShell } from "./ModalShell";

const EQUIPMENT_KEYS = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "smith",
  "bodyweight",
  "band",
  "kettlebell",
  "ez-bar",
];

const MUSCLE_KEYS = [
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

/** Create-a-custom-exercise modal, shared by the exercise browser. */
export default function CustomExerciseForm({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (nameEn: string, nameZh: string, equipment: string, primary: string) => void;
}) {
  const { t } = useTranslation();
  const [nameEn, setNameEn] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [equipment, setEquipment] = useState("barbell");
  const [primary, setPrimary] = useState("chest");

  return (
    <ModalShell onClose={onClose} width="480px">
      <h2 className="ed-serif text-2xl">{t("library.addCustom")}</h2>
      <div className="mt-2 h-px w-full bg-[#1C1C1C]/10" />

      <div className="mt-8 space-y-8">
        <input
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
          placeholder="Name (EN)"
          className="ed-input"
        />
        <input
          value={nameZh}
          onChange={(e) => setNameZh(e.target.value)}
          placeholder="名称（中文）"
          className="ed-input"
        />
        <div className="grid grid-cols-2 gap-8">
          <label className="block">
            <span className="ed-label">Equipment</span>
            <select
              value={equipment}
              onChange={(e) => setEquipment(e.target.value)}
              className="ed-select mt-1 w-full"
            >
              {EQUIPMENT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`equipment.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="ed-label">Primary</span>
            <select
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              className="ed-select mt-1 w-full"
            >
              {MUSCLE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`muscle.${k}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-10 flex justify-end gap-3">
        <button onClick={onClose} className="ed-btn-outline">
          {t("common.cancel")}
        </button>
        <button
          onClick={() => onSave(nameEn.trim(), nameZh.trim(), equipment, primary)}
          disabled={!nameEn.trim() || !nameZh.trim()}
          className="ed-btn"
        >
          {t("common.save")}
        </button>
      </div>
    </ModalShell>
  );
}
