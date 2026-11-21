"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already in standalone (installed) mode
    if (typeof window !== "undefined") {
      const isStandaloneMode =
        window.matchMedia("(display-mode: standalone)").matches ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.navigator as any).standalone === true;
      setIsStandalone(isStandaloneMode);

      const handler = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e as BeforeInstallPromptEvent);
      };

      window.addEventListener("beforeinstallprompt", handler);

      window.addEventListener("appinstalled", () => {
        setDeferredPrompt(null);
        setIsStandalone(true);
      });

      return () => {
        window.removeEventListener("beforeinstallprompt", handler);
      };
    }
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  // Don't render anything if already installed or if prompt isn't ready
  if (isStandalone || !deferredPrompt) {
    return null;
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleInstallClick}
      className="hidden sm:inline-flex items-center gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 text-xs font-medium h-8 px-2.5 rounded-lg"
    >
      <Download className="h-3.5 w-3.5" />
      <span>Install App</span>
    </Button>
  );
}
