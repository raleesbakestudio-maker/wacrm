'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Database,
  Trash2,
  Download,
  AlertTriangle,
  Loader2,
  Calendar,
  MessageSquare,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface RetentionCounts {
  total: number;
  older30: number;
  older60: number;
  older90: number;
  older180: number;
  older365: number;
  conversations: number;
}

export function DataRetentionTab() {
  const [counts, setCounts] = useState<RetentionCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDays, setSelectedDays] = useState<string>('90');
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [deleteInputText, setDeleteInputText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/settings/data-retention');
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      setCounts(data.counts || null);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load message statistics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const getTargetCount = () => {
    if (!counts) return 0;
    switch (selectedDays) {
      case '30':
        return counts.older30;
      case '60':
        return counts.older60;
      case '90':
        return counts.older90;
      case '180':
        return counts.older180;
      case '365':
        return counts.older365;
      case '0':
        return counts.total;
      default:
        return counts.older90;
    }
  };

  const handleExportCsv = async () => {
    try {
      setDownloading(true);
      const res = await fetch(`/api/settings/data-retention/export?days=${selectedDays}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-backup-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Chat backup downloaded successfully');
    } catch (err) {
      console.error(err);
      toast.error('Failed to download chat backup');
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (deleteInputText.trim().toUpperCase() !== 'DELETE') {
      toast.error('Please type "DELETE" to confirm');
      return;
    }

    try {
      setDeleting(true);
      const days = parseInt(selectedDays, 10);
      const res = await fetch('/api/settings/data-retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Delete failed');
      }

      const result = await res.json();
      toast.success(
        `Successfully deleted ${result.deletedCount || 0} old messages permanently!`,
      );
      setConfirmModalOpen(false);
      setDeleteInputText('');
      await fetchStats();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete messages');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Database className="h-5 w-5 text-emerald-400" />
            Data Retention & Storage Cleanup
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            പഴയ ചാറ്റ് ഡാറ്റകൾ സെർവറിൽ നിന്ന് സുരക്ഷിതമായി പെർമനന്റ് ആയി ഡിലീറ്റ് ചെയ്യാനും ബാക്കപ്പ് എടുക്കാനുമുള്ള സൗകര്യം.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchStats}
          disabled={loading}
          className="border-slate-700 bg-slate-800 text-xs text-slate-200 hover:bg-slate-700 w-fit"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Stats
        </Button>
      </div>

      {/* Message Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-slate-800 bg-slate-900/80">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-medium">Total Messages</span>
              <MessageSquare className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-white">
              {loading ? '…' : (counts?.total ?? 0).toLocaleString()}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Across {counts?.conversations ?? 0} conversations
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/80">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-medium">&gt; 30 Days Old</span>
              <Calendar className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="text-2xl font-bold text-white">
              {loading ? '…' : (counts?.older30 ?? 0).toLocaleString()}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">1+ month old</p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/80">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-medium">&gt; 90 Days Old</span>
              <Calendar className="h-4 w-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-amber-300">
              {loading ? '…' : (counts?.older90 ?? 0).toLocaleString()}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">3+ months old</p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/80">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-medium">&gt; 180 Days Old</span>
              <Calendar className="h-4 w-4 text-rose-400" />
            </div>
            <div className="text-2xl font-bold text-rose-300">
              {loading ? '…' : (counts?.older180 ?? 0).toLocaleString()}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">6+ months old</p>
          </CardContent>
        </Card>
      </div>

      {/* Backup & Cleanup Action Card */}
      <Card className="border-slate-800 bg-slate-900/90">
        <CardHeader className="pb-3 border-b border-slate-800/80">
          <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-rose-400" />
            Permanently Clean Up Old Messages (പഴയ ചാറ്റ് ഡിലീറ്റ് ചെയ്യുക)
          </CardTitle>
          <CardDescription className="text-xs text-slate-400">
            നിശ്ചിത ദിവസത്തിൽ കൂടുതൽ പഴക്കമുള്ള മെസ്സേജുകൾ ഡാറ്റാബേസിൽ നിന്ന് പെർമനന്റ് ആയി ഡിലീറ്റ് ചെയ്യാം. ഡിലീറ്റ് ചെയ്യുന്നതിന് മുൻപ് സുരക്ഷിതമായി ബാക്കപ്പ് CSV ഡൗൺലോഡ് ചെയ്യാനും സാധിക്കും.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Select Age Threshold (കാലാവധി തെരഞ്ഞെടുക്കുക)
              </label>
              <Select
                value={selectedDays}
                onValueChange={(v) => {
                  if (v) setSelectedDays(v);
                }}
              >
                <SelectTrigger className="bg-slate-800 border-slate-700 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">Older than 30 Days (1 മാസത്തിൽ കൂടുതൽ)</SelectItem>
                  <SelectItem value="60">Older than 60 Days (2 മാസത്തിൽ കൂടുതൽ)</SelectItem>
                  <SelectItem value="90">Older than 90 Days (3 മാസത്തിൽ കൂടുതൽ)</SelectItem>
                  <SelectItem value="180">Older than 180 Days (6 മാസത്തിൽ കൂടുതൽ)</SelectItem>
                  <SelectItem value="365">Older than 1 Year (1 വർഷത്തിൽ കൂടുതൽ)</SelectItem>
                  <SelectItem value="0">All Messages (എല്ലാ ചാറ്റ് മെസ്സേജുകളും)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col justify-end">
              <div className="rounded-lg bg-slate-800/80 border border-slate-700 p-2.5 flex items-center justify-between text-xs">
                <span className="text-slate-400">Target messages to clean:</span>
                <span className="font-semibold text-rose-300 text-sm">
                  {loading ? '…' : getTargetCount().toLocaleString()} messages
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={downloading}
              onClick={handleExportCsv}
              className="w-full sm:w-auto border-slate-700 bg-slate-800 text-xs text-slate-200 hover:bg-slate-700 gap-1.5"
            >
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 text-cyan-400" />}
              <span>Download Backup (CSV)</span>
            </Button>

            <Button
              type="button"
              disabled={loading || getTargetCount() === 0}
              onClick={() => {
                setDeleteInputText('');
                setConfirmModalOpen(true);
              }}
              className="w-full sm:w-auto bg-rose-600 hover:bg-rose-500 text-white text-xs gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Permanently Delete ({getTargetCount().toLocaleString()})</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Information Banner */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-2 text-xs text-slate-400">
        <div className="flex items-center gap-2 text-slate-200 font-medium">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>ഡാറ്റ സുരക്ഷിതത്വവും സ്റ്റോറേജും സംബന്ധിച്ച വിവരങ്ങൾ:</span>
        </div>
        <ul className="list-disc list-inside space-y-1 text-slate-400 leading-relaxed pl-1 text-[11px]">
          <li>കസ്റ്റമർ അയക്കുന്ന ഫോട്ടോകളും ഓഡിയോകളും Meta WhatsApp ക്ലൗഡിലാണ് കിടക്കുന്നത്. നിങ്ങളുടെ സെർവർ സ്റ്റോറേജ് ഒരിക്കലും ഫുൾ ആകില്ല.</li>
          <li>ടെക്സ്റ്റ് മെസ്സേജുകൾ ഡിലീറ്റ് ചെയ്താലും നിങ്ങളുടെ കോൺടാക്റ്റുകളും (Contacts) അവരിലെ ടാഗുകളും (Tags) സുരക്ഷിതമായി നിലനിൽക്കും.</li>
          <li>സ്ഥിരമായി ഡിലീറ്റ് ചെയ്യുന്നതിന് മുൻപ് എപ്പോൾ വേണമെങ്കിലും &quot;Download Backup (CSV)&quot; വഴി പഴയ മെസ്സേജുകൾ ഡൗൺലോഡ് ചെയ്തു സൂക്ഷിക്കാം.</li>
        </ul>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={confirmModalOpen} onOpenChange={setConfirmModalOpen}>
        <DialogContent className="border-slate-800 bg-slate-900 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-rose-400 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Confirm Permanent Deletion
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-300 space-y-2 pt-2">
              <p>
                നിങ്ങൾ തെരഞ്ഞെടുത്ത <strong>{getTargetCount().toLocaleString()} മെസ്സേജുകൾ</strong> ഡാറ്റാബേസിൽ നിന്ന് പെർമനന്റ് ആയി ഡിലീറ്റ് ചെയ്യപ്പെടും. ഈ പ്രവർത്തനം പിന്നീട് തിരിച്ചെടുക്കാൻ സാധ്യമല്ല.
              </p>
              <p className="text-slate-400 text-[11px]">
                സ്ഥിരീകരിക്കാൻ താഴെയുള്ള ബോക്സിൽ <span className="font-mono font-bold text-white bg-slate-800 px-1.5 py-0.5 rounded">DELETE</span> എന്ന് ടൈപ്പ് ചെയ്യുക:
              </p>
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <Input
              value={deleteInputText}
              onChange={(e) => setDeleteInputText(e.target.value)}
              placeholder='Type "DELETE" here'
              className="bg-slate-800 border-slate-700 text-sm font-mono tracking-widest text-white uppercase text-center"
              autoFocus
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmModalOpen(false)}
              className="text-slate-400 hover:text-white text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={deleting || deleteInputText.trim().toUpperCase() !== 'DELETE'}
              onClick={handleDelete}
              className="bg-rose-600 hover:bg-rose-500 text-white text-xs gap-1.5"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              <span>Confirm & Delete</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
