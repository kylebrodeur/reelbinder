import { useEffect, useState } from "react";

export type ThemeId = "cinema-slate" | "dark-cinema" | "directors-slate" | "oled";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  badge: string;
  description: string;
  swatch: { bg: string; card: string; border: string; accent: string; text: string };
}

export const THEMES: ThemeMeta[] = [
  {
    id: "cinema-slate",
    name: "Cinema Slate",
    badge: "Default",
    description: "Black slate with Signal Green accents, structural lines, and warm white type.",
    swatch: { bg: "#0d0e11", card: "#15161a", border: "#596474", accent: "#5a9e80", text: "#f1f0ea" },
  },
  {
    id: "dark-cinema",
    name: "Dark Cinema",
    badge: "Deep black",
    description: "Classic deep obsidian tone with warm ivory ink and understated borders.",
    swatch: { bg: "#0b0b0c", card: "#141416", border: "#596474", accent: "#5a9e80", text: "#f0eee8" },
  },
  {
    id: "directors-slate",
    name: "Director's Slate",
    badge: "Graphite",
    description: "Technical graphite and cool charcoal with precise Signal Green accents.",
    swatch: { bg: "#111316", card: "#181a1f", border: "#596474", accent: "#5a9e80", text: "#f2f3f5" },
  },
  {
    id: "oled",
    name: "OLED Suite",
    badge: "Pitch Black",
    description: "True #000000 background engineered for color-critical grading monitors.",
    swatch: { bg: "#000000", card: "#0e0e10", border: "#596474", accent: "#5a9e80", text: "#f5f5f5" },
  },
];

const THEME_STORAGE_KEY = "slate_ui_theme";

export function getStoredTheme(): ThemeId {
  if (typeof window === "undefined") return "cinema-slate";
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val && THEMES.some((t) => t.id === val)) return val as ThemeId;
  } catch {
    // ignore
  }
  return "cinema-slate";
}

export function applyTheme(id: ThemeId): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent("slate:theme-change", { detail: id }));
}

export function initTheme(): ThemeId {
  const current = getStoredTheme();
  applyTheme(current);
  return current;
}

// Automatically apply stored theme upon script execution in the browser
if (typeof document !== "undefined") {
  initTheme();
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>(() => getStoredTheme());

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<ThemeId>;
      if (custom.detail) setTheme(custom.detail);
    };
    window.addEventListener("slate:theme-change", handler);
    return () => window.removeEventListener("slate:theme-change", handler);
  }, []);

  const changeTheme = (next: ThemeId) => {
    applyTheme(next);
    setTheme(next);
  };

  return { theme, setTheme: changeTheme, themes: THEMES };
}
