"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  STORAGE_KEY,
  STORAGE_KEY_MODE,
  isThemeId,
  isThemeMode,
  type ThemeId,
  type ThemeMode,
} from "@/lib/themes";

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (next: ThemeId) => void;
  mode: ThemeMode;
  setMode: (next: ThemeMode) => void;
  resolvedMode: "light" | "dark";
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemMode(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readInitialTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const fromAttr = document.documentElement.dataset.theme;
  if (isThemeId(fromAttr)) return fromAttr;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
  }
  return DEFAULT_THEME;
}

function readInitialMode(): ThemeMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const stored = localStorage.getItem(STORAGE_KEY_MODE);
    if (isThemeMode(stored)) return stored;
  } catch {
    // private-browsing fallback
  }
  return DEFAULT_MODE;
}

function applyModeToDom(effective: "light" | "dark") {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.mode = effective;
  if (effective === "dark") {
    document.documentElement.classList.add("dark");
    document.documentElement.classList.remove("light");
  } else {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readInitialTheme);
  const [mode, setModeState] = useState<ThemeMode>(readInitialMode);
  const [systemMode, setSystemMode] = useState<"light" | "dark">(getSystemMode);

  const resolvedMode: "light" | "dark" =
    mode === "system" ? systemMode : mode;

  // Apply mode to DOM whenever resolvedMode changes
  useEffect(() => {
    applyModeToDom(resolvedMode);
  }, [resolvedMode]);

  // Listen to OS system color-scheme changes when in "system" mode
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemMode(e.matches ? "dark" : "light");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = next;
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable
    }
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    const effective = next === "system" ? getSystemMode() : next;
    applyModeToDom(effective);
    try {
      localStorage.setItem(STORAGE_KEY_MODE, next);
    } catch {
      // storage unavailable
    }
  }, []);

  const toggleMode = useCallback(() => {
    const nextMode = resolvedMode === "dark" ? "light" : "dark";
    setMode(nextMode);
  }, [resolvedMode, setMode]);

  // Multi-tab sync
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        if (isThemeId(e.newValue) && e.newValue !== theme) {
          setThemeState(e.newValue);
          document.documentElement.dataset.theme = e.newValue;
        }
      } else if (e.key === STORAGE_KEY_MODE) {
        if (isThemeMode(e.newValue) && e.newValue !== mode) {
          setModeState(e.newValue);
        }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [theme, mode]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        mode,
        setMode,
        resolvedMode,
        toggleMode,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: DEFAULT_THEME,
      setTheme: () => {},
      mode: DEFAULT_MODE,
      setMode: () => {},
      resolvedMode: "dark",
      toggleMode: () => {},
    };
  }
  return ctx;
}
