'use client';

import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Zap,
  Edit2,
  Trash2,
  Mic,
  FileText,
  Image as ImageIcon,
  Loader2,
  Upload,
  X,
  Play,
  Volume2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { QuickReply } from '@/types';

export function QuickRepliesTab() {
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReply, setEditingReply] = useState<QuickReply | null>(null);
  const [saving, setSaving] = useState(false);

  // Form states
  const [shortcut, setShortcut] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [mediaType, setMediaType] = useState<'none' | 'audio' | 'document' | 'image'>('none');
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaFilename, setMediaFilename] = useState<string | null>(null);
  const [keywordsStr, setKeywordsStr] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchReplies = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/quick-replies', { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch quick replies');
      }
      const data = await res.json();
      setReplies(data.quick_replies || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error loading quick replies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchReplies();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user) {
        fetchReplies();
      }
    };
    window.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);
    return () => {
      window.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onVisibilityChange);
    };
  }, [authLoading, user?.id]);

  const handleOpenAdd = () => {
    setEditingReply(null);
    setShortcut('');
    setTitle('');
    setMessage('');
    setMediaType('none');
    setMediaUrl(null);
    setMediaFilename(null);
    setKeywordsStr('');
    setIsActive(true);
    setDialogOpen(true);
  };

  const handleOpenEdit = (reply: QuickReply) => {
    setEditingReply(reply);
    setShortcut(reply.shortcut);
    setTitle(reply.title);
    setMessage(reply.message);
    setMediaType((reply.media_type as 'none' | 'audio' | 'document' | 'image') || 'none');
    setMediaUrl(reply.media_url || null);
    setMediaFilename(reply.media_filename || null);
    setKeywordsStr((reply.auto_keywords || []).join(', '));
    setIsActive(reply.is_active);
    setDialogOpen(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    try {
      setUploading(true);

      // Sanitize filename
      const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const path = `${user.id}/quick-replies/${Date.now()}-${cleanName}`;

      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('flow-media')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadErr) throw uploadErr;

      // Get public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from('flow-media').getPublicUrl(uploadData.path);

      setMediaUrl(publicUrl);
      setMediaFilename(file.name);

      // Auto detect media type if not set
      if (file.type.startsWith('audio/')) {
        setMediaType('audio');
      } else if (file.type.startsWith('image/')) {
        setMediaType('image');
      } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        setMediaType('document');
      }

      toast.success('File uploaded successfully!');
    } catch (err) {
      console.error('Upload error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to upload file');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!shortcut.trim() || !title.trim() || !message.trim()) {
      toast.error('Shortcut, Title, and Message are required.');
      return;
    }

    setSaving(true);
    try {
      const auto_keywords = keywordsStr
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);

      const payload = {
        shortcut: shortcut.trim().startsWith('/') ? shortcut.trim() : `/${shortcut.trim()}`,
        title: title.trim(),
        message: message.trim(),
        media_type: mediaType,
        media_url: mediaType !== 'none' ? mediaUrl : null,
        media_filename: mediaType !== 'none' ? mediaFilename : null,
        auto_keywords,
        is_active: isActive,
      };

      let res: Response;
      if (editingReply) {
        res = await fetch(`/api/quick-replies/${editingReply.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/quick-replies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to save quick reply');
      }

      if (resData.quick_reply) {
        if (editingReply) {
          setReplies((prev) =>
            prev.map((r) => (r.id === resData.quick_reply.id ? resData.quick_reply : r))
          );
        } else {
          setReplies((prev) => [resData.quick_reply, ...prev]);
        }
      }

      toast.success(editingReply ? 'Quick reply updated' : 'Quick reply created');
      setDialogOpen(false);
      fetchReplies();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error saving quick reply');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this quick reply?')) return;
    try {
      const res = await fetch(`/api/quick-replies/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete');
      }
      toast.success('Quick reply deleted');
      setReplies((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error deleting quick reply');
    }
  };

  const handleToggleActive = async (reply: QuickReply, nextActive: boolean) => {
    try {
      const res = await fetch(`/api/quick-replies/${reply.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: nextActive }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      setReplies((prev) =>
        prev.map((r) => (r.id === reply.id ? { ...r, is_active: nextActive } : r))
      );
    } catch {
      toast.error('Failed to toggle status');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-400" />
            Quick Replies & Simple Bot
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Create automated replies with Voice Notes 🎙️, PDF Brochures 📄, and Images 🖼️.
            Trigger them in chat using &apos;/&apos; or automatically when customers send matching keywords (e.g. &apos;1&apos;).
          </p>
        </div>
        <Button
          onClick={handleOpenAdd}
          className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs sm:text-sm h-9"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add Quick Reply
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : replies.length === 0 ? (
        <Card className="border-slate-800 bg-slate-900/50">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Zap className="h-10 w-10 text-slate-600 mb-3" />
            <h3 className="text-sm font-semibold text-white">No quick replies yet</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              Add your first quick reply (like /starter with a voice note or /payment with your QR code) to speed up student conversations.
            </p>
            <Button onClick={handleOpenAdd} size="sm" className="mt-4 bg-primary text-xs">
              <Plus className="mr-1 h-3.5 w-3.5" />
              Create First Reply
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {replies.map((reply) => {
            const hasMedia = reply.media_url && reply.media_type && reply.media_type !== 'none';
            return (
              <Card
                key={reply.id}
                className="border-slate-800 bg-slate-900 flex flex-col justify-between hover:border-slate-700 transition-colors"
              >
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      variant="outline"
                      className="border-amber-500/40 bg-amber-500/10 text-amber-300 font-mono text-xs px-2 py-0.5"
                    >
                      {reply.shortcut}
                    </Badge>
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={reply.is_active}
                        onCheckedChange={(checked) => handleToggleActive(reply, checked)}
                        title={reply.is_active ? 'Active' : 'Disabled'}
                        className="scale-75"
                      />
                      <button
                        onClick={() => handleOpenEdit(reply)}
                        className="p-1 text-slate-400 hover:text-white transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(reply.id)}
                        className="p-1 text-slate-400 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <CardTitle className="text-sm font-semibold text-white mt-2 truncate">
                    {reply.title}
                  </CardTitle>
                </CardHeader>

                <CardContent className="p-4 pt-0 space-y-2.5">
                  <p className="text-xs text-slate-300 line-clamp-3 whitespace-pre-line bg-slate-950/60 p-2 rounded border border-slate-800/80">
                    {reply.message}
                  </p>

                  {/* Media Badge */}
                  {hasMedia && (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-800/80 px-2 py-1 rounded">
                      {reply.media_type === 'audio' && (
                        <>
                          <Mic className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-emerald-300 font-medium">Voice Note (Audio)</span>
                        </>
                      )}
                      {reply.media_type === 'document' && (
                        <>
                          <FileText className="h-3.5 w-3.5 text-blue-400" />
                          <span className="text-blue-300 font-medium truncate">
                            {reply.media_filename || 'PDF Document'}
                          </span>
                        </>
                      )}
                      {reply.media_type === 'image' && (
                        <>
                          <ImageIcon className="h-3.5 w-3.5 text-purple-400" />
                          <span className="text-purple-300 font-medium">Image / QR Code</span>
                        </>
                      )}
                    </div>
                  )}

                  {/* Auto Keywords */}
                  {reply.auto_keywords && reply.auto_keywords.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 pt-1">
                      <span className="text-[10px] text-slate-500">Auto triggers:</span>
                      {reply.auto_keywords.map((kw) => (
                        <span
                          key={kw}
                          className="bg-slate-800 text-slate-300 text-[10px] px-1.5 py-0.5 rounded border border-slate-700/60"
                        >
                          &quot;{kw}&quot;
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-slate-800 bg-slate-900 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {editingReply ? 'Edit Quick Reply' : 'New Quick Reply & Bot Action'}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Configure a fast shortcut, message caption, and optional voice note or PDF brochure.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-300">
                  Shortcut <span className="text-red-400">*</span>
                </Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-mono">
                    /
                  </span>
                  <Input
                    value={shortcut.startsWith('/') ? shortcut.slice(1) : shortcut}
                    onChange={(e) => setShortcut(`/${e.target.value.replace(/\s+/g, '')}`)}
                    placeholder="starter"
                    className="pl-7 bg-slate-800 border-slate-700 text-xs font-mono"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Type this in chat (e.g. /starter) to trigger.
                </p>
              </div>

              <div>
                <Label className="text-xs text-slate-300">
                  Title <span className="text-red-400">*</span>
                </Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Starter Class Details"
                  className="mt-1 bg-slate-800 border-slate-700 text-xs"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs text-slate-300">
                Message Content / Caption <span className="text-red-400">*</span>
              </Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type the response message or caption for the media..."
                rows={4}
                className="mt-1 bg-slate-800 border-slate-700 text-xs leading-relaxed"
              />
            </div>

            {/* Media Attachment Section */}
            <div className="space-y-2 border border-slate-800 rounded-lg p-3 bg-slate-950/40">
              <Label className="text-xs text-slate-300 font-medium flex items-center justify-between">
                <span>Attachment (Voice Note, PDF, or Image)</span>
                {mediaUrl && (
                  <button
                    onClick={() => {
                      setMediaUrl(null);
                      setMediaFilename(null);
                      setMediaType('none');
                    }}
                    className="text-[10px] text-red-400 hover:underline inline-flex items-center gap-0.5"
                  >
                    <X className="h-3 w-3" /> Remove
                  </button>
                )}
              </Label>

              <div className="grid grid-cols-4 gap-2 pt-1">
                {(['none', 'audio', 'document', 'image'] as const).map((type) => {
                  const labels = {
                    none: 'None',
                    audio: 'Voice 🎙️',
                    document: 'PDF 📄',
                    image: 'Image 🖼️',
                  };
                  return (
                    <button
                      type="button"
                      key={type}
                      onClick={() => setMediaType(type)}
                      className={`text-xs py-1.5 px-2 rounded border transition-colors ${
                        mediaType === type
                          ? 'border-primary bg-primary/20 text-white font-medium'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
                      }`}
                    >
                      {labels[type]}
                    </button>
                  );
                })}
              </div>

              {mediaType !== 'none' && (
                <div className="pt-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileUpload}
                    accept={
                      mediaType === 'audio'
                        ? 'audio/*'
                        : mediaType === 'document'
                          ? 'application/pdf'
                          : 'image/*'
                    }
                    className="hidden"
                  />

                  {mediaUrl ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between bg-slate-800/80 px-3 py-2 rounded text-xs">
                        <span className="truncate text-slate-200">
                          {mediaFilename || 'Attached file'}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          className="h-7 text-[11px] text-primary hover:text-primary/90"
                        >
                          Replace
                        </Button>
                      </div>

                      {mediaType === 'audio' && (
                        <audio src={mediaUrl} controls className="w-full h-8" />
                      )}
                      {mediaType === 'image' && (
                        <img
                          src={mediaUrl}
                          alt="preview"
                          className="max-h-36 rounded object-contain mx-auto"
                        />
                      )}
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-dashed border-slate-700 bg-slate-900/60 hover:bg-slate-800 text-xs h-16 flex flex-col gap-1 items-center justify-center text-slate-400"
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          <span>Uploading...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4" />
                          <span>
                            Upload {mediaType === 'audio' ? 'Voice Recording' : mediaType === 'document' ? 'PDF Brochure' : 'QR / Image'}
                          </span>
                        </>
                      )}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Auto Trigger Keywords */}
            <div>
              <Label className="text-xs text-slate-300">
                Auto Keywords (Optional)
              </Label>
              <Input
                value={keywordsStr}
                onChange={(e) => setKeywordsStr(e.target.value)}
                placeholder="1, starter, beginner"
                className="mt-1 bg-slate-800 border-slate-700 text-xs"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Comma-separated words. If customer replies with any of these words (e.g. &apos;1&apos;), the bot automatically sends this reply.
              </p>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div>
                <Label className="text-xs text-slate-300">Active Status</Label>
                <p className="text-[10px] text-slate-500">Enable or disable this quick reply.</p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              className="text-slate-400 hover:text-white text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              {editingReply ? 'Update Reply' : 'Save Quick Reply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
