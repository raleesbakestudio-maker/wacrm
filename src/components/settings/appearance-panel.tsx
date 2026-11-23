"use client";

import { Check, Laptop, Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { THEMES, type ThemeId, type ThemeMode } from "@/lib/themes";
import { cn } from "@/lib/utils";

const MODE_OPTIONS: {
  id: ThemeMode;
  name: string;
  tagline: string;
  icon: typeof Sun;
}[] = [
  {
    id: "light",
    name: "Light (WhatsApp)",
    tagline: "Clean WhatsApp Web light style with crisp white surfaces.",
    icon: Sun,
  },
  {
    id: "dark",
    name: "Dark (WhatsApp)",
    tagline: "Signature WhatsApp dark palette, easy on the eyes.",
    icon: Moon,
  },
  {
    id: "system",
    name: "System Auto",
    tagline: "Automatically matches your phone or computer display setting.",
    icon: Laptop,
  },
];

export function AppearancePanel() {
  const { theme, setTheme, mode, setMode } = useTheme();

  return (
    <div className="space-y-8">
      {/* Theme Mode: Light / Dark / System */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Display Mode</h2>
          <p className="mt-1 text-sm text-slate-400">
            Choose between WhatsApp Light mode, Dark mode, or automatic system sync.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {MODE_OPTIONS.map((m) => {
            const Icon = m.icon;
            const isActive = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={isActive}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border bg-card p-4 text-left transition-all",
                  isActive
                    ? "border-primary/60 ring-2 ring-primary/40 bg-primary/5"
                    : "border-slate-800 hover:border-slate-700 hover:bg-slate-800/40",
                )}
              >
                <div className="flex items-center justify-between">
                  <div
                    className={cn(
                      "flex size-9 items-center justify-center rounded-lg border",
                      isActive
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-slate-800 bg-slate-900 text-slate-400",
                    )}
                  >
                    <Icon className="size-4.5" />
                  </div>
                  {isActive && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                      <Check className="h-3 w-3" />
                      Active
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{m.name}</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-400">
                    {m.tagline}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Accent Color theme */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Accent color</h2>
          <p className="mt-1 text-sm text-slate-400">
            Customize the primary highlight color used across buttons, active tabs, and badges.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {THEMES.map((t) => (
            <ThemeCard
              key={t.id}
              id={t.id}
              name={t.name}
              tagline={t.tagline}
              swatch={t.swatch}
              isActive={t.id === theme}
              onPick={() => setTheme(t.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ThemeCard({
  id,
  name,
  tagline,
  swatch,
  isActive,
  onPick,
}: {
  id: ThemeId;
  name: string;
  tagline: string;
  swatch: string;
  isActive: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={isActive}
      aria-label={`Use ${name} theme`}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 text-left transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-slate-800 hover:border-slate-700 hover:bg-slate-800/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          aria-hidden
          className="h-8 w-8 shrink-0 rounded-full"
          style={{
            background: swatch,
            boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.15)",
          }}
        />
        {isActive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
            <Check className="h-3 w-3" />
            Active
          </span>
        )}
      </div>
      <div>
        <div className="text-sm font-semibold text-white">{name}</div>
        <div className="mt-1 text-xs leading-relaxed text-slate-400">
          {tagline}
        </div>
      </div>
      <div
        className="mt-1 flex h-2 overflow-hidden rounded-full"
        aria-hidden
      >
        <span className="flex-1" style={{ background: swatch }} />
        <span className="w-3 bg-slate-700" />
        <span className="w-3 bg-slate-800" />
        <span className="w-3 bg-slate-900" />
      </div>
      <span className="sr-only">Theme id: {id}</span>
    </button>
  );
}
