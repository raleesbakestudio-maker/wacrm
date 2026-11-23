"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RequireFeatureProps {
  /** Feature identifier (e.g. 'inbox', 'contacts', 'broadcasts', etc.) */
  feature: string;
  /** Optional fallback component if access is denied */
  fallback?: ReactNode;
  children: ReactNode;
}

export function RequireFeature({
  feature,
  fallback,
  children,
}: RequireFeatureProps) {
  const { profileLoading, canAccessFeature } = useAuth();

  if (profileLoading) return null;

  if (!canAccessFeature(feature)) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <div className="flex h-full min-h-[50vh] flex-col items-center justify-center p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-400 mb-4">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-white">Access Restricted</h2>
        <p className="mt-1 text-sm text-slate-400 max-w-sm">
          You do not have permission to access the {feature} module. Please contact your account administrator.
        </p>
        <Link
          href="/inbox"
          className={cn(buttonVariants({ variant: "outline" }), "mt-4")}
        >
          Go to Inbox
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
