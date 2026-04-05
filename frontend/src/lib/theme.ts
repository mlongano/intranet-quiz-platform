export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "qp-theme";

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;

  html.classList.remove("light", "dark");

  if (mode === "dark") {
    html.classList.add("dark");
  } else if (mode === "light") {
    html.classList.add("light");
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (prefersDark) {
      html.classList.add("dark");
    } else {
      html.classList.add("light");
    }
  }
}

export function initTheme(): void {
  const mode = getStoredTheme();
  applyTheme(mode);

  if (typeof window !== "undefined") {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (getStoredTheme() === "system") {
        applyTheme("system");
      }
    };
    mediaQuery.addEventListener("change", handleChange);
  }
}

export function setTheme(mode: ThemeMode): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, mode);
  }
  applyTheme(mode);
}