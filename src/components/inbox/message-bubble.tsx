"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-slate-500 dark:text-slate-400" />;
    case "sent":
      return <Check className="h-3 w-3 text-slate-500 dark:text-slate-400" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-slate-500 dark:text-slate-400" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-[#53bdeb] dark:text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-500 dark:text-red-400" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-700/40 px-3 py-2 text-xs text-slate-300">
      <ImageOff className="h-4 w-4 shrink-0 text-slate-500" />
      <span>{label} unavailable</span>
    </div>
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-slate-700">
        <ImageOff className="h-8 w-8 text-slate-500" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-slate-700">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <img
      src={src ?? ""}
      alt={alt}
      className="max-h-64 max-w-full sm:max-w-60 rounded-lg object-cover"
      onError={() => setError(true)}
    />
  );
}

/**
 * Detects URLs in message text and renders them as clickable links,
 * keeping regular text untouched. Trims trailing punctuation (like .,!?:;)
 * from the URL so sentences like "visit https://google.com." work cleanly.
 */
function renderTextWithLinks(text: string | null | undefined, isAgent: boolean) {
  if (!text) return null;

  // Match URLs starting with http://, https://, or www.
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    if (urlRegex.test(part)) {
      urlRegex.lastIndex = 0;

      // Extract trailing punctuation if any (e.g. '.', ',', '!', '?', ')', ';')
      let url = part;
      let trailingPunctuation = "";
      const punctMatch = part.match(/([.,!?:;)]+)$/);
      if (punctMatch) {
        trailingPunctuation = punctMatch[1];
        url = part.slice(0, -trailingPunctuation.length);
      }

      const href = url.startsWith("www.") ? `https://${url}` : url;

      return (
        <span key={index}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "underline underline-offset-2 font-medium transition-colors cursor-pointer",
              isAgent
                ? "text-[#027eb5] hover:text-[#005c87] dark:text-blue-100 dark:hover:text-white"
                : "text-[#027eb5] hover:text-[#005c87] dark:text-blue-400 dark:hover:text-blue-300"
            )}
          >
            {url}
          </a>
          {trailingPunctuation}
        </span>
      );
    }
    return part;
  });
}

function MessageContent({ message, isAgent }: { message: Message; isAgent: boolean }) {
  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word] text-sm leading-relaxed select-text">
          {renderTextWithLinks(message.content_text, isAgent)}
        </p>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt="Shared image" />
          ) : (
            <MediaUnavailable label="Image" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word] text-sm leading-relaxed select-text">
              {renderTextWithLinks(message.content_text, isAgent)}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <video
              src={message.media_url}
              controls
              className="max-h-64 max-w-full sm:max-w-60 rounded-lg"
            />
          ) : (
            <MediaUnavailable label="Video" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word] text-sm leading-relaxed select-text">
              {renderTextWithLinks(message.content_text, isAgent)}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-full sm:max-w-60" />
          ) : (
            <MediaUnavailable label="Audio" />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || "Document"} />;
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-slate-700/50 px-3 py-2 text-sm hover:bg-slate-700 max-w-full overflow-hidden"
        >
          <FileText className="h-5 w-5 shrink-0 text-slate-400" />
          <span className="truncate break-all">
            {message.content_text || "Document"}
          </span>
        </a>
      );

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            Template
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word] text-sm leading-relaxed select-text">
              {renderTextWithLinks(message.content_text, isAgent)}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="break-words [overflow-wrap:anywhere]">{message.content_text || "Location shared"}</span>
        </div>
      );

    case "interactive": {
      // Customer tapped a reply button or list row on a message the bot
      // sent. We show the tapped option's title (already in content_text,
      // set by parseMessageContent in the webhook) with a small affordance
      // so agents reading the inbox can tell at a glance that this is a
      // tap rather than the customer typing the same words.
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            <CornerDownLeft className="h-3 w-3" />
            Button reply
          </span>
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word] text-sm leading-relaxed select-text">
            {renderTextWithLinks(message.content_text || "[Interactive reply]", isAgent)}
          </p>
        </div>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word] text-sm leading-relaxed select-text">
          {renderTextWithLinks(message.content_text || "[Unsupported message type]", isAgent)}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
}: MessageBubbleProps) {
  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "h:mm a");

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative max-w-full rounded-2xl px-3 py-2 overflow-hidden break-words [overflow-wrap:anywhere] shadow-xs",
          isAgent
            ? "rounded-br-md bg-[#d9fdd3] text-[#111b21] dark:bg-primary dark:text-primary-foreground"
            : "rounded-bl-md bg-white text-[#111b21] border border-slate-200/60 dark:border-transparent dark:bg-slate-800 dark:text-slate-100",
        )}
      >
        {reply && (
          <ReplyQuote authorLabel={reply.authorLabel} preview={reply.preview} />
        )}
        <MessageContent message={message} isAgent={isAgent} />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          <span className="text-[10px] text-slate-500 dark:text-white/60">{time}</span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
