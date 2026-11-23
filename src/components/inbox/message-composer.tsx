"use client";

import { useState, useRef, useCallback, useEffect, useMemo, KeyboardEvent } from "react";
import {
  Send,
  LayoutTemplate,
  Zap,
  Mic,
  FileText,
  Image as ImageIcon,
  X,
  Search,
  GitBranch,
  Play,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useCan } from "@/hooks/use-can";
import { cn } from "@/lib/utils";
import type { QuickReply } from "@/types";
import { ReplyQuote } from "./reply-quote";

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

interface AttachedMedia {
  url: string;
  type: "audio" | "document" | "image" | "video";
  filename?: string | null;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  onSend: (
    text: string,
    replyToId?: string,
    mediaUrl?: string | null,
    mediaType?: string | null,
    mediaFilename?: string | null
  ) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}

export function MessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onOpenTemplates,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickReplyModalOpen, setQuickReplyModalOpen] = useState(false);
  const [attachedMedia, setAttachedMedia] = useState<AttachedMedia | null>(null);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [quickSearch, setQuickSearch] = useState("");

  // Flows state
  const [flows, setFlows] = useState<
    Array<{
      id: string;
      name: string;
      description?: string | null;
      status: string;
      trigger_type: string;
    }>
  >([]);
  const [flowModalOpen, setFlowModalOpen] = useState(false);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const [startingFlowId, setStartingFlowId] = useState<string | null>(null);
  const [flowSearch, setFlowSearch] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = useCan("send-messages");
  const readOnly = !canSend;

  const handleOpenFlows = useCallback(async () => {
    setFlowModalOpen(true);
    setLoadingFlows(true);
    try {
      const res = await fetch("/api/flows");
      if (res.ok) {
        const data = await res.json();
        setFlows(
          (data?.flows || []).filter(
            (f: { status: string }) => f.status === "active"
          )
        );
      }
    } catch (err) {
      console.error("Failed to fetch flows:", err);
    } finally {
      setLoadingFlows(false);
    }
  }, []);

  const handleStartFlow = useCallback(
    async (flow: { id: string; name: string }) => {
      setStartingFlowId(flow.id);
      try {
        const res = await fetch(`/api/flows/${flow.id}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: conversationId }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to start flow");
        }
        toast.success(`Flow "${flow.name}" started! Bot is running.`);
        setFlowModalOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error starting flow");
      } finally {
        setStartingFlowId(null);
      }
    },
    [conversationId]
  );

  // Load quick replies on mount
  useEffect(() => {
    fetch("/api/quick-replies")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.quick_replies) {
          setQuickReplies(data.quick_replies.filter((r: QuickReply) => r.is_active));
        }
      })
      .catch((err) => console.error("Failed to load quick replies:", err));
  }, []);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  // Filter suggestions when user starts typing '/'
  const isTypingSlash = text.startsWith("/");
  const slashQuery = isTypingSlash ? text.slice(1).toLowerCase().trim() : "";

  const slashSuggestions = useMemo(() => {
    if (!isTypingSlash) return [];
    if (!slashQuery) return quickReplies;
    return quickReplies.filter((r) => {
      const matchShortcut = r.shortcut.toLowerCase().includes(slashQuery);
      const matchTitle = r.title.toLowerCase().includes(slashQuery);
      const matchKeyword = (r.auto_keywords || []).some((k) =>
        k.toLowerCase().includes(slashQuery)
      );
      return matchShortcut || matchTitle || matchKeyword;
    });
  }, [isTypingSlash, slashQuery, quickReplies]);

  // Keep selected index in bounds
  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [slashSuggestions.length]);

  const handleApplyQuickReply = useCallback(
    (reply: QuickReply) => {
      setText(reply.message);
      if (reply.media_url && reply.media_type && reply.media_type !== "none") {
        setAttachedMedia({
          url: reply.media_url,
          type: reply.media_type as "audio" | "document" | "image" | "video",
          filename: reply.media_filename,
        });
      } else {
        setAttachedMedia(null);
      }
      setQuickReplyModalOpen(false);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = `${Math.min(
            textareaRef.current.scrollHeight,
            96
          )}px`;
        }
      }, 50);
    },
    []
  );

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if ((!trimmed && !attachedMedia) || sending || sessionExpired) return;

    setSending(true);
    try {
      onSend(
        trimmed,
        replyTo?.id,
        attachedMedia?.url,
        attachedMedia?.type,
        attachedMedia?.filename
      );
      setText("");
      setAttachedMedia(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }, [text, attachedMedia, sending, sessionExpired, onSend, replyTo?.id]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Suggestion keyboard navigation
      if (isTypingSlash && slashSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedSuggestionIndex((i) => (i + 1) % slashSuggestions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedSuggestionIndex(
            (i) => (i - 1 + slashSuggestions.length) % slashSuggestions.length
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const target = slashSuggestions[selectedSuggestionIndex];
          if (target) {
            handleApplyQuickReply(target);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setText("");
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        // On mobile viewports (virtual keyboards), let Return/Enter insert newline; tap Send to submit
        if (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [
      isTypingSlash,
      slashSuggestions,
      selectedSuggestionIndex,
      handleApplyQuickReply,
      handleSend,
    ]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  // Filtered replies for the ⚡ modal
  const modalFilteredReplies = useMemo(() => {
    if (!quickSearch.trim()) return quickReplies;
    const q = quickSearch.toLowerCase().trim();
    return quickReplies.filter(
      (r) =>
        r.shortcut.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.message.toLowerCase().includes(q) ||
        (r.auto_keywords || []).some((k) => k.toLowerCase().includes(q))
    );
  }, [quickReplies, quickSearch]);

  return (
    <div className="relative border-t border-slate-800 bg-slate-900 p-2.5 sm:p-3 min-w-0 w-full">
      {/* Floating '/' Quick Reply Suggestions Popover */}
      {isTypingSlash && slashSuggestions.length > 0 && (
        <div className="absolute bottom-full left-2 right-2 sm:left-4 sm:right-4 mb-2 max-h-60 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl z-50 divide-y divide-slate-800 animate-in fade-in slide-in-from-bottom-2">
          <div className="px-3 py-1.5 bg-slate-800/80 text-[11px] font-semibold text-amber-400 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Zap className="h-3 w-3" /> Quick Replies (Tab or Enter to select)
            </span>
            <span className="text-[10px] text-slate-400">Esc to cancel</span>
          </div>
          {slashSuggestions.map((reply, idx) => {
            const isSelected = idx === selectedSuggestionIndex;
            return (
              <button
                type="button"
                key={reply.id}
                onClick={() => handleApplyQuickReply(reply)}
                onMouseEnter={() => setSelectedSuggestionIndex(idx)}
                className={cn(
                  "w-full px-3 py-2 text-left flex items-start gap-2.5 transition-colors cursor-pointer",
                  isSelected
                    ? "bg-slate-800 text-white"
                    : "text-slate-300 hover:bg-slate-800/50"
                )}
              >
                <Badge
                  variant="outline"
                  className="border-amber-500/40 bg-amber-500/10 text-amber-300 font-mono text-[11px] shrink-0 mt-0.5"
                >
                  {reply.shortcut}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white truncate">
                      {reply.title}
                    </span>
                    {reply.media_type === "audio" && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400 bg-emerald-500/10 px-1 rounded shrink-0">
                        <Mic className="h-2.5 w-2.5" /> Voice
                      </span>
                    )}
                    {reply.media_type === "document" && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-400 bg-blue-500/10 px-1 rounded shrink-0">
                        <FileText className="h-2.5 w-2.5" /> PDF
                      </span>
                    )}
                    {reply.media_type === "image" && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-purple-400 bg-purple-500/10 px-1 rounded shrink-0">
                        <ImageIcon className="h-2.5 w-2.5" /> Image
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    {reply.message}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Reply Quote preview */}
      {replyTo && (
        <div className="mb-2 min-w-0">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}

      {/* Attached Media Pill */}
      {attachedMedia && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs text-white">
          <div className="flex items-center gap-2 min-w-0">
            {attachedMedia.type === "audio" && (
              <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                <Mic className="h-3.5 w-3.5" /> Voice Note attached
              </span>
            )}
            {attachedMedia.type === "document" && (
              <span className="inline-flex items-center gap-1 text-blue-400 font-medium truncate">
                <FileText className="h-3.5 w-3.5 shrink-0" />
                {attachedMedia.filename || "PDF Document"}
              </span>
            )}
            {attachedMedia.type === "image" && (
              <span className="inline-flex items-center gap-1 text-purple-400 font-medium">
                <ImageIcon className="h-3.5 w-3.5" /> Image attached
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setAttachedMedia(null)}
            className="text-slate-400 hover:text-red-400 ml-2"
            title="Remove attachment"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {sessionExpired && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2 min-w-0">
          <p className="text-xs text-amber-400 truncate">
            24-hour session expired. Use a template to re-engage.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-400 hover:text-amber-300 shrink-0 ml-2"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            Templates
          </Button>
        </div>
      )}

      <div className="flex items-end gap-1.5 sm:gap-2 min-w-0 w-full">
        {/* Quick Replies Button (⚡) */}
        <GatedButton
          variant="ghost"
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          title={readOnly ? undefined : "Quick replies & Bot (/)"}
          className="h-9 w-9 shrink-0 p-0 text-amber-400 hover:text-amber-300 hover:bg-slate-800"
          onClick={() => setQuickReplyModalOpen(true)}
        >
          <Zap className="h-4 w-4" />
        </GatedButton>

        {/* Template Picker Button */}
        <GatedButton
          variant="ghost"
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          title={readOnly ? undefined : "Send template"}
          className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white"
          onClick={onOpenTemplates}
        >
          <LayoutTemplate className="h-4 w-4" />
        </GatedButton>

        {/* Start Flow Button (🔄) */}
        <GatedButton
          variant="ghost"
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          title={readOnly ? undefined : "Start Flow / Bot (🔄)"}
          className="h-9 w-9 shrink-0 p-0 text-blue-400 hover:text-blue-300 hover:bg-slate-800"
          onClick={handleOpenFlows}
        >
          <GitBranch className="h-4 w-4" />
        </GatedButton>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            readOnly
              ? "Read-only — viewers can browse but not reply"
              : sessionExpired
                ? "Session expired - use a template"
                : "Type a message or '/' for quick replies..."
          }
          disabled={sessionExpired || readOnly}
          rows={1}
          title={readOnly ? "Read-only — your role can't send messages" : undefined}
          className={cn(
            "flex-1 min-w-0 resize-none rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 sm:px-4 sm:py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-primary/50",
            (sessionExpired || readOnly) && "cursor-not-allowed opacity-50"
          )}
        />

        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={(!text.trim() && !attachedMedia) || sessionExpired || sending}
          onClick={handleSend}
          className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </GatedButton>
      </div>

      {/* Quick Replies Modal (⚡) */}
      <Dialog open={quickReplyModalOpen} onOpenChange={setQuickReplyModalOpen}>
        <DialogContent className="border-slate-800 bg-slate-900 text-white max-w-lg max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-4 border-b border-slate-800 pr-12">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              Quick Replies & Bot Actions
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Select a quick reply to insert into the message box with attachments.
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 border-b border-slate-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <Input
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
                placeholder="Search shortcut, title, or keywords..."
                className="pl-8 bg-slate-800 border-slate-700 text-xs h-8"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[50vh]">
            {modalFilteredReplies.length === 0 ? (
              <p className="text-center py-8 text-xs text-slate-500">
                No quick replies found. Create one in Settings &gt; Quick Replies.
              </p>
            ) : (
              modalFilteredReplies.map((reply) => (
                <div
                  key={reply.id}
                  onClick={() => handleApplyQuickReply(reply)}
                  className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-800/60 cursor-pointer transition-colors space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="border-amber-500/40 bg-amber-500/10 text-amber-300 font-mono text-[11px]"
                      >
                        {reply.shortcut}
                      </Badge>
                      <span className="text-xs font-semibold text-white">
                        {reply.title}
                      </span>
                    </div>
                    {reply.media_type === "audio" && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                        <Mic className="h-3 w-3" /> Voice
                      </span>
                    )}
                    {reply.media_type === "document" && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                        <FileText className="h-3 w-3" /> PDF
                      </span>
                    )}
                    {reply.media_type === "image" && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">
                        <ImageIcon className="h-3 w-3" /> Image
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-2 whitespace-pre-line">
                    {reply.message}
                  </p>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Start Flow Modal (🔄) */}
      <Dialog open={flowModalOpen} onOpenChange={setFlowModalOpen}>
        <DialogContent className="border-slate-800 bg-slate-900 text-white max-w-lg max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-4 border-b border-slate-800 pr-12">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-blue-400" />
              Start Flow for this Contact
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Select an active Flow to start for this conversation. The bot will automatically begin sending the flow messages.
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 border-b border-slate-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <Input
                value={flowSearch}
                onChange={(e) => setFlowSearch(e.target.value)}
                placeholder="Search flows by name..."
                className="pl-8 bg-slate-800 border-slate-700 text-xs h-8"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[50vh]">
            {loadingFlows ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
              </div>
            ) : flows.filter((f) => f.name.toLowerCase().includes(flowSearch.toLowerCase())).length === 0 ? (
              <p className="text-center py-8 text-xs text-slate-500">
                No active flows found. Activate or create a flow in the Flows builder.
              </p>
            ) : (
              flows
                .filter((f) => f.name.toLowerCase().includes(flowSearch.toLowerCase()))
                .map((flow) => {
                  const isStarting = startingFlowId === flow.id;
                  return (
                    <div
                      key={flow.id}
                      className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 hover:border-slate-700 flex items-center justify-between gap-3 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white truncate">
                            {flow.name}
                          </span>
                          <Badge
                            variant="outline"
                            className="border-blue-500/40 bg-blue-500/10 text-blue-300 text-[10px] px-1.5 py-0"
                          >
                            {flow.trigger_type}
                          </Badge>
                        </div>
                        {flow.description && (
                          <p className="text-xs text-slate-400 truncate mt-0.5">
                            {flow.description}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        disabled={isStarting}
                        onClick={() => handleStartFlow(flow)}
                        className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-8 shrink-0 flex items-center gap-1.5"
                      >
                        {isStarting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3 fill-current" />
                        )}
                        <span>Launch</span>
                      </Button>
                    </div>
                  );
                })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
