"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, profileLoading, canAccessFeature } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isInbox = pathname?.startsWith("/inbox");

  const currentFeature = pathname ? pathname.split("/")[1] : "";
  const isFeatureRestricted =
    !profileLoading &&
    currentFeature &&
    [
      "inbox",
      "contacts",
      "dashboard",
      "broadcasts",
      "automations",
      "flows",
      "settings",
    ].includes(currentFeature) &&
    !canAccessFeature(currentFeature);

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0 w-full">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Inbox has zero padding and overflow-hidden to prevent horizontal/vertical margin blowout on mobile. Other pages have standard padding. */}
        <main
          className={cn(
            "flex-1 min-w-0 w-full",
            isInbox
              ? "overflow-hidden p-0"
              : "overflow-y-auto p-4 sm:p-6"
          )}
        >
          {isFeatureRestricted ? (
            <div className="flex h-full min-h-[50vh] flex-col items-center justify-center p-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-400 mb-4">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold text-white">Access Restricted</h2>
              <p className="mt-1 text-sm text-slate-400 max-w-sm">
                You do not have permission to access the {currentFeature} module.
                Please contact your account administrator.
              </p>
              <Link
                href="/inbox"
                className={cn(buttonVariants({ variant: "outline" }), "mt-4")}
              >
                Go to Inbox
              </Link>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
