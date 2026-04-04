// frontend/src/components/AccessibilityPanel.tsx
// Floating accessibility toolbar: font size, text spacing, dyslexia font, contrast.
// Only mounted on student-facing pages (StartPage, QuizPage).

import { useRef, useState, useEffect } from "react";
import { Type } from "lucide-react";
import { useAccessibility, type FontSize, type Spacing, type FontFamily, type Contrast } from "../hooks/useAccessibility";

// --- Sub-components ---

interface OptionButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}

function OptionButton({ active, onClick, children, title }: OptionButtonProps) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-sm font-medium border transition-all ${
        active
          ? "bg-primary/20 border-primary/40 text-primary"
          : "bg-surface-container-high border-outline-variant/30 text-on-surface-variant hover:text-on-surface"
      }`}
    >
      {children}
    </button>
  );
}

interface RowProps {
  label: string;
  children: React.ReactNode;
}

function Row({ label, children }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-on-surface-variant font-medium flex-shrink-0">{label}</span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

// --- Main component ---

export default function AccessibilityPanel() {
  const { settings, update, reset, isModified } = useAccessibility();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close panel when clicking outside
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button — matches ThemeToggle style */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Accessibilità"
        className="relative flex items-center justify-center p-2 bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Type size={16} />
        {/* Dot indicator when any setting is non-default */}
        {isModified && (
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary" />
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full mt-2 right-0 w-80 z-50 bg-surface-container border border-outline-variant/30 rounded-xl shadow-lg p-4 space-y-3 a11y-isolated">

          {/* Font size */}
          <Row label="Testo">
            {(["default", "lg", "xl", "xxl"] as FontSize[]).map((val, i) => {
              const labels = ["A-", "A", "A+", "A++"];
              return (
                <OptionButton
                  key={val}
                  active={settings.fontSize === val}
                  onClick={() => update({ fontSize: val })}
                >
                  {labels[i]}
                </OptionButton>
              );
            })}
          </Row>

          {/* Text spacing */}
          <Row label="Spaziatura">
            {(["default", "relaxed", "loose"] as Spacing[]).map((val) => {
              const labels: Record<Spacing, string> = { default: "Normale", relaxed: "Ampia", loose: "Larga" };
              return (
                <OptionButton
                  key={val}
                  active={settings.spacing === val}
                  onClick={() => update({ spacing: val })}
                >
                  {labels[val]}
                </OptionButton>
              );
            })}
          </Row>

          {/* Font family */}
          <Row label="Carattere">
            {(["default", "dyslexic"] as FontFamily[]).map((val) => {
              const labels: Record<FontFamily, string> = { default: "Normale", dyslexic: "Dislessia" };
              return (
                <OptionButton
                  key={val}
                  active={settings.font === val}
                  onClick={() => update({ font: val })}
                >
                  {labels[val]}
                </OptionButton>
              );
            })}
          </Row>

          {/* Contrast */}
          <Row label="Contrasto">
            {(["default", "high", "yellow"] as Contrast[]).map((val) => {
              const labels: Record<Contrast, string> = { default: "Normale", high: "Alto", yellow: "Giallo" };
              return (
                <OptionButton
                  key={val}
                  active={settings.contrast === val}
                  onClick={() => update({ contrast: val })}
                >
                  {labels[val]}
                </OptionButton>
              );
            })}
          </Row>

          {/* Divider + reset */}
          <div className="pt-1 border-t border-outline-variant/20">
            <button
              onClick={() => { reset(); setOpen(false); }}
              className="w-full text-xs text-on-surface-variant hover:text-on-surface transition-colors py-1"
            >
              Ripristina tutto
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
