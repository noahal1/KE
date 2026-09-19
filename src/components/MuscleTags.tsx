import { useTranslation } from "react-i18next";
import { parseMuscles } from "../muscles";

/**
 * Primary-muscle tags rendered as "胸 · 背阔肌" — shared by every exercise
 * row (library grid, picker, plan day, active session, session detail).
 */
export default function MuscleTags({
  primary,
  secondary,
  max = 3,
  className = "",
}: {
  primary: string;
  secondary?: string;
  /** Show at most `max` tags, then "+n". */
  max?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const { primary: p, secondary: s } = parseMuscles(primary, secondary);
  const tags = [...p, ...s.filter((m) => !p.includes(m))];
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;

  return (
    <span className={className}>
      {shown.map((m) => t(`muscle.${m}`)).join(" · ")}
      {rest > 0 && ` +${rest}`}
    </span>
  );
}
