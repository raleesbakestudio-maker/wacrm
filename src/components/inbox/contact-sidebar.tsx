"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Contact, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  StickyNote,
  Plus,
  X,
  Search,
  Edit2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ContactDetailView } from "@/components/contacts/contact-detail-view";
import { toast } from "sonner";
import { format } from "date-fns";

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch notes, assigned tags, and all account tags in parallel
    const [notesRes, tagsRes, allTagsRes] = await Promise.all([
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase
        .from("tags")
        .select("*")
        .order("name"),
    ]);

    if (notesRes.data) setNotes(notesRes.data);
    if (allTagsRes.data) setAllTags(allTagsRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  useEffect(() => {
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data: profile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", user?.id)
      .maybeSingle();

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        user_id: user?.id,
        account_id: profile?.account_id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
      toast.success("Note added");
    } else {
      toast.error("Failed to add note");
    }
    setAddingNote(false);
  }, [contact, newNote]);

  const handleToggleTag = useCallback(
    async (targetTag: Tag) => {
      if (!contact) return;
      const supabase = createClient();
      const existing = tags.find((t) => t.id === targetTag.id);

      if (existing) {
        // Optimistic remove
        setTags((prev) => prev.filter((t) => t.id !== targetTag.id));
        const { error } = await supabase
          .from("contact_tags")
          .delete()
          .eq("contact_id", contact.id)
          .eq("tag_id", targetTag.id);

        if (error) {
          toast.error("Failed to remove tag");
          fetchContactData();
        } else {
          toast.success(`Removed tag "${targetTag.name}"`);
        }
      } else {
        // Optimistic add
        const tempId = `temp-${Date.now()}`;
        setTags((prev) => [...prev, { ...targetTag, contact_tag_id: tempId }]);
        const { data, error } = await supabase
          .from("contact_tags")
          .insert({ contact_id: contact.id, tag_id: targetTag.id })
          .select("id")
          .single();

        if (error) {
          toast.error("Failed to add tag");
          fetchContactData();
        } else {
          setTags((prev) =>
            prev.map((t) =>
              t.contact_tag_id === tempId ? { ...t, contact_tag_id: data.id } : t
            )
          );
          toast.success(`Added tag "${targetTag.name}"`);
        }
      }
    },
    [contact, tags, fetchContactData]
  );

  const handleRemoveTag = useCallback(
    async (tagId: string, tagName: string) => {
      if (!contact) return;
      const supabase = createClient();
      setTags((prev) => prev.filter((t) => t.id !== tagId));

      const { error } = await supabase
        .from("contact_tags")
        .delete()
        .eq("contact_id", contact.id)
        .eq("tag_id", tagId);

      if (error) {
        toast.error("Failed to remove tag");
        fetchContactData();
      } else {
        toast.success(`Removed tag "${tagName}"`);
      }
    },
    [contact, fetchContactData]
  );

  const handleCreateAndAssignTag = useCallback(
    async (name: string) => {
      if (!contact || !name.trim()) return;
      setCreatingTag(true);
      const supabase = createClient();

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) throw new Error("Not authenticated");

        const { data: profile } = await supabase
          .from("profiles")
          .select("account_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!profile?.account_id) throw new Error("Account not found");

        const { data: newTag, error: createError } = await supabase
          .from("tags")
          .insert({
            user_id: user.id,
            account_id: profile.account_id,
            name: name.trim(),
            color: "#10b981",
          })
          .select("*")
          .single();

        if (createError || !newTag) throw createError || new Error("Failed to create tag");

        const { data: ctData, error: assignError } = await supabase
          .from("contact_tags")
          .insert({ contact_id: contact.id, tag_id: newTag.id })
          .select("id")
          .single();

        if (assignError) throw assignError;

        setAllTags((prev) => [...prev, newTag]);
        setTags((prev) => [
          ...prev,
          { ...newTag, contact_tag_id: ctData?.id || newTag.id },
        ]);
        setTagSearch("");
        toast.success(`Created & added tag "${newTag.name}"`);
      } catch (err) {
        console.error("Create tag error:", err);
        toast.error(err instanceof Error ? err.message : "Failed to create tag");
      } finally {
        setCreatingTag(false);
      }
    },
    [contact]
  );

  if (!contact) {
    return (
      <div className="flex h-full w-full lg:w-70 items-center justify-center border-l border-slate-800 bg-slate-900">
        <p className="text-sm text-slate-500">Select a conversation</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();
  const filteredTags = allTags.filter((t) =>
    t.name.toLowerCase().includes(tagSearch.toLowerCase().trim())
  );

  return (
    <div className="flex h-full w-full lg:w-70 flex-col lg:border-l border-slate-800 bg-slate-900">
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Contact Info Profile */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-700 text-lg font-semibold text-white">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-white">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-slate-400">{contact.company}</p>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setDetailModalOpen(true)}
              className="mt-2.5 h-7 gap-1.5 border-slate-700 bg-transparent text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <Edit2 className="h-3 w-3" />
              Edit Profile
            </Button>
          </div>

          {/* Contact Details (Phone & Email) */}
          <div className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800/80"
              title="Click to copy phone number"
            >
              <Phone className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              <span className="flex-1 text-left font-mono">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary shrink-0" />
              ) : (
                <Copy className="h-3 w-3 text-slate-600 shrink-0" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300">
                <Mail className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-slate-800" />

          {/* Tags Section */}
          <div>
            <div className="flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
              <span className="flex items-center gap-1.5">
                <TagIcon className="h-3.5 w-3.5" />
                Tags ({tags.length})
              </span>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag.contact_tag_id || tag.id}
                  className="inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: `${tag.color}25`,
                    color: tag.color,
                    border: `1px solid ${tag.color}40`,
                  }}
                >
                  <span className="truncate max-w-[120px]">{tag.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag.id, tag.name)}
                    aria-label={`Remove tag ${tag.name}`}
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-black/40 text-current"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}

              {/* Add Tag Popover */}
              <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                <PopoverTrigger
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-400 transition-colors hover:border-primary/50 hover:bg-slate-800 hover:text-primary"
                >
                  <Plus className="h-3 w-3" />
                  <span>Tag</span>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-64 border-slate-700 bg-slate-900 p-2 text-slate-200 shadow-xl"
                >
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                    <Input
                      value={tagSearch}
                      onChange={(e) => setTagSearch(e.target.value)}
                      placeholder="Search or add tag..."
                      className="h-8 pl-8 text-xs bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {filteredTags.map((tag) => {
                      const isAssigned = tags.some((t) => t.id === tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => handleToggleTag(tag)}
                          className={cn(
                            "flex w-full items-center justify-between rounded px-2 py-1.5 text-xs transition-colors text-left",
                            isAssigned
                              ? "bg-primary/10 text-primary"
                              : "text-slate-300 hover:bg-slate-800"
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                            <span className="truncate font-medium">{tag.name}</span>
                          </div>
                          {isAssigned && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                        </button>
                      );
                    })}

                    {filteredTags.length === 0 && tagSearch.trim() && (
                      <button
                        type="button"
                        onClick={() => handleCreateAndAssignTag(tagSearch.trim())}
                        disabled={creatingTag}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-primary hover:bg-primary/10 transition-colors"
                      >
                        {creatingTag ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                        <span className="truncate">Create &quot;{tagSearch.trim()}&quot;</span>
                      </button>
                    )}

                    {filteredTags.length === 0 && !tagSearch.trim() && (
                      <p className="px-2 py-3 text-center text-xs text-slate-500">
                        No tags yet
                      </p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-slate-800" />

          {/* Notes Section */}
          <div>
            <div className="flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
              <StickyNote className="h-3.5 w-3.5" />
              Notes ({notes.length})
            </div>
            <div className="mt-2.5 space-y-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add private note about this student..."
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2.5 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                  title="Add Note"
                >
                  {addingNote ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-slate-800/80 border border-slate-700/60 p-2.5"
                  >
                    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-xs text-slate-200">
                      {note.note_text}
                    </p>
                    <p className="mt-1.5 text-[10px] text-slate-500">
                      {format(new Date(note.created_at), "MMM d, yyyy h:mm a")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Full Contact Detail View Modal */}
      <ContactDetailView
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        contactId={contact.id}
        onUpdated={fetchContactData}
      />
    </div>
  );
}
