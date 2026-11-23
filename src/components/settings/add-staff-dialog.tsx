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
  Shield,
  Sparkles,
  UserPlus,
} from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { APP_FEATURES, DEFAULT_AGENT_FEATURES } from '@/lib/auth/features';
import type { AccountRole } from '@/lib/auth/roles';

interface AddStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface CreatedStaffResult {
  fullName: string;
  email: string;
  password: string;
  role: AccountRole;
  allowedFeatures: string[];
}

export function AddStaffDialog({
  open,
  onOpenChange,
  onCreated,
}: AddStaffDialogProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<AccountRole>('agent');
  const [allowedFeatures, setAllowedFeatures] = useState<string[]>(DEFAULT_AGENT_FEATURES);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreatedStaffResult | null>(null);
  const [copied, setCopied] = useState(false);

  function resetForm() {
    setFullName('');
    setEmail('');
    setPassword('');
    setShowPassword(false);
    setRole('agent');
    setAllowedFeatures(DEFAULT_AGENT_FEATURES);
    setSubmitting(false);
    setResult(null);
    setCopied(false);
  }

  function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let pwd = '';
    for (let i = 0; i < 10; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(pwd);
    setShowPassword(true);
  }

  function toggleFeature(featureId: string) {
    setAllowedFeatures((prev) =>
      prev.includes(featureId)
        ? prev.filter((id) => id !== featureId)
        : [...prev, featureId]
    );
  }

  function selectAllFeatures() {
    setAllowedFeatures(APP_FEATURES.map((f) => f.id));
  }

  function selectDefaultFeatures() {
    setAllowedFeatures(DEFAULT_AGENT_FEATURES);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error('Please enter the staff member\'s full name');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }
    if (!password || password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/account/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          password,
          role,
          allowedFeatures,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.error ?? 'Failed to create staff account');
        setSubmitting(false);
        return;
      }

      toast.success('Staff account created successfully!');
      setResult({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
        allowedFeatures,
      });
      onCreated();
    } catch (err) {
      console.error('Failed to create staff member:', err);
      toast.error('An unexpected error occurred while creating the account');
    } finally {
      setSubmitting(false);
    }
  }

  const credentialsText = result
    ? `Welcome to RBS WACRM!\nHere are your staff login credentials:\n\n🌐 Login URL: ${typeof window !== 'undefined' ? window.location.origin : ''}/login\n📧 Email: ${result.email}\n🔑 Password: ${result.password}\n\nPlease log in and change your password in Settings.`
    : '';

  async function handleCopy() {
    if (!credentialsText) return;
    await navigator.clipboard.writeText(credentialsText);
    setCopied(true);
    toast.success('Credentials copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetForm();
        onOpenChange(next);
      }}
    >
      <DialogContent className="border-slate-800 bg-slate-900 text-slate-100 sm:max-w-md max-h-[90vh] overflow-y-auto">
        {result ? (
          // Step 2: Account Created Success View
          <div>
            <DialogHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 mb-2">
                <Check className="h-5 w-5" />
              </div>
              <DialogTitle className="text-white text-lg">Staff Account Created!</DialogTitle>
              <DialogDescription className="text-slate-400 text-xs">
                {result.fullName} can now log in directly with this email and password. No invite link needed!
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-3 rounded-lg border border-slate-800 bg-slate-950 p-3.5">
              <div>
                <span className="text-[11px] font-medium text-slate-400 uppercase">Staff Name</span>
                <p className="text-sm font-semibold text-white">{result.fullName}</p>
              </div>
              <div>
                <span className="text-[11px] font-medium text-slate-400 uppercase">Login Email</span>
                <p className="text-sm font-mono text-emerald-400">{result.email}</p>
              </div>
              <div>
                <span className="text-[11px] font-medium text-slate-400 uppercase">Password</span>
                <p className="text-sm font-mono text-white tracking-wider">{result.password}</p>
              </div>
              <div>
                <span className="text-[11px] font-medium text-slate-400 uppercase">Allowed Features</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {result.allowedFeatures.map((fid) => {
                    const feat = APP_FEATURES.find((f) => f.id === fid);
                    return (
                      <span
                        key={fid}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20"
                      >
                        {feat?.label ?? fid}
                      </span>
                    );
                  })}
                </div>
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
                  "w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white"
                )}
              >
                <MessageCircle className="mr-1.5 h-4 w-4" />
                <span>Send via WhatsApp</span>
              </a>
            </DialogFooter>
          </div>
        ) : (
          // Step 1: Create Staff Form
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UserPlus className="h-4 w-4" />
                </div>
                <div>
                  <DialogTitle className="text-white text-base">Add Staff Member</DialogTitle>
                  <DialogDescription className="text-slate-400 text-xs">
                    Directly create an account for your staff. No invitation link required.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="mt-4 space-y-3.5">
              {/* Full Name */}
              <div className="space-y-1">
                <Label htmlFor="staff-name" className="text-xs text-slate-300">
                  Staff Full Name
                </Label>
                <Input
                  id="staff-name"
                  placeholder="e.g. Raniya Shabeer"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="border-slate-700 bg-slate-800 text-white text-xs h-9"
                  required
                />
              </div>

              {/* Email */}
              <div className="space-y-1">
                <Label htmlFor="staff-email" className="text-xs text-slate-300">
                  Staff Login Email
                </Label>
                <Input
                  id="staff-email"
                  type="email"
                  placeholder="staff@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border-slate-700 bg-slate-800 text-white text-xs h-9"
                  required
                />
              </div>

              {/* Password */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="staff-password" className="text-xs text-slate-300">
                    Password
                  </Label>
                  <button
                    type="button"
                    onClick={generatePassword}
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80"
                  >
                    <KeyRound className="h-3 w-3" />
                    <span>Auto Generate</span>
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="staff-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Min 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="border-slate-700 bg-slate-800 text-white text-xs h-9 pr-9"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Account Role */}
              <div className="space-y-1">
                <Label className="text-xs text-slate-300">Account Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as AccountRole)}>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white text-xs h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-800 text-white">
                    <SelectItem value="agent" className="text-xs">
                      Agent / Staff (Standard access)
                    </SelectItem>
                    <SelectItem value="admin" className="text-xs">
                      Admin (Full team management)
                    </SelectItem>
                    <SelectItem value="viewer" className="text-xs">
                      Viewer (Read-only access)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Feature Permissions Control */}
              <div className="space-y-2 pt-1 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-semibold text-white">
                      Allowed Features for this Staff
                    </Label>
                    <p className="text-[11px] text-slate-400">
                      Unchecked features will be hidden from their sidebar.
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-[11px]">
                    <button
                      type="button"
                      onClick={selectAllFeatures}
                      className="text-primary hover:underline"
                    >
                      All
                    </button>
                    <span className="text-slate-600">•</span>
                    <button
                      type="button"
                      onClick={selectDefaultFeatures}
                      className="text-slate-400 hover:underline"
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
            </div>

            <DialogFooter className="mt-5">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="text-slate-400 hover:text-white"
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Creating Account...
                  </>
                ) : (
                  'Create Staff Account'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
