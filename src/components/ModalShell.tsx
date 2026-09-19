import { useEffect } from "react";

/** Calls `onClose` when the Escape key is pressed. */
export function useEscapeToClose(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, active]);
}

/**
 * Shared modal shell: dimmed backdrop, click-outside to close,
 * Escape-to-close, editorial hairline card.
 */
export function ModalShell({
  onClose,
  children,
  width = "520px",
}: {
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  useEscapeToClose(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1C1C]/40 px-3 sm:px-6"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full overflow-y-auto border border-[#1C1C1C] bg-[#F9F8F6] p-6 sm:max-w-[90vw] sm:p-10"
        style={{ width: undefined, maxWidth: width } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
