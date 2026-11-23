'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
import { validateAndFormatWhatsAppPhone, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus } from 'lucide-react';

interface ContactFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
  contactTags?: ContactTag[];
  onSaved: () => void;
}

export function ContactForm({
  open,
  onOpenChange,
  contact,
  contactTags = [],
  onSaved,
}: ContactFormProps) {
  const supabase = createClient();
  const isEdit = !!contact;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [saving, setSaving] = useState(false);

  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [showNewTagInput, setShowNewTagInput] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);

  useEffect(() => {
    if (open) {
      setName(contact?.name ?? '');
      setPhone(contact?.phone ?? '');
      setEmail(contact?.email ?? '');
      setCompany(contact?.company ?? '');
      setSelectedTagIds(contactTags.map((ct) => ct.tag_id));
      setShowNewTagInput(false);
      setNewTagName('');
      fetchTags();
    }
  }, [open, contact]);

  async function fetchTags() {
    setLoadingTags(true);
    const { data } = await supabase
      .from('tags')
      .select('*')
      .order('name');
    if (data) setTags(data);
    setLoadingTags(false);
  }

  async function handleQuickCreateTag() {
    if (!newTagName.trim()) return;
    try {
      setCreatingTag(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!profile?.account_id) {
        toast.error('Account profile not found');
        return;
      }

      const { data: createdTag, error } = await supabase
        .from('tags')
        .insert({
          user_id: user.id,
          account_id: profile.account_id,
          name: newTagName.trim(),
          color: '#10b981',
        })
        .select('*')
        .single();

      if (error) throw error;

      setTags((prev) => [...prev, createdTag]);
      setSelectedTagIds((prev) => [...prev, createdTag.id]);
      setNewTagName('');
      setShowNewTagInput(false);
      toast.success(`Tag "${createdTag.name}" created and selected`);
    } catch (err) {
      console.error('Failed to create tag:', err);
      toast.error('Failed to create tag');
    } finally {
      setCreatingTag(false);
    }
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const phoneCheck = validateAndFormatWhatsAppPhone(phone);
    if (!phoneCheck.isValid) {
      toast.error(phoneCheck.error || 'സാധുവായ ഒരു WhatsApp നമ്പർ നൽകുക (ഉദാ: +91 98765 43210 അല്ലെങ്കിൽ 9876543210)');
      return;
    }

    const validPhone = phoneCheck.phone;
    const sanitizedDigits = phoneCheck.sanitized;

    setSaving(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle();

      const accountId = profile?.account_id;

      // Look up if any contact in this account already has this phone number
      let dupQuery = supabase
        .from('contacts')
        .select('id, name, phone')
        .or(`phone.eq.${validPhone},phone.eq.${sanitizedDigits}`);

      if (accountId) {
        dupQuery = dupQuery.eq('account_id', accountId);
      }

      const { data: existingMatches } = await dupQuery;

      if (isEdit && contact?.id) {
        // If editing, check that the phone is not taken by ANOTHER contact
        const otherMatch = existingMatches?.find((c) => c.id !== contact.id);
        if (otherMatch) {
          toast.error(`മറ്റൊരു കോൺടാക്റ്റിൽ ഈ WhatsApp നമ്പർ നിലവിലുണ്ട് (${otherMatch.name || validPhone})`);
          setSaving(false);
          return;
        }

        const { error } = await supabase
          .from('contacts')
          .update({
            name: name.trim() || null,
            phone: validPhone,
            email: email.trim() || null,
            company: company.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', contact.id);
        if (error) throw error;

        // Sync tags
        await supabase.from('contact_tags').delete().eq('contact_id', contact.id);
        if (selectedTagIds.length > 0) {
          const tagRows = selectedTagIds.map((tag_id) => ({
            contact_id: contact.id,
            tag_id,
          }));
          const { error: tagError } = await supabase.from('contact_tags').insert(tagRows);
          if (tagError) throw tagError;
        }

        toast.success('Contact updated');
      } else {
        // Creating a new contact
        const existing = existingMatches?.[0];
        if (existing) {
          // Contact with this phone already exists! Update details and MERGE tags so no duplicate is created.
          await supabase
            .from('contacts')
            .update({
              name: name.trim() || existing.name,
              email: email.trim() || null,
              company: company.trim() || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);

          if (selectedTagIds.length > 0) {
            const { data: currentTags } = await supabase
              .from('contact_tags')
              .select('tag_id')
              .eq('contact_id', existing.id);
            const currentTagSet = new Set((currentTags ?? []).map((t) => t.tag_id));
            const newTagsToAdd = selectedTagIds
              .filter((tid) => !currentTagSet.has(tid))
              .map((tag_id) => ({
                contact_id: existing.id,
                tag_id,
              }));
            if (newTagsToAdd.length > 0) {
              await supabase.from('contact_tags').insert(newTagsToAdd);
            }
          }

          toast.success(`കോൺടാക്റ്റ് നിലവിലുണ്ട്. പുതിയ ടാഗുകൾ ചേർത്തു (${existing.name || validPhone})`);
        } else {
          // Brand new contact
          const { data: newC, error } = await supabase
            .from('contacts')
            .insert({
              user_id: user.id,
              account_id: accountId,
              name: name.trim() || null,
              phone: validPhone,
              email: email.trim() || null,
              company: company.trim() || null,
            })
            .select('id')
            .single();
          if (error) throw error;

          if (selectedTagIds.length > 0 && newC?.id) {
            const tagRows = selectedTagIds.map((tag_id) => ({
              contact_id: newC.id,
              tag_id,
            }));
            await supabase.from('contact_tags').insert(tagRows);
          }

          toast.success('Contact created');
        }
      }

      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save contact';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isEdit ? 'Edit Contact' : 'Add Contact'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {isEdit
              ? 'Update the contact details below.'
              : 'Fill in the details to create a new contact.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cf-name" className="text-slate-300">
              Name
            </Label>
            <Input
              id="cf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-phone" className="text-slate-300">
              WhatsApp Phone <span className="text-red-400">*</span>
            </Label>
            <Input
              id="cf-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210 or 9876543210"
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
            <p className="text-xs text-slate-500">
              Valid WhatsApp number with country code (e.g. +91 98765 43210 or 9876543210)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-email" className="text-slate-300">
              Email
            </Label>
            <Input
              id="cf-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-company" className="text-slate-300">
              Company
            </Label>
            <Input
              id="cf-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme Inc."
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-slate-300">Tags</Label>
              {!showNewTagInput && (
                <button
                  type="button"
                  onClick={() => setShowNewTagInput(true)}
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Plus className="size-3" />
                  New Tag
                </button>
              )}
            </div>

            {showNewTagInput && (
              <div className="flex items-center gap-2 pt-1 pb-1">
                <Input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="New tag name (e.g. Lead)"
                  className="h-8 text-xs bg-slate-800 border-slate-600 text-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleQuickCreateTag();
                    }
                  }}
                />
                <Button
                  size="sm"
                  type="button"
                  disabled={creatingTag || !newTagName.trim()}
                  onClick={handleQuickCreateTag}
                  className="h-8 px-2.5 text-xs bg-primary text-primary-foreground"
                >
                  {creatingTag ? <Loader2 className="size-3 animate-spin" /> : 'Add'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setShowNewTagInput(false);
                    setNewTagName('');
                  }}
                  className="h-8 px-2 text-xs text-slate-400"
                >
                  Cancel
                </Button>
              </div>
            )}

            {loadingTags ? (
              <div className="flex items-center gap-2 text-slate-500 text-sm">
                <Loader2 className="size-3 animate-spin" />
                Loading tags...
              </div>
            ) : tags.length === 0 && !showNewTagInput ? (
              <p className="text-xs text-slate-500">
                No tags available yet. Click &quot;+ New Tag&quot; above to create one.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {tags.map((tag) => {
                  const selected = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                        selected
                          ? 'ring-2 ring-primary ring-offset-1 ring-offset-slate-900'
                          : 'opacity-60 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor: tag.color + '20',
                        color: tag.color,
                        borderColor: tag.color,
                      }}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
