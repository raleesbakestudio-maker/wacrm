'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessageCircle,
  Sparkles,
} from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';

interface ResetPasswordDialogProps {
  member: AccountMember | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function generateSecurePassword(length = 12): string {
  const charset = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  let pwd = '';
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * charset.length);
    pwd += charset[idx];
  }
  return pwd;
}

export function ResetPasswordDialog({
  member,
  open,
  onOpenChange,
}: ResetPasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successResult, setSuccessResult] = useState<{
    email: string;
    fullName: string;
    password: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGeneratePassword = () => {
    const newPwd = generateSecurePassword(12);
    setPassword(newPwd);
    setShowPassword(true);
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setPassword('');
      setShowPassword(false);
      setSuccessResult(null);
      setCopied(false);
    }, 200);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member) return;

    if (!password || password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/account/members/${member.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error || 'Failed to reset password');
        return;
      }

      toast.success(`Password updated for ${member.full_name || member.email}`);
      setSuccessResult({
        email: member.email || 'N/A',
        fullName: member.full_name || 'Staff Member',
        password,
      });
    } catch (err) {
      console.error('[ResetPasswordDialog] error:', err);
      toast.error('Could not reach the server');
    } finally {
      setSubmitting(false);
    }
  };

  const credentialsText = successResult
    ? `*RaleesBake Studio CRM — Password Updated*\n\n` +
      `Hello ${successResult.fullName},\nYour CRM account password has been updated by the Admin.\n\n` +
      `*Login URL:* ${typeof window !== 'undefined' ? window.location.origin : ''}/login\n` +
      `*Email:* ${successResult.email}\n` +
      `*New Password:* ${successResult.password}\n\n` +
      `Please log in and keep your credentials secure.`
    : '';

  const handleCopy = async () => {
    if (!credentialsText) return;
    try {
      await navigator.clipboard.writeText(credentialsText);
      setCopied(true);
      toast.success('Credentials copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md bg-slate-900 border-slate-800 text-white p-5 sm:p-6">
        {!successResult ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <div className="flex items-center gap-2 text-amber-400 mb-1">
                <KeyRound className="h-5 w-5" />
                <DialogTitle className="text-lg font-semibold text-white">
                  Reset Staff Password
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs text-slate-400">
                Set a new password for{' '}
                <span className="font-semibold text-slate-200">
                  {member?.full_name || member?.email}
                </span>
                . The staff member can immediately use this new password to sign in.
              </DialogDescription>
            </DialogHeader>

            {/* Readonly info */}
            <div className="rounded-lg border border-slate-800 bg-slate-800/40 p-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Staff Member:</span>
                <span className="font-medium text-slate-200">{member?.full_name || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Email:</span>
                <span className="font-medium text-slate-200">{member?.email || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Role:</span>
                <span className="font-medium uppercase text-emerald-400">{member?.role || 'agent'}</span>
              </div>
            </div>

            {/* Password input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="new-password" className="text-xs text-slate-300">
                  New Password <span className="text-red-400">*</span>
                </Label>
                <button
                  type="button"
                  onClick={handleGeneratePassword}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Generate strong password</span>
                </button>
              </div>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="bg-slate-800 border-slate-700 text-white placeholder-slate-500 pr-10 text-sm h-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <DialogFooter className="mt-5 flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                className="w-full sm:w-auto border-slate-700 hover:bg-slate-800"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="w-full sm:w-auto bg-amber-600 hover:bg-amber-500 text-white font-medium"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-1.5 h-4 w-4" />
                    Update Password
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <DialogHeader>
              <div className="flex items-center gap-2 text-emerald-400 mb-1">
                <Check className="h-5 w-5" />
                <DialogTitle className="text-lg font-semibold text-white">
                  Password Updated Successfully!
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs text-slate-400">
                The new password is now active. Share these updated credentials with the staff member.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3.5 space-y-2 text-xs">
              <div className="flex justify-between items-center py-0.5 border-b border-emerald-500/20">
                <span className="text-slate-400">Staff:</span>
                <span className="font-semibold text-white">{successResult.fullName}</span>
              </div>
              <div className="flex justify-between items-center py-0.5 border-b border-emerald-500/20">
                <span className="text-slate-400">Email:</span>
                <span className="font-mono text-slate-200">{successResult.email}</span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-slate-400">New Password:</span>
                <span className="font-mono font-bold text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/30">
                  {successResult.password}
                </span>
              </div>
            </div>

            <DialogFooter className="mt-5 flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCopy}
                className="w-full sm:w-auto border-slate-700 hover:bg-slate-800"
              >
                {copied ? <Check className="mr-1.5 h-4 w-4 text-emerald-400" /> : <Copy className="mr-1.5 h-4 w-4" />}
                <span>{copied ? 'Copied!' : 'Copy Credentials'}</span>
              </Button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(credentialsText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants(),
                  "w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                )}
              >
                <MessageCircle className="mr-1.5 h-4 w-4" />
                <span>Send via WhatsApp</span>
              </a>
              <Button
                type="button"
                onClick={handleClose}
                className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-slate-200"
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
