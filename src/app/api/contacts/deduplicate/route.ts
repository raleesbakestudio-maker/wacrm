import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = supabaseAdmin();

    // Verify user's profile and account membership
    const { data: profile } = await admin
      .from('profiles')
      .select('account_id, role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Optional phone filter from request body
    let targetPhone: string | null = null;
    try {
      const body = await request.json();
      if (body?.phone) {
        targetPhone = sanitizePhoneForMeta(body.phone);
      }
    } catch {
      // No JSON body provided, run for all duplicates
    }

    // Fetch contacts scoped strictly to this account
    let query = admin
      .from('contacts')
      .select('id, user_id, account_id, phone, name, created_at')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: true });

    const { data: contacts, error: fetchErr } = await query;
    if (fetchErr || !contacts) {
      return NextResponse.json({ error: fetchErr?.message || 'Failed to fetch contacts' }, { status: 500 });
    }

    // Group contacts by account_id + clean phone (digits only)
    const groups = new Map<string, typeof contacts>();
    for (const c of contacts) {
      const clean = sanitizePhoneForMeta(c.phone);
      if (!clean) continue;
      if (targetPhone && !clean.includes(targetPhone) && !targetPhone.includes(clean)) {
        continue;
      }
      const key = `${c.account_id || c.user_id}:${clean}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(c);
    }

    const mergeResults = [];

    for (const [key, group] of groups.entries()) {
      if (group.length <= 1) continue;

      // Group has duplicates!
      // Primary contact is the earliest or the one with existing conversation/messages
      const primary = group[0];
      const duplicates = group.slice(1);

      console.log(`[Deduplicate] Merging ${duplicates.length} duplicate(s) into primary ${primary.id} (${primary.phone} - ${primary.name})`);

      for (const dup of duplicates) {
        // 1. Transfer contact_tags
        const { data: dupTags } = await admin
          .from('contact_tags')
          .select('tag_id')
          .eq('contact_id', dup.id);

        if (dupTags && dupTags.length > 0) {
          const { data: primaryTags } = await admin
            .from('contact_tags')
            .select('tag_id')
            .eq('contact_id', primary.id);

          const primaryTagSet = new Set((primaryTags ?? []).map((t) => t.tag_id));
          const tagsToAdd = dupTags
            .filter((t) => !primaryTagSet.has(t.tag_id))
            .map((t) => ({
              contact_id: primary.id,
              tag_id: t.tag_id,
            }));

          if (tagsToAdd.length > 0) {
            await admin.from('contact_tags').insert(tagsToAdd);
          }
          await admin.from('contact_tags').delete().eq('contact_id', dup.id);
        }

        // 2. Transfer broadcast_recipients
        await admin
          .from('broadcast_recipients')
          .update({ contact_id: primary.id })
          .eq('contact_id', dup.id);

        // 3. Transfer deals
        await admin
          .from('deals')
          .update({ contact_id: primary.id })
          .eq('contact_id', dup.id);

        // 4. Transfer contact_notes
        await admin
          .from('contact_notes')
          .update({ contact_id: primary.id })
          .eq('contact_id', dup.id);

        // 5. Transfer flow_runs
        await admin
          .from('flow_runs')
          .update({ contact_id: primary.id })
          .eq('contact_id', dup.id);

        // 6. Transfer automation logs
        await admin
          .from('automation_logs')
          .update({ contact_id: primary.id })
          .eq('contact_id', dup.id);

        await admin
          .from('automation_pending_executions')
          .update({ contact_id: primary.id })
          .eq('contact_id', dup.id);

        // 7. Transfer conversations & messages
        const { data: primaryConvs } = await admin
          .from('conversations')
          .select('id')
          .eq('contact_id', primary.id);

        const primaryConvId = primaryConvs?.[0]?.id;

        const { data: dupConvs } = await admin
          .from('conversations')
          .select('id')
          .eq('contact_id', dup.id);

        for (const dc of dupConvs ?? []) {
          if (primaryConvId) {
            // Move messages to primary conversation
            await admin
              .from('messages')
              .update({ conversation_id: primaryConvId })
              .eq('conversation_id', dc.id);

            // Delete duplicate conversation
            await admin.from('conversations').delete().eq('id', dc.id);
          } else {
            // Re-assign conversation to primary contact
            await admin
              .from('conversations')
              .update({ contact_id: primary.id })
              .eq('id', dc.id);
          }
        }

        // 8. Delete the duplicate contact
        const { error: delErr } = await admin.from('contacts').delete().eq('id', dup.id);
        if (delErr) {
          console.error(`Failed to delete dup contact ${dup.id}:`, delErr);
        }

        mergeResults.push({
          key,
          primaryId: primary.id,
          duplicateId: dup.id,
          phone: primary.phone,
        });
      }
    }

    return NextResponse.json({
      success: true,
      mergedCount: mergeResults.length,
      details: mergeResults,
    });
  } catch (err) {
    console.error('Deduplicate error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    );
  }
}

// Allow GET for easy invocation
export async function GET(request: Request) {
  return POST(request);
}
