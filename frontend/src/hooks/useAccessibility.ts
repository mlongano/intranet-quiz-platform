// frontend/src/hooks/useAccessibility.ts
// Manages accessibility settings: font size, text spacing, dyslexia font, contrast mode.
// Settings are persisted to localStorage and applied as CSS classes on <html>.

import { useState, useEffect } from "react";

// --- Types ---

export type FontSize = "default" | "lg" | "xl" | "xxl";
export type Spacing = "default" | "relaxed" | "loose";
export type FontFamily = "default" | "dyslexic";
export type Contrast = "default" | "high" | "yellow";

export interface A11ySettings {
  fontSize: FontSize;
  spacing: Spacing;
  font: FontFamily;
  contrast: Contrast;
}

// --- Constants ---

const STORAGE_KEY = "quizparty-a11y";

const DEFAULT_SETTINGS: A11ySettings = {
  fontSize: "default",
  spacing: "default",
  font: "default",
  contrast: "default",
};

// CSS class prefixes for each setting dimension
const FONT_SIZE_CLASSES: Record<FontSize, string> = {
  default: "",
  lg: "a11y-font-lg",
  xl: "a11y-font-xl",
  xxl: "a11y-font-xxl",
};

const SPACING_CLASSES: Record<Spacing, string> = {
  default: "",
  relaxed: "a11y-spacing-relaxed",
  loose: "a11y-spacing-loose",
};

const FONT_CLASSES: Record<FontFamily, string> = {
  default: "",
  dyslexic: "a11y-font-dyslexic",
};

const CONTRAST_CLASSES: Record<Contrast, string> = {
  default: "",
  high: "a11y-contrast-high",
  yellow: "a11y-contrast-yellow",
};

// All known a11y classes (used for cleanup)
const ALL_A11Y_CLASSES = [
  "a11y-font-lg", "a11y-font-xl", "a11y-font-xxl",
  "a11y-spacing-relaxed", "a11y-spacing-loose",
  "a11y-font-dyslexic",
  "a11y-contrast-high", "a11y-contrast-yellow",
];

// --- Helpers ---

/** Read settings from localStorage, falling back to defaults. */
function loadSettings(): A11ySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_SETTINGS };
}

/** Apply the given settings as HTML classes and inject/remove the dyslexic font link. */
function applySettings(settings: A11ySettings) {
  const html = document.documentElement;

  // Remove all existing a11y classes
  html.classList.remove(...ALL_A11Y_CLASSES);

  // Apply the active classes
  const toAdd = [
    FONT_SIZE_CLASSES[settings.fontSize],
    SPACING_CLASSES[settings.spacing],
    FONT_CLASSES[settings.font],
    CONTRAST_CLASSES[settings.contrast],
  ].filter(Boolean);

  if (toAdd.length > 0) html.classList.add(...toAdd);

  // Inject / remove the OpenDyslexic font stylesheet
  const FONT_LINK_ID = "opendyslexic-font";
  const existing = document.getElementById(FONT_LINK_ID);
  if (settings.font === "dyslexic") {
    if (!existing) {
      const link = document.createElement("link");
      link.id = FONT_LINK_ID;
      link.rel = "stylesheet";
      link.href = "https://fonts.cdnfonts.com/css/open-dyslexic";
      document.head.appendChild(link);
    }
  } else {
    existing?.remove();
  }
}

// --- Hook ---

export function useAccessibility() {
  const [settings, setSettings] = useState<A11ySettings>(loadSettings);

  // Apply settings whenever they change
  useEffect(() => {
    applySettings(settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  // Cleanup: remove all a11y classes when the hook unmounts
  useEffect(() => {
    return () => {
      document.documentElement.classList.remove(...ALL_A11Y_CLASSES);
    };
  }, []);

  /** Update one or more settings fields. */
  const update = (partial: Partial<A11ySettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  };

  /** Reset all settings to defaults. */
  const reset = () => {
    setSettings({ ...DEFAULT_SETTINGS });
  };

  /** True when any setting differs from the default (used to show the dot indicator). */
  const isModified =
    settings.fontSize !== "default" ||
    settings.spacing !== "default" ||
    settings.font !== "default" ||
    settings.contrast !== "default";

  return { settings, update, reset, isModified };
}
