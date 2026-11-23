import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get('days');
    const days = daysParam ? parseInt(daysParam, 10) : 0;

    const admin = supabaseAdmin();
    let query = admin
      .from('messages')
      .select('id, conversation_id, sender_type, content_type, content_text, media_url, status, created_at')
      .order('created_at', { ascending: false })
      .limit(10000);

    if (days > 0) {
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      query = query.lt('created_at', cutoffDate);
    }

    const { data: messages, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Build CSV
    const escapeCsv = (str: string | null | undefined) => {
      if (!str) return '""';
      const clean = String(str).replace(/"/g, '""');
      return `"${clean}"`;
    };

    const header = 'Message ID,Conversation ID,Sender,Type,Status,Created At,Content Text,Media URL\n';
    const rows = (messages || []).map((m) =>
      [
        escapeCsv(m.id),
        escapeCsv(m.conversation_id),
        escapeCsv(m.sender_type),
        escapeCsv(m.content_type),
        escapeCsv(m.status),
        escapeCsv(m.created_at),
        escapeCsv(m.content_text),
        escapeCsv(m.media_url),
      ].join(','),
    );

    const csvContent = header + rows.join('\n');
    const filename = `chat-backup-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('Export CSV error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    );
  }
}
