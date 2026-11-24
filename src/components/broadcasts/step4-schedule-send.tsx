'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Send,
  Loader2,
  Users,
  Save,
  Calendar,
  Clock,
  Smartphone,
  CheckCircle,
  Bot,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { validateAndFormatWhatsAppPhone } from '@/lib/whatsapp/phone-utils';
import type { VariableMapping } from '@/hooks/use-broadcast-sending';
import { cn } from '@/lib/utils';

interface AudienceConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables?: Record<string, VariableMapping>;
  buttonFlows?: Record<string, string>;
  onButtonFlowsChange?: (bf: Record<string, string>) => void;
  onSend: (scheduledAt?: string | null) => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  variables = {},
  buttonFlows = {},
  onButtonFlowsChange,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);

  // Test send state
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  // Delivery timing state: 'now' vs 'later'
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  // Default scheduled time = 1 hour from now
  const defaultScheduleTime = new Date(Date.now() + 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
  const [scheduledTime, setScheduledTime] = useState(defaultScheduleTime);

  // Active flows for button mapping
  const [activeFlows, setActiveFlows] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    async function fetchFlows() {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('flows')
          .select('id, name')
          .eq('status', 'active')
          .order('name', { ascending: true });
        setActiveFlows(data ?? []);
      } catch (err) {
        console.error('[broadcasts] failed to load active flows:', err);
      }
    }
    fetchFlows();
  }, []);

  const quickReplyButtons = (template.buttons ?? []).filter(
    (b) => b.type === 'QUICK_REPLY'
  );

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        const supabase = createClient();

        if (audience.type === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true });
          setEstimatedReach(count ?? 0);
        } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
          const { data: contactTags } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', audience.tagIds);

          const uniqueIds = new Set((contactTags ?? []).map((ct) => ct.contact_id));
          setEstimatedReach(uniqueIds.size);
        } else if (audience.type === 'csv' && audience.csvContacts) {
          setEstimatedReach(audience.csvContacts.length);
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  async function handleSendTest() {
    const check = validateAndFormatWhatsAppPhone(testPhone);
    if (!check.isValid) {
      toast.error(check.error || 'സാധുവായ ഒരു WhatsApp നമ്പർ നൽകുക (ഉദാ: +91 98765 43210)');
      return;
    }

    setSendingTest(true);
    try {
      // Resolve sample params from variables
      const keys = Object.keys(variables).sort((a, b) => Number(a) - Number(b));
      const sampleParams = keys.map((k) => variables[k]?.value || `Sample ${k}`);

      const res = await fetch('/api/whatsapp/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: [{ phone: check.phone, params: sampleParams }],
          template_name: template.name,
          template_language: template.language ?? 'en_US',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Test send failed');
      }

      const item = data.results?.[0];
      if (item?.status === 'sent') {
        toast.success(`ടെസ്റ്റ് മെസ്സേജ് ${check.phone}-ലേക്ക് വിജയകരമായി അയച്ചു! വാട്സാപ്പ് പരിശോധിക്കുക.`);
      } else {
        const err = item?.error || 'Test message could not be delivered';
        if (/131030|not in allowed list/i.test(err)) {
          toast.error(
            "Meta Sandbox Error: ഈ നമ്പർ നിങ്ങളുടെ Meta Developer Dashboard-ൽ 'To' ലിസ്റ്റിൽ ആഡ് ചെയ്തിട്ടുണ്ടോ എന്ന് പരിശോധിക്കുക."
          );
        } else {
          toast.error(`ടെസ്റ്റ് അയക്കാൻ കഴിഞ്ഞില്ല: ${err}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error sending test message';
      toast.error(msg);
    } finally {
      setSendingTest(false);
    }
  }

  function handleConfirmAction() {
    setShowConfirm(false);
    if (scheduleMode === 'later') {
      if (!scheduledTime) {
        toast.error('ഷെഡ്യൂൾ ചെയ്യാനുള്ള തീയതിയും സമയവും തിരഞ്ഞെടുക്കുക.');
        return;
      }
      const dateObj = new Date(scheduledTime);
      if (dateObj.getTime() <= Date.now()) {
        toast.error('ഭാവിയിലെ ഒരു തീയതിയും സമയവും തിരഞ്ഞെടുക്കുക.');
        return;
      }
      onSend(dateObj.toISOString());
    } else {
      onSend(null);
    }
  }

  const audienceLabel =
    audience.type === 'all'
      ? 'All Contacts'
      : audience.type === 'tags'
        ? `Tags (${audience.tagIds?.length ?? 0} selected)`
        : audience.type === 'csv'
          ? 'CSV Upload'
          : 'Custom';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Review & Send</h2>
        <p className="mt-1 text-sm text-slate-400">
          Name your broadcast, test on WhatsApp, choose timing, and send.
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-white">Broadcast Name</label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Summer Sale Announcement"
          className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
        />
      </div>

      {/* Summary Card */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
        <p className="text-sm font-medium text-white">Summary</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-slate-400">Template</p>
            <p className="text-white font-medium">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Audience</p>
            <p className="text-white font-medium">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Estimated Reach</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-white">{estimatedReach.toLocaleString()} contacts</p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400">Language</p>
            <p className="text-white">{template.language ?? 'en_US'}</p>
          </div>
        </div>
      </div>

      {/* Button Actions / Connect to Flow */}
      {quickReplyButtons.length > 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium text-white">
              Button Actions / Connect to Flow (ബട്ടൺ പ്രസ്സ് ചെയ്യുമ്പോൾ ഫ്ലോ ആരംഭിക്കുക)
            </p>
          </div>
          <p className="text-xs text-slate-400">
            ഈ ടെംപ്ലേറ്റിലെ ബട്ടണുകളിൽ കസ്റ്റമർ ക്ലിക്ക് ചെയ്യുമ്പോൾ ഏത് Chatbot Flow ആണ് പ്രവർത്തിക്കേണ്ടത് എന്ന് താഴെ തിരഞ്ഞെടുക്കാം (ഓപ്ഷണൽ):
          </p>
          <div className="space-y-2.5 pt-1">
            {quickReplyButtons.map((btn, idx) => (
              <div
                key={idx}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-lg border border-slate-800 bg-slate-900/80"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">ബട്ടൺ:</span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/10 border border-primary/30 text-xs font-semibold text-primary">
                    <Sparkles className="h-3 w-3" />
                    {btn.text}
                  </span>
                </div>
                <div className="flex items-center gap-2 sm:w-72">
                  <span className="text-xs text-slate-400 shrink-0">ഫ്ലോ:</span>
                  <Select
                    value={buttonFlows[btn.text] || 'none'}
                    onValueChange={(val) => {
                      const next = { ...buttonFlows };
                      if (!val || val === 'none') {
                        delete next[btn.text];
                      } else {
                        next[btn.text] = val;
                      }
                      onButtonFlowsChange?.(next);
                    }}
                  >
                    <SelectTrigger className="w-full bg-slate-800 border-slate-700 text-xs text-white">
                      <SelectValue placeholder="-- ഫ്ലോ തിരഞ്ഞെടുക്കുക (None) --" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700 text-white">
                      <SelectItem value="none">-- ഫ്ലോ ഇല്ല (None) --</SelectItem>
                      {activeFlows.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Send a Test Message Card */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-emerald-400" />
            <p className="text-sm font-medium text-white">Send a Test Message (ടെസ്റ്റ് മെസ്സേജ്)</p>
          </div>
          <span className="text-xs text-emerald-400/80 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
            Recommended
          </span>
        </div>
        <p className="text-xs text-slate-400">
          എല്ലാവർക്കും അയക്കുന്നതിന് മുൻപ് നിങ്ങളുടെ സ്വന്തം വാട്സാപ്പ് നമ്പറിലേക്ക് ഒരു ടെസ്റ്റ് അയച്ച് ഉറപ്പുവരുത്തുക:
        </p>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <Input
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="+91 98765 43210 or 9876543210"
            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 text-sm"
          />
          <Button
            type="button"
            onClick={handleSendTest}
            disabled={sendingTest || !testPhone.trim()}
            className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          >
            {sendingTest ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Sending…
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-1.5" /> Send Test
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Delivery Timing Card */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
        <p className="text-sm font-medium text-white flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" /> Delivery Time (അയക്കേണ്ട സമയം)
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setScheduleMode('now')}
            className={cn(
              'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer',
              scheduleMode === 'now'
                ? 'border-primary bg-primary/10 text-white'
                : 'border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700'
            )}
          >
            <div
              className={cn(
                'size-4 rounded-full border flex items-center justify-center shrink-0',
                scheduleMode === 'now' ? 'border-primary bg-primary' : 'border-slate-600'
              )}
            >
              {scheduleMode === 'now' && <div className="size-1.5 rounded-full bg-white" />}
            </div>
            <div>
              <p className="text-sm font-medium text-white">Send Now</p>
              <p className="text-xs text-slate-400">തത്സമയം ഉടൻ തന്നെ അയക്കുക</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setScheduleMode('later')}
            className={cn(
              'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer',
              scheduleMode === 'later'
                ? 'border-primary bg-primary/10 text-white'
                : 'border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700'
            )}
          >
            <div
              className={cn(
                'size-4 rounded-full border flex items-center justify-center shrink-0',
                scheduleMode === 'later' ? 'border-primary bg-primary' : 'border-slate-600'
              )}
            >
              {scheduleMode === 'later' && <div className="size-1.5 rounded-full bg-white" />}
            </div>
            <div>
              <p className="text-sm font-medium text-white">Schedule for Later</p>
              <p className="text-xs text-slate-400">മറ്റൊരു സമയത്തേക്ക് ഷെഡ്യൂൾ ചെയ്യുക</p>
            </div>
          </button>
        </div>

        {scheduleMode === 'later' && (
          <div className="pt-2 space-y-1.5 border-t border-slate-800">
            <label className="text-xs text-slate-300 font-medium flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-primary" />
              Select Date & Time (നിശ്ചിത തീയതിയും സമയവും നൽകുക):
            </label>
            <Input
              type="datetime-local"
              value={scheduledTime}
              min={new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16)}
              onChange={(e) => setScheduledTime(e.target.value)}
              className="border-slate-700 bg-slate-800 text-white"
            />
            <p className="text-[11px] text-slate-500">
              ഈ സമയത്ത് മെസ്സേജ് ഓട്ടോമാറ്റിക് ആയി അയക്കപ്പെടും.
            </p>
          </div>
        )}
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium text-white">Sending broadcast...</p>
            </div>
            <span className="text-xs font-medium text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-800">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-slate-700 text-slate-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save as Draft
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogTrigger
              render={
                <Button
                  disabled={!name.trim() || isProcessing}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                />
              }
            >
              {scheduleMode === 'later' ? (
                <>
                  <Calendar className="h-4 w-4 mr-1.5" />
                  Schedule Broadcast
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-1.5" />
                  Send Broadcast
                </>
              )}
            </DialogTrigger>
            <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-white">
                  {scheduleMode === 'later' ? 'Confirm Scheduled Broadcast' : 'Confirm Broadcast'}
                </DialogTitle>
                <DialogDescription className="text-slate-400">
                  {scheduleMode === 'later' ? (
                    <>
                      You are scheduling this broadcast for{' '}
                      <span className="font-medium text-white">
                        {new Date(scheduledTime).toLocaleString()}
                      </span>{' '}
                      to{' '}
                      <span className="font-medium text-white">
                        {estimatedReach.toLocaleString()}
                      </span>{' '}
                      contacts using the{' '}
                      <span className="font-medium text-white">{template.name}</span> template.
                    </>
                  ) : (
                    <>
                      You are about to send this broadcast immediately to{' '}
                      <span className="font-medium text-white">
                        {estimatedReach.toLocaleString()}
                      </span>{' '}
                      contacts using the{' '}
                      <span className="font-medium text-white">{template.name}</span> template.
                      This action cannot be undone.
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                  className="border-slate-700 text-slate-300"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmAction}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {scheduleMode === 'later' ? (
                    <>
                      <Calendar className="h-4 w-4 mr-1.5" />
                      Confirm Schedule
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-1.5" />
                      Confirm & Send
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
