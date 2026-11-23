'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  Plus,
  Upload,
  Download,
  Filter,
  ArrowUpDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  Tag as TagIcon,
  X,
  Building2,
  Mail,
  Phone,
  Check,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { TagManager } from '@/components/settings/tag-manager';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { cn } from '@/lib/utils';

interface ContactWithTags extends Contact {
  tags?: Tag[];
}

export default function ContactsPage() {
  const supabase = createClient();
  const canEdit = useCan('send-messages');

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);

  // Filters & Sorting
  const [selectedTagId, setSelectedTagId] = useState<string>('all');
  const [attributeFilter, setAttributeFilter] = useState<
    'all' | 'has_email' | 'has_company' | 'has_tags' | 'untagged'
  >('all');
  const [sortOption, setSortOption] = useState<'newest' | 'oldest' | 'name_asc'>('newest');
  const [exporting, setExporting] = useState(false);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // All tags for display
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*').order('name');
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      setTagsMap(map);
    }
  }, [supabase]);

  const fetchContacts = useCallback(async () => {
    setLoading(true);

    const from = page * pageSize;
    const to = from + pageSize - 1;

    let orderField = 'created_at';
    let ascending = false;
    if (sortOption === 'oldest') {
      ascending = true;
    } else if (sortOption === 'name_asc') {
      orderField = 'name';
      ascending = true;
    }

    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .order(orderField, { ascending, nullsFirst: false })
      .range(from, to);

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term},company.ilike.${term}`);
    }

    // Filter by specific tag
    if (selectedTagId !== 'all') {
      const { data: ctRows } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .eq('tag_id', selectedTagId);
      const taggedContactIds = ctRows?.map((r) => r.contact_id) ?? [];
      if (taggedContactIds.length === 0) {
        setTotalCount(0);
        setContacts([]);
        setLoading(false);
        return;
      }
      query = query.in('id', taggedContactIds);
    } else if (attributeFilter === 'has_tags' || attributeFilter === 'untagged') {
      const { data: allCt } = await supabase.from('contact_tags').select('contact_id');
      const allTaggedIds = Array.from(new Set(allCt?.map((r) => r.contact_id) ?? []));
      if (attributeFilter === 'has_tags') {
        if (allTaggedIds.length === 0) {
          setTotalCount(0);
          setContacts([]);
          setLoading(false);
          return;
        }
        query = query.in('id', allTaggedIds);
      } else if (attributeFilter === 'untagged' && allTaggedIds.length > 0) {
        query = query.not('id', 'in', `(${allTaggedIds.join(',')})`);
      }
    }

    // Attribute filters
    if (attributeFilter === 'has_email') {
      query = query.not('email', 'is', null).neq('email', '');
    } else if (attributeFilter === 'has_company') {
      query = query.not('company', 'is', null).neq('company', '');
    }

    const { data, count, error } = await query;

    if (error) {
      toast.error('Failed to load contacts');
      setLoading(false);
      return;
    }

    setTotalCount(count ?? 0);

    if (!data || data.length === 0) {
      setContacts([]);
      setLoading(false);
      return;
    }

    // Fetch tags for these contacts
    const contactIds = data.map((c) => c.id);
    const { data: contactTags } = await supabase
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in('contact_id', contactIds);

    const tagsByContact: Record<string, string[]> = {};
    contactTags?.forEach((ct) => {
      if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
      tagsByContact[ct.contact_id].push(ct.tag_id);
    });

    const enriched: ContactWithTags[] = data.map((c) => ({
      ...c,
      tags: (tagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
    }));

    setContacts(enriched);
    setLoading(false);
  }, [supabase, page, pageSize, search, selectedTagId, attributeFilter, sortOption, tagsMap]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  async function openEditForm(contact: Contact) {
    const { data } = await supabase
      .from('contact_tags')
      .select('*')
      .eq('contact_id', contact.id);
    setEditContact(contact);
    setEditContactTags(data ?? []);
    setFormOpen(true);
  }

  function openDetail(contactId: string) {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error('Failed to delete contact');
    } else {
      toast.success('Contact deleted');
      fetchContacts();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  // Client-side lightweight CSV Export
  async function handleExportCSV() {
    try {
      setExporting(true);
      toast.loading('Preparing CSV export...', { id: 'export-csv' });

      let orderField = 'created_at';
      let ascending = false;
      if (sortOption === 'oldest') {
        ascending = true;
      } else if (sortOption === 'name_asc') {
        orderField = 'name';
        ascending = true;
      }

      let query = supabase
        .from('contacts')
        .select('id, name, phone, email, company, created_at')
        .order(orderField, { ascending, nullsFirst: false })
        .limit(5000);

      if (search.trim()) {
        const term = `%${search.trim()}%`;
        query = query.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term},company.ilike.${term}`);
      }

      if (selectedTagId !== 'all') {
        const { data: ctRows } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .eq('tag_id', selectedTagId);
        const taggedContactIds = ctRows?.map((r) => r.contact_id) ?? [];
        if (taggedContactIds.length === 0) {
          toast.dismiss('export-csv');
          toast.error('No contacts to export');
          setExporting(false);
          return;
        }
        query = query.in('id', taggedContactIds);
      } else if (attributeFilter === 'has_tags' || attributeFilter === 'untagged') {
        const { data: allCt } = await supabase.from('contact_tags').select('contact_id');
        const allTaggedIds = Array.from(new Set(allCt?.map((r) => r.contact_id) ?? []));
        if (attributeFilter === 'has_tags') {
          if (allTaggedIds.length === 0) {
            toast.dismiss('export-csv');
            toast.error('No contacts to export');
            setExporting(false);
            return;
          }
          query = query.in('id', allTaggedIds);
        } else if (attributeFilter === 'untagged' && allTaggedIds.length > 0) {
          query = query.not('id', 'in', `(${allTaggedIds.join(',')})`);
        }
      }

      if (attributeFilter === 'has_email') {
        query = query.not('email', 'is', null).neq('email', '');
      } else if (attributeFilter === 'has_company') {
        query = query.not('company', 'is', null).neq('company', '');
      }

      const { data: exportData, error } = await query;
      if (error || !exportData || exportData.length === 0) {
        toast.dismiss('export-csv');
        toast.error('No contacts found to export');
        setExporting(false);
        return;
      }

      // Fetch tags for exportData
      const contactIds = exportData.map((c) => c.id);
      const { data: contactTags } = await supabase
        .from('contact_tags')
        .select('contact_id, tag_id')
        .in('contact_id', contactIds);

      const tagsByContact: Record<string, string[]> = {};
      contactTags?.forEach((ct) => {
        if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
        const tName = tagsMap[ct.tag_id]?.name;
        if (tName) tagsByContact[ct.contact_id].push(tName);
      });

      const headers = ['Name', 'Phone', 'Email', 'Company', 'Tags', 'Created Date'];
      const rows = exportData.map((c) => {
        const cTags = tagsByContact[c.id]?.join('; ') ?? '';
        return [
          `"${(c.name || '').replace(/"/g, '""')}"`,
          `"${(c.phone || '').replace(/"/g, '""')}"`,
          `"${(c.email || '').replace(/"/g, '""')}"`,
          `"${(c.company || '').replace(/"/g, '""')}"`,
          `"${cTags.replace(/"/g, '""')}"`,
          `"${new Date(c.created_at).toISOString().split('T')[0]}"`,
        ].join(',');
      });

      const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateStr = new Date().toISOString().split('T')[0];
      link.setAttribute('download', `raleesbake-contacts-${dateStr}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.dismiss('export-csv');
      toast.success(`Exported ${exportData.length} contacts successfully!`);
    } catch (err) {
      console.error('Export error:', err);
      toast.dismiss('export-csv');
      toast.error('Failed to export contacts');
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.ceil(totalCount / pageSize);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;
  const allTagList = Object.values(tagsMap);

  const hasActiveFilters =
    search.trim() !== '' ||
    selectedTagId !== 'all' ||
    attributeFilter !== 'all' ||
    sortOption !== 'newest';

  const resetFilters = () => {
    setSearch('');
    setSelectedTagId('all');
    setAttributeFilter('all');
    setSortOption('newest');
    setPage(0);
  };

  const selectedTagName =
    selectedTagId === 'all'
      ? 'All Tags'
      : tagsMap[selectedTagId]?.name ?? 'Selected Tag';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Contacts</h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Manage your contact list. {totalCount > 0 && `${totalCount} total contacts.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Export CSV Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={exporting || loading || totalCount === 0}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs sm:text-sm h-8 sm:h-9"
            title="Export contacts as CSV"
          >
            {exporting ? (
              <Loader2 className="size-3.5 sm:size-4 animate-spin text-primary" />
            ) : (
              <Download className="size-3.5 sm:size-4 text-emerald-400" />
            )}
            <span className="ml-1.5">Export</span>
          </Button>

          {/* Tags Manager Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTagManagerOpen(true)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs sm:text-sm h-8 sm:h-9"
          >
            <TagIcon className="size-3.5 sm:size-4" />
            <span className="ml-1.5 hidden xs:inline">Tags</span>
          </Button>

          {/* Import Contacts */}
          <GatedButton
            variant="outline"
            size="sm"
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={() => setImportOpen(true)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs sm:text-sm h-8 sm:h-9"
          >
            <Upload className="size-3.5 sm:size-4" />
            <span className="ml-1.5 hidden xs:inline">Import</span>
          </GatedButton>

          {/* Add Contact */}
          <GatedButton
            size="sm"
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={openAddForm}
            className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs sm:text-sm h-8 sm:h-9"
          >
            <Plus className="size-3.5 sm:size-4" />
            <span className="ml-1">Add Contact</span>
          </GatedButton>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search name, phone, email..."
            className="pl-8 pr-8 bg-slate-900 border-slate-700 text-white placeholder:text-slate-500 text-xs sm:text-sm h-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setPage(0);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Tag Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors h-9',
                selectedTagId !== 'all'
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              )}
            >
              <TagIcon className="size-3.5" />
              <span className="truncate max-w-[120px]">{selectedTagName}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-slate-900 border-slate-700 max-h-60 overflow-y-auto w-48">
              <DropdownMenuItem
                onClick={() => {
                  setSelectedTagId('all');
                  setPage(0);
                }}
                className={cn('text-xs', selectedTagId === 'all' && 'text-primary font-medium')}
              >
                All Tags
                {selectedTagId === 'all' && <Check className="ml-auto size-3" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-slate-800" />
              {allTagList.length === 0 ? (
                <div className="p-2 text-xs text-slate-500 text-center">No tags created</div>
              ) : (
                allTagList.map((tag) => (
                  <DropdownMenuItem
                    key={tag.id}
                    onClick={() => {
                      setSelectedTagId(tag.id);
                      setPage(0);
                    }}
                    className="text-xs flex items-center gap-2"
                  >
                    <span
                      className="size-2 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate flex-1">{tag.name}</span>
                    {selectedTagId === tag.id && <Check className="ml-auto size-3 text-primary" />}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Attribute Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors h-9',
                attributeFilter !== 'all'
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              )}
            >
              <Filter className="size-3.5" />
              <span className="capitalize">
                {attributeFilter === 'all'
                  ? 'All Contacts'
                  : attributeFilter === 'has_email'
                  ? 'Has Email'
                  : attributeFilter === 'has_company'
                  ? 'Has Company'
                  : attributeFilter === 'has_tags'
                  ? 'Tagged'
                  : 'Untagged'}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-slate-900 border-slate-700 w-44">
              <DropdownMenuItem
                onClick={() => {
                  setAttributeFilter('all');
                  setPage(0);
                }}
                className={cn('text-xs', attributeFilter === 'all' && 'text-primary font-medium')}
              >
                All Contacts
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setAttributeFilter('has_email');
                  setPage(0);
                }}
                className={cn('text-xs', attributeFilter === 'has_email' && 'text-primary font-medium')}
              >
                Has Email
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setAttributeFilter('has_company');
                  setPage(0);
                }}
                className={cn('text-xs', attributeFilter === 'has_company' && 'text-primary font-medium')}
              >
                Has Company
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setAttributeFilter('has_tags');
                  setPage(0);
                }}
                className={cn('text-xs', attributeFilter === 'has_tags' && 'text-primary font-medium')}
              >
                Tagged Only
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setAttributeFilter('untagged');
                  setPage(0);
                }}
                className={cn('text-xs', attributeFilter === 'untagged' && 'text-primary font-medium')}
              >
                Untagged Only
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sort Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 h-9">
              <ArrowUpDown className="size-3.5" />
              <span>
                {sortOption === 'newest'
                  ? 'Newest'
                  : sortOption === 'oldest'
                  ? 'Oldest'
                  : 'Name A-Z'}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-slate-900 border-slate-700 w-36">
              <DropdownMenuItem
                onClick={() => {
                  setSortOption('newest');
                  setPage(0);
                }}
                className={cn('text-xs', sortOption === 'newest' && 'text-primary font-medium')}
              >
                Newest First
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setSortOption('oldest');
                  setPage(0);
                }}
                className={cn('text-xs', sortOption === 'oldest' && 'text-primary font-medium')}
              >
                Oldest First
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setSortOption('name_asc');
                  setPage(0);
                }}
                className={cn('text-xs', sortOption === 'name_asc' && 'text-primary font-medium')}
              >
                Name A-Z
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Clear Filter Button */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="text-xs text-slate-400 hover:text-white h-9 px-2"
              title="Reset all filters"
            >
              <X className="size-3.5 mr-1" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* DESKTOP TABLE VIEW (md+) */}
      <div className="hidden md:block rounded-xl border border-slate-800 overflow-hidden bg-slate-900/40">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead className="text-slate-400">Name</TableHead>
              <TableHead className="text-slate-400">Phone</TableHead>
              <TableHead className="text-slate-400">Email</TableHead>
              <TableHead className="text-slate-400 hidden lg:table-cell">Company</TableHead>
              <TableHead className="text-slate-400">Tags</TableHead>
              <TableHead className="text-slate-400 hidden lg:table-cell">Created</TableHead>
              <TableHead className="text-slate-400 w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-slate-800">
                <TableCell colSpan={7} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-slate-500">Loading contacts...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : contacts.length === 0 ? (
              <TableRow className="border-slate-800">
                <TableCell colSpan={7} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="size-8 text-slate-600" />
                    <p className="text-sm text-slate-400">
                      {hasActiveFilters
                        ? 'No contacts match your filters.'
                        : 'No contacts yet.'}
                    </p>
                    {hasActiveFilters ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={resetFilters}
                        className="mt-2 border-slate-700 text-slate-300 hover:bg-slate-800 text-xs"
                      >
                        Clear Filters
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={openAddForm}
                        className="mt-2 border-slate-700 text-slate-300 hover:bg-slate-800"
                      >
                        <Plus className="size-3.5" />
                        Add your first contact
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  className="border-slate-800 hover:bg-slate-900/70 cursor-pointer transition-colors"
                  onClick={() => openDetail(contact.id)}
                >
                  <TableCell className="text-white font-medium">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-7 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-primary shrink-0">
                        {(contact.name || contact.phone || 'U').charAt(0).toUpperCase()}
                      </div>
                      <span className="truncate max-w-[180px]">
                        {contact.name || <span className="text-slate-500 italic">Unnamed</span>}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-300 font-mono text-xs">
                    {contact.phone}
                  </TableCell>
                  <TableCell className="text-slate-400 text-sm">
                    {contact.email || <span className="text-slate-600">-</span>}
                  </TableCell>
                  <TableCell className="text-slate-400 hidden lg:table-cell text-sm">
                    {contact.company || <span className="text-slate-600">-</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                      {contact.tags && contact.tags.length > 0 ? (
                        contact.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-600 text-xs">-</span>
                      )}
                      {contact.tags && contact.tags.length > 3 && (
                        <span className="text-[10px] text-slate-500 self-center">
                          +{contact.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-500 text-xs hidden lg:table-cell">
                    {new Date(contact.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-slate-400 hover:text-white"
                            onClick={(e) => e.stopPropagation()}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-slate-900 border-slate-700">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForm(contact);
                          }}
                          className="text-slate-300 focus:bg-slate-800 focus:text-white text-xs"
                        >
                          <Pencil className="size-3.5 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-slate-700" />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(contact);
                          }}
                          className="text-xs"
                        >
                          <Trash2 className="size-3.5 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* MOBILE CARD VIEW (< md) */}
      <div className="md:hidden space-y-2.5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-slate-800 bg-slate-900/40">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm text-slate-500 mt-2">Loading contacts...</p>
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-slate-800 bg-slate-900/40 text-center px-4">
            <Users className="size-8 text-slate-600 mb-2" />
            <p className="text-sm text-slate-400">
              {hasActiveFilters
                ? 'No contacts match your filters.'
                : 'No contacts yet.'}
            </p>
            {hasActiveFilters ? (
              <Button
                variant="outline"
                size="sm"
                onClick={resetFilters}
                className="mt-3 border-slate-700 text-slate-300 hover:bg-slate-800 text-xs"
              >
                Clear Filters
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={openAddForm}
                className="mt-3 border-slate-700 text-slate-300 hover:bg-slate-800 text-xs"
              >
                <Plus className="size-3.5 mr-1" />
                Add contact
              </Button>
            )}
          </div>
        ) : (
          contacts.map((contact) => (
            <div
              key={contact.id}
              onClick={() => openDetail(contact.id)}
              className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 space-y-2.5 transition-all active:scale-[0.99] cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-primary">
                    {(contact.name || contact.phone || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">
                      {contact.name || <span className="text-slate-500 italic">Unnamed</span>}
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono mt-0.5">
                      <Phone className="size-3 text-slate-500 shrink-0" />
                      <span className="truncate">{contact.phone}</span>
                    </div>
                  </div>
                </div>

                {/* 3-dots actions menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-slate-400 hover:text-white shrink-0 size-8"
                        onClick={(e) => e.stopPropagation()}
                      />
                    }
                  >
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-slate-900 border-slate-700">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditForm(contact);
                      }}
                      className="text-slate-300 focus:bg-slate-800 focus:text-white text-xs"
                    >
                      <Pencil className="size-3.5 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-slate-700" />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(contact);
                      }}
                      className="text-xs"
                    >
                      <Trash2 className="size-3.5 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Tags Row */}
              {contact.tags && contact.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {contact.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: tag.color + '20',
                        color: tag.color,
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                  {contact.tags.length > 3 && (
                    <span className="text-[10px] text-slate-500 self-center">
                      +{contact.tags.length - 3}
                    </span>
                  )}
                </div>
              )}

              {/* Details Row: Email and Company */}
              {(contact.email || contact.company) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 pt-1.5 border-t border-slate-800/80">
                  {contact.email && (
                    <div className="flex items-center gap-1 truncate max-w-[180px]">
                      <Mail className="size-3 text-slate-500 shrink-0" />
                      <span className="truncate">{contact.email}</span>
                    </div>
                  )}
                  {contact.company && (
                    <div className="flex items-center gap-1 truncate max-w-[140px]">
                      <Building2 className="size-3 text-slate-500 shrink-0" />
                      <span className="truncate">{contact.company}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Pagination Controls */}
      {totalCount > 0 && (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between pt-2">
          <div className="flex items-center justify-between sm:justify-start gap-3">
            <p className="text-xs text-slate-400">
              Showing <span className="font-medium text-white">{page * pageSize + 1}</span>-
              <span className="font-medium text-white">
                {Math.min((page + 1) * pageSize, totalCount)}
              </span>{' '}
              of <span className="font-medium text-white">{totalCount}</span>
            </p>

            {/* Page Size Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white border border-slate-800 rounded px-2 py-0.5">
                <span>{pageSize} / page</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-slate-900 border-slate-700 w-24">
                {[25, 50, 100].map((sz) => (
                  <DropdownMenuItem
                    key={sz}
                    onClick={() => {
                      setPageSize(sz);
                      setPage(0);
                    }}
                    className={cn('text-xs', pageSize === sz && 'text-primary font-medium')}
                  >
                    {sz} rows
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between sm:justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPrev}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs h-8 px-2.5 disabled:opacity-30"
              >
                <ChevronLeft className="size-3.5 mr-1" />
                Prev
              </Button>
              <span className="text-xs text-slate-400 px-2 font-mono">
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={() => setPage((p) => p + 1)}
                className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs h-8 px-2.5 disabled:opacity-30"
              >
                Next
                <ChevronRight className="size-3.5 ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          fetchContacts();
          fetchTags();
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        onUpdated={fetchContacts}
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          fetchContacts();
          fetchTags();
        }}
      />

      {/* Tag Manager Modal */}
      <Dialog
        open={tagManagerOpen}
        onOpenChange={(open) => {
          setTagManagerOpen(open);
          if (!open) {
            fetchTags();
            fetchContacts();
          }
        }}
      >
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Manage Tags</DialogTitle>
            <DialogDescription className="text-slate-400">
              Create and manage tags to organize your contacts and broadcast audiences.
            </DialogDescription>
          </DialogHeader>
          <TagManager
            onTagsChanged={() => {
              fetchTags();
              fetchContacts();
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Contact</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete{' '}
              <span className="text-slate-200 font-medium">
                {deleteTarget?.name || deleteTarget?.phone}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
