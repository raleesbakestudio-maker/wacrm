'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, Sliders } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { APP_FEATURES, DEFAULT_AGENT_FEATURES } from '@/lib/auth/features';
import type { AccountRole } from '@/lib/auth/roles';

interface EditPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: {
    user_id: string;
    full_name: string;
    email: string | null;
    role: AccountRole;
    allowed_features?: string[] | null;
  } | null;
  onSaved: () => void;
}

export function EditPermissionsDialog({
  open,
  onOpenChange,
  member,
  onSaved,
}: EditPermissionsDialogProps) {
  const [allowedFeatures, setAllowedFeatures] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (member) {
      if (Array.isArray(member.allowed_features)) {
        setAllowedFeatures(member.allowed_features);
      } else if (member.role === 'admin' || member.role === 'owner') {
        setAllowedFeatures(APP_FEATURES.map((f) => f.id));
      } else {
        setAllowedFeatures(DEFAULT_AGENT_FEATURES);
      }
    }
  }, [member]);

  function toggleFeature(featureId: string) {
    setAllowedFeatures((prev) =>
      prev.includes(featureId)
        ? prev.filter((id) => id !== featureId)
        : [...prev, featureId]
    );
  }

  function selectAll() {
    setAllowedFeatures(APP_FEATURES.map((f) => f.id));
  }

  function selectDefault() {
    setAllowedFeatures(DEFAULT_AGENT_FEATURES);
  }

  async function handleSave() {
    if (!member) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/account/members/${member.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowed_features: allowedFeatures,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.error ?? 'Failed to update feature permissions');
        setSaving(false);
        return;
      }

      toast.success(`Permissions updated for ${member.full_name || 'staff member'}`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to update permissions:', err);
      toast.error('An unexpected error occurred');
    } finally {
      setSaving(false);
    }
  }

  if (!member) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-900 text-slate-100 sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sliders className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-white text-base">
                Staff Feature Permissions
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs">
                Manage which features <span className="text-white font-medium">{member.full_name || member.email}</span> can access.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Select allowed modules:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={selectAll}
                className="text-primary hover:underline"
              >
                Allow All
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={selectDefault}
                className="hover:underline"
              >
                Default
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2.5">
            {APP_FEATURES.map((feature) => {
              const isChecked = allowedFeatures.includes(feature.id);
              return (
                <label
                  key={feature.id}
                  className="flex items-start gap-2.5 p-1.5 rounded hover:bg-slate-900/60 cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleFeature(feature.id)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-800 text-primary focus:ring-primary/40 focus:ring-offset-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-white leading-tight">
                      {feature.label}
                    </p>
                    <p className="text-[11px] text-slate-400 leading-tight">
                      {feature.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <DialogFooter className="mt-5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-slate-400 hover:text-white text-xs"
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs"
          >
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Permissions'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
