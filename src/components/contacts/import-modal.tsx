'use client';

import { useState, useRef, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Tag } from '@/types';
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
import { Upload, FileText, Loader2, CheckCircle, XCircle, Download, Plus, Tag as TagIcon } from 'lucide-react';

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

interface ParsedRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
}

function parseCSV(text: string): { rows: ParsedRow[]; invalidCount: number } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { rows: [], invalidCount: 0 };

  const headerLine = lines[0];
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase().replace(/["']/g, ''));

  const phoneIdx = headers.indexOf('phone');
  if (phoneIdx === -1) return { rows: [], invalidCount: 0 };

  const nameIdx = headers.indexOf('name');
  const emailIdx = headers.indexOf('email');
  const companyIdx = headers.indexOf('company');

  const rows: ParsedRow[] = [];
  let invalidCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse (handles quoted fields)
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const rawPhone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!rawPhone) continue;

    const phoneCheck = validateAndFormatWhatsAppPhone(rawPhone);
    if (!phoneCheck.isValid) {
      invalidCount++;
      continue;
    }

    rows.push({
      phone: phoneCheck.phone,
      name: nameIdx >= 0 ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined : undefined,
      email: emailIdx >= 0 ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined : undefined,
      company:
        companyIdx >= 0 ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined : undefined,
    });
  }

  return { rows, invalidCount };
}

export function ImportModal({ open, onOpenChange, onImported }: ImportModalProps) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; failed: number } | null>(null);

  // Tags state
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [showNewTagInput, setShowNewTagInput] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);

  useEffect(() => {
    if (open) {
      fetchTags();
    } else {
      setSelectedTagIds([]);
      setShowNewTagInput(false);
      setNewTagName('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function fetchTags() {
    const { data } = await supabase.from('tags').select('*').order('name');
    if (data) setTags(data);
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
      console.error('Quick tag creation failed:', err);
      toast.error('Failed to create tag');
    } finally {
      setCreatingTag(false);
    }
  }

  function reset() {
    setFile(null);
    setParsedRows([]);
    setResult(null);
    setSelectedTagIds([]);
    setShowNewTagInput(false);
    setNewTagName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);

    const text = await selected.text();
    const { rows, invalidCount } = parseCSV(text);

    if (rows.length === 0) {
      toast.error(
        invalidCount > 0
          ? 'CSV-യിലെ ഫോൺ നമ്പറുകൾ സാധുവായ WhatsApp നമ്പറുകളല്ല. (ഉദാ: +91 98765 43210 അല്ലെങ്കിൽ 9876543210)'
          : 'No valid rows found. Ensure CSV has a "phone" column header.'
      );
      setParsedRows([]);
      return;
    }

    if (invalidCount > 0) {
      toast.warning(`${invalidCount} വരികളിൽ സാധുവായ WhatsApp നമ്പർ ഇല്ലാത്തതിനാൽ ഒഴിവാക്കി.`);
    }

    setParsedRows(rows);
  }

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setImporting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');

      let imported = 0;
      let failed = 0;

      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle();

      const accountId = profile?.account_id;

      // Batch process in chunks of 50
      const chunkSize = 50;
      for (let i = 0; i < parsedRows.length; i += chunkSize) {
        const chunk = parsedRows.slice(i, i + chunkSize);

        // Gather phones in this chunk (both formatted with '+' and sanitized digits)
        const chunkPhones = chunk.map((r) => r.phone);
        const chunkSanitized = chunkPhones.map((p) => sanitizePhoneForMeta(p));
        const allSearchPhones = Array.from(new Set([...chunkPhones, ...chunkSanitized]));

        let existingQuery = supabase
          .from('contacts')
          .select('id, phone, name')
          .in('phone', allSearchPhones);

        if (accountId) {
          existingQuery = existingQuery.eq('account_id', accountId);
        }

        const { data: existingRows } = await existingQuery;

        const existingMap = new Map<string, string>();
        for (const row of existingRows ?? []) {
          existingMap.set(sanitizePhoneForMeta(row.phone), row.id);
        }

        for (const row of chunk) {
          const norm = sanitizePhoneForMeta(row.phone);
          const existingContactId = existingMap.get(norm);

          if (existingContactId) {
            // Contact already exists in the system! Do NOT insert duplicate contact.
            imported++;
            if (selectedTagIds.length > 0) {
              const tagRows = selectedTagIds.map((tId) => ({
                contact_id: existingContactId,
                tag_id: tId,
              }));
              await supabase.from('contact_tags').upsert(tagRows, { onConflict: 'contact_id,tag_id' });
            }
          } else {
            // Brand new contact: insert
            const { data: newC, error: insErr } = await supabase
              .from('contacts')
              .insert({
                user_id: user.id,
                account_id: accountId,
                phone: row.phone,
                name: row.name || null,
                email: row.email || null,
                company: row.company || null,
              })
              .select('id')
              .single();

            if (insErr) {
              failed++;
            } else if (newC?.id) {
              imported++;
              existingMap.set(norm, newC.id);
              if (selectedTagIds.length > 0) {
                const tagRows = selectedTagIds.map((tId) => ({
                  contact_id: newC.id,
                  tag_id: tId,
                }));
                await supabase.from('contact_tags').upsert(tagRows, { onConflict: 'contact_id,tag_id' });
              }
            }
          }
        }
      }

      setResult({ imported, failed });
      if (imported > 0) {
        toast.success(`${imported} contact${imported !== 1 ? 's' : ''} processed`);
        onImported();
      }
      if (failed > 0) {
        toast.error(`${failed} contact${failed !== 1 ? 's' : ''} failed to import`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Import failed';
      toast.error(message);
    } finally {
      setImporting(false);
    }
  }

  const preview = parsedRows.slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Import Contacts</DialogTitle>
          <DialogDescription className="text-slate-400">
            Upload a CSV file with a &quot;phone&quot; column (valid WhatsApp numbers required). If a contact exists with other tags, new tags will be linked without duplicate entries.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-700 p-6 cursor-pointer hover:border-primary/50 transition-colors"
          >
            {file ? (
              <>
                <FileText className="size-8 text-primary" />
                <p className="text-sm text-slate-300">{file.name}</p>
                <p className="text-xs text-slate-500">
                  {parsedRows.length} row{parsedRows.length !== 1 ? 's' : ''} detected
                </p>
              </>
            ) : (
              <>
                <Upload className="size-8 text-slate-500" />
                <p className="text-sm text-slate-400">
                  Click to upload CSV file
                </p>
                <p className="text-xs text-slate-500">
                  CSV with &quot;phone&quot; column required
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span>Need the correct format?</span>
            <a
              href="/sample_contacts.csv"
              download="sample_contacts.csv"
              className="inline-flex items-center gap-1.5 text-primary hover:underline font-medium"
            >
              <Download className="size-3.5" />
              Download Sample CSV
            </a>
          </div>

          {/* Tag Selection for Import */}
          <div className="space-y-2 rounded-lg border border-slate-700/60 bg-slate-800/40 p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <TagIcon className="size-3.5 text-primary" />
                Assign Tag to Imported Contacts (Optional)
              </Label>
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
                  placeholder="New tag name (e.g. Batch 2026)"
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

            {tags.length === 0 && !showNewTagInput ? (
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
                      onClick={() =>
                        setSelectedTagIds((prev) =>
                          prev.includes(tag.id)
                            ? prev.filter((id) => id !== tag.id)
                            : [...prev, tag.id]
                        )
                      }
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all cursor-pointer ${
                        selected
                          ? 'ring-2 ring-primary ring-offset-1 ring-offset-slate-900 font-semibold'
                          : 'opacity-60 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor: tag.color + '25',
                        color: tag.color,
                        border: `1px solid ${tag.color}40`,
                      }}
                    >
                      {selected && <CheckCircle className="size-3" />}
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedTagIds.length > 0 && (
              <p className="text-[11px] text-slate-400">
                All imported contacts will be tagged with:{' '}
                <span className="text-primary font-medium">
                  {tags
                    .filter((t) => selectedTagIds.includes(t.id))
                    .map((t) => t.name)
                    .join(', ')}
                </span>
              </p>
            )}
          </div>

          {/* Preview table */}
          {preview.length > 0 && !result && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Preview (first {preview.length} rows)
              </p>
              <div className="rounded-lg border border-slate-700 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800">
                      <th className="px-3 py-1.5 text-left text-slate-400 font-medium">Phone</th>
                      <th className="px-3 py-1.5 text-left text-slate-400 font-medium">Name</th>
                      <th className="px-3 py-1.5 text-left text-slate-400 font-medium">Email</th>
                      <th className="px-3 py-1.5 text-left text-slate-400 font-medium">Company</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t border-slate-700/50">
                        <td className="px-3 py-1.5 text-slate-300">{row.phone}</td>
                        <td className="px-3 py-1.5 text-slate-300">{row.name || '-'}</td>
                        <td className="px-3 py-1.5 text-slate-300">{row.email || '-'}</td>
                        <td className="px-3 py-1.5 text-slate-300">{row.company || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedRows.length > 5 && (
                <p className="text-xs text-slate-500">
                  ...and {parsedRows.length - 5} more rows
                </p>
              )}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="rounded-lg border border-slate-700 p-4 space-y-2">
              <p className="text-sm font-medium text-white">Import Complete</p>
              <div className="flex items-center gap-4">
                {result.imported > 0 && (
                  <div className="flex items-center gap-1.5 text-primary text-sm">
                    <CheckCircle className="size-4" />
                    {result.imported} imported
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-red-400 text-sm">
                    <XCircle className="size-4" />
                    {result.failed} failed
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="bg-slate-900 border-slate-700">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={parsedRows.length === 0 || importing}
              onClick={handleImport}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              Import {parsedRows.length > 0 ? `${parsedRows.length} Contacts` : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
