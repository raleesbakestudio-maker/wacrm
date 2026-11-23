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
  Pause,
  Square,
  Trash2,
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

  // Voice Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previewAudioElRef = useRef<HTMLAudioElement | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  const formatDuration = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  const cleanupAudioStream = useCallback(() => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
  }, []);

  const discardVoiceRecording = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    cleanupAudioStream();
    if (previewAudioUrl) {
      URL.revokeObjectURL(previewAudioUrl);
    }
    setIsRecording(false);
    setRecordingSeconds(0);
    setRecordedBlob(null);
    setPreviewAudioUrl(null);
    setIsPlayingPreview(false);
  }, [cleanupAudioStream, previewAudioUrl]);

  const startVoiceRecording = useCallback(async () => {
    if (readOnly) {
      toast.error("Read-only access: നിങ്ങൾക്ക് മെസ്സേജ് അയക്കാനുള്ള അനുമതിയില്ല.");
      return;
    }
    if (sessionExpired) {
      toast.error(
        "24-hour session expired! ഉപഭോക്താവ് തിരിച്ച് മെസ്സേജ് അയക്കാതെ വോയ്‌സ് അയക്കാൻ WhatsApp അനുവദിക്കില്ല. ദയവായി ആദ്യം ഒരു Template അയക്കുക.",
        { duration: 6000 }
      );
      return;
    }

    try {
      if (typeof window !== "undefined") {
        if (
          !window.isSecureContext &&
          window.location.hostname !== "localhost" &&
          window.location.hostname !== "127.0.0.1"
        ) {
          toast.error(
            "മൈക്രോഫോൺ സുരക്ഷിതമായ HTTPS അല്ലെങ്കിൽ localhost-ൽ മാത്രമേ പ്രവർത്തിക്കൂ (Insecure HTTP context).",
            { duration: 6000 }
          );
          return;
        }
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error("Audio recording is not supported in this browser.");
        return;
      }

      discardVoiceRecording();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];

      let mimeType = "";
      if (typeof MediaRecorder !== "undefined") {
        if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        } else if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
          mimeType = "audio/ogg;codecs=opus";
        }
      }

      let recorder: MediaRecorder;
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch (recErr) {
        console.warn("Failed with mimeType, falling back to default:", recErr);
        recorder = new MediaRecorder(stream);
      }
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        cleanupAudioStream();
        const finalBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/ogg",
        });
        setRecordedBlob(finalBlob);
        const objUrl = URL.createObjectURL(finalBlob);
        setPreviewAudioUrl(objUrl);
      };

      recorder.start(100);
      setIsRecording(true);
      setRecordingSeconds(0);

      recordTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: unknown) {
      console.error("Mic access error:", err);
      const errorObj = err as { name?: string; message?: string };
      const errorName = errorObj?.name || "";
      const errorMsg = errorObj?.message || "";

      if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
        toast.error(
          "മൈക്രോഫോൺ ആക്സസ് തടഞ്ഞിരിക്കുന്നു (NotAllowedError). Mac Settings ➡️ Privacy & Security ➡️ Microphone-ൽ Chrome ഓൺ ആണെന്നും പേജ് Refresh ചെയ്തെന്നും ഉറപ്പാക്കുക.",
          { duration: 7000 }
        );
      } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
        toast.error(
          "മൈക്രോഫോൺ കണ്ടെത്താനായില്ല (NotFoundError). മൈക്ക് കണക്റ്റ് ചെയ്തിട്ടുണ്ടെന്ന് ഉറപ്പാക്കുക.",
          { duration: 5000 }
        );
      } else if (errorName === "NotReadableError") {
        toast.error(
          "മൈക്രോഫോൺ മറ്റൊരു ആപ്പ് ഉപയോഗിക്കുകയാണ് (NotReadableError). Zoom/FaceTime/Meet ക്ലോസ് ചെയ്യുക.",
          { duration: 6000 }
        );
      } else {
        toast.error(
          `മൈക്രോഫോൺ എറർ (${errorName || "Error"}): ${errorMsg || "Unable to access mic"}`,
          { duration: 6000 }
        );
      }
      discardVoiceRecording();
    }
  }, [cleanupAudioStream, discardVoiceRecording, readOnly, sessionExpired]);

  const stopVoiceRecordingForReview = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const sendRecordedVoice = useCallback(
    async (blobToSend?: Blob) => {
      const blob = blobToSend || recordedBlob;
      if (!blob) {
        toast.error("No recorded voice found");
        return;
      }

      setUploadingVoice(true);
      try {
        const formData = new FormData();
        const ext = blob.type.includes("mp4")
          ? "m4a"
          : blob.type.includes("webm")
            ? "webm"
            : "ogg";
        formData.append("file", blob, `voice-note-${Date.now()}.${ext}`);

        const res = await fetch("/api/whatsapp/voice/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to upload voice note");
        }

        const data = (await res.json()) as { url: string; filename: string };
        onSend("", replyTo?.id, data.url, "audio", data.filename);

        discardVoiceRecording();
        toast.success("Voice note sent");
      } catch (err) {
        console.error("Voice send failed:", err);
        toast.error(
          err instanceof Error ? err.message : "Failed to send voice note"
        );
      } finally {
        setUploadingVoice(false);
      }
    },
    [discardVoiceRecording, onSend, recordedBlob, replyTo?.id]
  );

  const handleQuickSendLive = useCallback(() => {
    if (!mediaRecorderRef.current) return;

    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    recorder.onstop = () => {
      cleanupAudioStream();
      const finalBlob = new Blob(audioChunksRef.current, {
        type: recorder.mimeType || "audio/ogg",
      });
      sendRecordedVoice(finalBlob);
    };

    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsRecording(false);
  }, [cleanupAudioStream, sendRecordedVoice]);

  const togglePreviewAudio = useCallback(() => {
    if (!previewAudioElRef.current) return;
    if (isPlayingPreview) {
      previewAudioElRef.current.pause();
      setIsPlayingPreview(false);
    } else {
      previewAudioElRef.current
        .play()
        .then(() => {
          setIsPlayingPreview(true);
        })
        .catch(() => {
          setIsPlayingPreview(false);
        });
    }
  }, [isPlayingPreview]);

  // Clean up recording stream on unmount
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      cleanupAudioStream();
    };
  }, [cleanupAudioStream]);

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

      {isRecording ? (
        /* Active Recording Bar */
        <div className="flex items-center justify-between gap-2 sm:gap-3 w-full bg-slate-900 border border-red-500/50 rounded-xl px-3 py-2 text-white">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
            </span>
            <span className="text-xs font-medium text-red-400 shrink-0">Recording Voice…</span>
            <span className="font-mono text-xs font-semibold text-white bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
              {formatDuration(recordingSeconds)}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Discard */}
            <button
              type="button"
              onClick={discardVoiceRecording}
              title="Discard recording"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            {/* Stop & Review */}
            <button
              type="button"
              onClick={stopVoiceRecordingForReview}
              title="Stop & Review"
              className="h-8 px-2.5 rounded-lg flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors border border-slate-700"
            >
              <Square className="h-3 w-3 fill-current text-amber-400" />
              <span>Review</span>
            </button>

            {/* Quick Send Live */}
            <Button
              size="sm"
              disabled={uploadingVoice}
              onClick={handleQuickSendLive}
              className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white gap-1 px-3 text-xs"
            >
              {uploadingVoice ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span>Send</span>
            </Button>
          </div>
        </div>
      ) : recordedBlob && previewAudioUrl ? (
        /* Preview Recorded Audio Bar */
        <div className="flex items-center justify-between gap-2 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={togglePreviewAudio}
              className="h-8 w-8 shrink-0 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center hover:bg-emerald-500/30 transition-colors"
            >
              {isPlayingPreview ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4 ml-0.5" />
              )}
            </button>
            <audio
              ref={previewAudioElRef}
              src={previewAudioUrl}
              onEnded={() => setIsPlayingPreview(false)}
              className="hidden"
            />
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">
                Voice Note Recorded
              </p>
              <p className="text-[11px] font-mono text-slate-400">
                Duration: {formatDuration(recordingSeconds)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={discardVoiceRecording}
              title="Discard recording"
              className="h-8 w-8 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 flex items-center justify-center transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            <Button
              size="sm"
              disabled={uploadingVoice}
              onClick={() => sendRecordedVoice()}
              className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white gap-1 px-3 text-xs"
            >
              {uploadingVoice ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span>Send Voice</span>
            </Button>
          </div>
        </div>
      ) : (
        /* Standard Composer Bar */
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
            title={
              readOnly ? "Read-only — your role can't send messages" : undefined
            }
            className={cn(
              "flex-1 min-w-0 resize-none rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 sm:px-4 sm:py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-primary/50",
              (sessionExpired || readOnly) && "cursor-not-allowed opacity-50"
            )}
          />

          {/* Voice Mic Button (🎙️) */}
          <GatedButton
            type="button"
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            title={
              sessionExpired
                ? "24-hr session expired - cannot send voice note"
                : "Record Voice Note (🎙️)"
            }
            disabled={sending}
            className={cn(
              "h-9 w-9 shrink-0 p-0 text-emerald-400 hover:text-emerald-300 hover:bg-slate-800",
              sessionExpired && "opacity-60 text-slate-400"
            )}
            onClick={startVoiceRecording}
          >
            <Mic className="h-4 w-4" />
          </GatedButton>

          {/* Send Button */}
          <GatedButton
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={
              (!text.trim() && !attachedMedia) || sessionExpired || sending
            }
            onClick={handleSend}
            className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </GatedButton>
        </div>
      )}

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
