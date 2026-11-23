import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: conversationId } = await params;
    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation ID required' }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = supabaseAdmin();

    // Delete all messages belonging to this conversation
    const { count, error: delErr } = await admin
      .from('messages')
      .delete({ count: 'exact' })
      .eq('conversation_id', conversationId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    // Reset last_message_text in the conversation
    await admin
      .from('conversations')
      .update({
        last_message_text: null,
        unread_count: 0,
      })
      .eq('id', conversationId);

    return NextResponse.json({
      success: true,
      deletedCount: count ?? 0,
    });
  } catch (err) {
    console.error('Clear chat error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    );
  }
}
