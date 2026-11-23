"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { Button } from "@/components/ui/button";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedMode, toggleMode } = useTheme();
  const isDark = resolvedMode === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleMode}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme (WhatsApp Light)" : "Switch to dark theme (WhatsApp Dark)"}
      className={`size-9 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors dark:hover:bg-slate-800 ${className ?? ""}`}
    >
      {isDark ? (
        <Sun className="size-4.5 text-amber-300 transition-transform hover:rotate-45" />
      ) : (
        <Moon className="size-4.5 text-slate-700 transition-transform hover:-rotate-12" />
      )}
    </Button>
  );
}
