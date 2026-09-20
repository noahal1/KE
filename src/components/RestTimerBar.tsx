import { useCallback, useEffect, useState } from "react";

interface Props {
  left: number;
  total: number;
  onSkip: () => void;
  onExtend: (seconds: number) => void;
  soundCue: boolean;
  label: string;
  skipLabel: string;
  extendLabel: string;
  doneLabel: string;
}

function playRestDoneCue() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    // Two rising tones: 880Hz then 1174.66Hz (D6), short and crisp.
    const notes = [
      { freq: 880, at: 0 },
      { freq: 1174.66, at: 0.18 },
    ];
    for (const { freq, at } of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.4);
    }
    setTimeout(() => ctx.close().catch(() => undefined), 1200);
  } catch {
    // Audio unavailable — silently ignore.
  }
}

export default function RestTimerBar({
  left,
  total,
  onSkip,
  onExtend,
  soundCue,
  label,
  skipLabel,
  extendLabel,
  doneLabel,
}: Props) {
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (restLeftIsDone(left, total)) {
      setFinished(true);
      if (soundCue) playRestDoneCue();
      const h = setTimeout(() => onSkip(), 3000);
      return () => clearTimeout(h);
    }
    setFinished(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left === 0 && total > 0, total]);

  const handleExtend = useCallback(() => {
    setFinished(false);
    onExtend(15);
  }, [onExtend]);

  if (total <= 0) return null;

  const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40">
      <div className="mx-3 mb-[calc(4.25rem+env(safe-area-inset-bottom))] flex items-center gap-3 border border-[#1C1C1C] bg-[#F9F8F6] px-4 py-3.5 sm:mx-6 sm:gap-6 sm:px-8 sm:py-5 lg:mb-6">
        <span className="ed-serif shrink-0 text-base italic sm:text-lg">{finished ? doneLabel : label}</span>
        <div className="relative h-px min-w-0 flex-1 bg-[#1C1C1C]/10">
          <div
            className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 bg-[#1C1C1C] transition-all duration-1000 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-12 shrink-0 text-right font-mono text-lg tabular-nums text-[#1C1C1C] sm:w-14 sm:text-xl">
          {left}s
        </span>
        <button onClick={handleExtend} className="ed-btn-outline shrink-0 px-3 py-2 text-[0.65rem] tracking-[0.15em] sm:px-5 sm:text-xs sm:tracking-[0.2em] uppercase">
          {extendLabel}
        </button>
        <button onClick={onSkip} className="ed-btn-outline shrink-0 px-3 py-2 text-[0.65rem] tracking-[0.15em] sm:px-5 sm:text-xs sm:tracking-[0.2em] uppercase">
          {skipLabel}
        </button>
      </div>
    </div>
  );
}

function restLeftIsDone(left: number, total: number): boolean {
  return left === 0 && total > 0;
}
