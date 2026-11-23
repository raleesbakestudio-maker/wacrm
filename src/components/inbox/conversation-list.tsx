"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import { Search, ChevronDown, Tag as TagIcon, X, Check } from "lucide-react";
import { formatWhatsAppListTimestamp } from "@/lib/whatsapp/date-format";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-slate-500",
};

const FILTER_OPTIONS: { label: string; value: ConversationStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Pending", value: "pending" },
  { label: "Closed", value: "closed" },
];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConversationStatus | "all">("all");
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string>("all");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const [convRes, tagsRes] = await Promise.all([
        supabase
          .from("conversations")
          .select("*, contact:contacts(*)")
          .order("last_message_at", { ascending: false }),
        supabase.from("tags").select("*").order("name"),
      ]);

      if (cancelled) return;

      if (tagsRes.data) {
        setAllTags(tagsRes.data as Tag[]);
      }

      if (convRes.error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: convRes.error.message,
          details: convRes.error.details,
          hint: convRes.error.hint,
          code: convRes.error.code,
        });
        setLoading(false);
        return;
      }

      const convs = (convRes.data ?? []) as Conversation[];
      const contactIds = Array.from(
        new Set(convs.map((c) => c.contact_id).filter(Boolean))
      );

      if (contactIds.length > 0) {
        const { data: ctRows } = await supabase
          .from("contact_tags")
          .select("contact_id, tag_id, tags(*)")
          .in("contact_id", contactIds);

        if (!cancelled && ctRows) {
          const tagsByContact: Record<string, Tag[]> = {};
          ctRows.forEach((row: Record<string, unknown>) => {
            const cid = row.contact_id as string;
            const t = row.tags as Tag | null;
            if (cid && t) {
              if (!tagsByContact[cid]) tagsByContact[cid] = [];
              tagsByContact[cid].push(t);
            }
          });

          convs.forEach((c) => {
            if (c.contact && tagsByContact[c.contact_id]) {
              c.contact.tags = tagsByContact[c.contact_id];
            }
          });
        }
      }

      // Deduplicate conversations so that no two windows share the same contact phone number or contact_id
      const seenKeys = new Map<string, Conversation>();
      const deduplicatedConvs: Conversation[] = [];
      for (const c of convs) {
        const rawPhone = c.contact?.phone;
        const cleanPhone = rawPhone ? rawPhone.replace(/\D/g, "") : null;
        const key =
          cleanPhone && cleanPhone.length >= 8
            ? cleanPhone.slice(-10)
            : c.contact_id || c.id;

        if (!seenKeys.has(key)) {
          seenKeys.set(key, c);
          deduplicatedConvs.push(c);
        } else {
          const existing = seenKeys.get(key)!;
          if (
            (!existing.last_message_at && c.last_message_at) ||
            (existing.last_message_at &&
              c.last_message_at &&
              new Date(c.last_message_at) > new Date(existing.last_message_at))
          ) {
            const idx = deduplicatedConvs.indexOf(existing);
            if (idx !== -1) {
              if (existing.contact?.tags && c.contact) {
                const merged = [
                  ...(c.contact.tags || []),
                  ...(existing.contact.tags || []),
                ];
                c.contact.tags = Array.from(
                  new Map(merged.map((t) => [t.id, t])).values()
                );
              }
              deduplicatedConvs[idx] = c;
              seenKeys.set(key, c);
            }
          }
        }
      }

      if (!cancelled) {
        onConversationsLoadedRef.current(deduplicatedConvs);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  const filtered = useMemo(() => {
    // Deduplicate conversations so each phone number only appears once
    const seen = new Set<string>();
    const uniqueConvs: Conversation[] = [];
    for (const c of conversations) {
      const raw = c.contact?.phone;
      const clean = raw ? raw.replace(/\D/g, "") : null;
      const key = clean && clean.length >= 8 ? clean.slice(-10) : c.contact_id || c.id;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueConvs.push(c);
      }
    }

    let result = uniqueConvs;

    if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    if (showUnreadOnly) {
      result = result.filter((c) => c.unread_count > 0);
    }

    if (selectedTagId !== "all") {
      result = result.filter((c) => {
        const contactTags = c.contact?.tags ?? [];
        return contactTags.some((t) => t.id === selectedTagId);
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        const matchesTag = (c.contact?.tags ?? []).some((t) =>
          t.name.toLowerCase().includes(q)
        );
        return (
          name.includes(q) ||
          phone.includes(q) ||
          lastMsg.includes(q) ||
          matchesTag
        );
      });
    }

    return result;
  }, [conversations, filter, showUnreadOnly, selectedTagId, search]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);
  const selectedTag = useMemo(() => {
    if (selectedTagId === "all") return null;
    return allTags.find((t) => t.id === selectedTagId) ?? null;
  }, [allTags, selectedTagId]);

  const hasActiveFilters =
    filter !== "all" || selectedTagId !== "all" || showUnreadOnly || search.trim() !== "";

  const handleResetFilters = useCallback(() => {
    setFilter("all");
    setSelectedTagId("all");
    setShowUnreadOnly(false);
    setSearch("");
  }, []);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full min-w-0 flex-col border-r border-slate-800 bg-slate-900 lg:w-80">
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-slate-800 p-2.5 sm:p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Search name, phone, tag..."
            className="border-slate-700 bg-slate-800 pl-9 pr-8 text-sm text-white placeholder-slate-500 focus:border-primary/50 h-9"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter Dropdowns row */}
        <div className="flex items-center justify-between gap-1.5 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Status Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md border border-slate-700/60 bg-slate-800/80 transition-colors",
                filter !== "all" ? "text-primary border-primary/50 font-medium" : "text-slate-300 hover:text-white hover:bg-slate-700"
              )}>
                <span>{activeFilter?.label ?? "All Status"}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="border-slate-700 bg-slate-800"
              >
                {FILTER_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    onClick={() => setFilter(opt.value)}
                    className={cn(
                      "text-xs flex items-center justify-between",
                      filter === opt.value
                        ? "text-primary font-medium"
                        : "text-slate-300"
                    )}
                  >
                    <span>{opt.label}</span>
                    {filter === opt.value && <Check className="h-3 w-3 ml-2" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Tag Filter Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md border border-slate-700/60 bg-slate-800/80 transition-colors",
                selectedTagId !== "all" ? "text-primary border-primary/50 font-medium" : "text-slate-300 hover:text-white hover:bg-slate-700"
              )}>
                <TagIcon className="h-3 w-3 text-primary shrink-0" />
                <span className="truncate max-w-[110px]">
                  {selectedTag ? selectedTag.name : "All Tags"}
                </span>
                <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="border-slate-700 bg-slate-800 max-h-64 overflow-y-auto w-48"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedTagId("all")}
                  className={cn(
                    "text-xs flex items-center justify-between",
                    selectedTagId === "all" ? "text-primary font-medium" : "text-slate-300"
                  )}
                >
                  <span>All Tags</span>
                  {selectedTagId === "all" && <Check className="h-3 w-3" />}
                </DropdownMenuItem>
                {allTags.length > 0 && <DropdownMenuSeparator className="bg-slate-700" />}
                {allTags.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onClick={() => setSelectedTagId(t.id)}
                    className={cn(
                      "text-xs flex items-center justify-between gap-2",
                      selectedTagId === t.id ? "text-primary font-medium" : "text-slate-300"
                    )}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: t.color || "#3b82f6" }}
                      />
                      <span className="truncate">{t.name}</span>
                    </div>
                    {selectedTagId === t.id && <Check className="h-3 w-3 shrink-0" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              className="inline-flex items-center gap-0.5 text-[11px] text-amber-400 hover:text-amber-300 transition-colors py-0.5 px-1 rounded hover:bg-slate-800"
              title="Reset all filters"
            >
              <X className="h-3 w-3" />
              <span>Clear</span>
            </button>
          )}
        </div>

        {/* Quick Filter Chips (Mobile-friendly horizontal scroll) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 pt-0.5 no-scrollbar text-xs">
          <button
            type="button"
            onClick={() => {
              setFilter("all");
              setSelectedTagId("all");
              setShowUnreadOnly(false);
            }}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors",
              filter === "all" && selectedTagId === "all" && !showUnreadOnly
                ? "bg-primary text-primary-foreground font-semibold"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setShowUnreadOnly(!showUnreadOnly)}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors border",
              showUnreadOnly
                ? "bg-emerald-600/30 text-emerald-300 border-emerald-500 font-semibold"
                : "bg-slate-800 text-slate-300 border-slate-700/60 hover:bg-slate-700"
            )}
          >
            Unread
          </button>
          <button
            type="button"
            onClick={() => setFilter(filter === "open" ? "all" : "open")}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors border",
              filter === "open"
                ? "bg-primary/20 text-primary border-primary font-semibold"
                : "bg-slate-800 text-slate-300 border-slate-700/60 hover:bg-slate-700"
            )}
          >
            Open
          </button>
          {allTags.slice(0, 6).map((t) => {
            const isSelected = selectedTagId === t.id;
            return (
              <button
                type="button"
                key={t.id}
                onClick={() => setSelectedTagId(isSelected ? "all" : t.id)}
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors border",
                  isSelected
                    ? "bg-slate-700 text-white border-primary shadow-xs font-semibold"
                    : "bg-slate-800/80 text-slate-300 border-slate-700/60 hover:bg-slate-700"
                )}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: t.color || "#3b82f6" }}
                />
                <span className="truncate max-w-[100px]">{t.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversation Items */}
      <div className="flex-1 w-full min-w-0 overflow-y-auto overflow-x-hidden divide-y divide-slate-100 dark:divide-slate-800/40 overscroll-contain">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-slate-500">No conversations found</p>
          </div>
        ) : (
          filtered.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={conv.id === activeConversationId}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || "Unknown";
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const lastDate =
    conversation.last_message_at ||
    conversation.updated_at ||
    conversation.created_at;
  const formattedTime =
    formatWhatsAppListTimestamp(lastDate) ||
    formatWhatsAppListTimestamp(conversation.created_at) ||
    "";
  const tags = contact?.tags ?? [];
  const unreadCount = Number(conversation.unread_count) || 0;
  const hasUnread = unreadCount > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer select-none",
        "hover:bg-slate-100 dark:hover:bg-slate-800/60",
        isActive && "border-l-4 border-primary bg-slate-100/90 dark:bg-slate-800/80"
      )}
    >
      {/* Avatar */}
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-sm font-semibold text-slate-700 dark:text-white">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-11 w-11 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col justify-center min-w-0">
        {/* Row 1: Name + WhatsApp Time */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="truncate text-sm sm:text-[15px] font-semibold text-slate-900 dark:text-white min-w-0 flex-1">
            {displayName}
          </span>
          {formattedTime ? (
            <span
              className={cn(
                "shrink-0 text-[11px] sm:text-xs font-medium whitespace-nowrap text-right",
                hasUnread
                  ? "font-bold text-emerald-600 dark:text-emerald-400"
                  : "text-slate-500 dark:text-slate-400"
              )}
            >
              {formattedTime}
            </span>
          ) : null}
        </div>

        {/* Row 2: Last message snippet + Unread badge + Status indicator */}
        <div className="mt-0.5 flex items-center justify-between gap-2 min-w-0">
          <p className="truncate text-xs text-slate-500 dark:text-slate-400 min-w-0 flex-1">
            {conversation.last_message_text || "No messages yet"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5 ml-1.5">
            {hasUnread && (
              <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white px-1 shadow-xs">
                {unreadCount}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full shrink-0",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>

        {/* Row 3: Tags preview */}
        {tags.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1 min-w-0">
            {tags.slice(0, 3).map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none border"
                style={{
                  backgroundColor: `${t.color || "#10b981"}20`,
                  borderColor: `${t.color || "#10b981"}45`,
                  color: t.color || "#059669",
                }}
              >
                {t.name}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
