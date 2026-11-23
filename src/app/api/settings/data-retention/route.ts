import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

async function requireAdminUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, status: 401, error: 'Unauthorized' };
  }

  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from('profiles')
    .select('account_id, role')
    .eq('user_id', user.id)
    .maybeSingle();

  // Allow admins and owners to manage retention
  if (!profile || (profile.role !== 'admin' && profile.role !== 'owner')) {
    return { ok: false as const, status: 403, error: 'Admin access required' };
  }

  return { ok: true as const, userId: user.id, accountId: profile.account_id, admin };
}

/**
 * GET /api/settings/data-retention
 * Returns message counts and breakdown by age (30d, 60d, 90d, 180d, 365d).
 */
export async function GET() {
  const guard = await requireAdminUser();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { admin } = guard;
  const now = new Date();

  const getDateStr = (days: number) => {
    const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return d.toISOString();
  };

  try {
    const [
      { count: totalCount },
      { count: older30Count },
      { count: older60Count },
      { count: older90Count },
      { count: older180Count },
      { count: older365Count },
      { count: totalConversations },
    ] = await Promise.all([
      admin.from('messages').select('*', { count: 'exact', head: true }),
      admin.from('messages').select('*', { count: 'exact', head: true }).lt('created_at', getDateStr(30)),
      admin.from('messages').select('*', { count: 'exact', head: true }).lt('created_at', getDateStr(60)),
      admin.from('messages').select('*', { count: 'exact', head: true }).lt('created_at', getDateStr(90)),
      admin.from('messages').select('*', { count: 'exact', head: true }).lt('created_at', getDateStr(180)),
      admin.from('messages').select('*', { count: 'exact', head: true }).lt('created_at', getDateStr(365)),
      admin.from('conversations').select('*', { count: 'exact', head: true }),
    ]);

    return NextResponse.json({
      counts: {
        total: totalCount ?? 0,
        older30: older30Count ?? 0,
        older60: older60Count ?? 0,
        older90: older90Count ?? 0,
        older180: older180Count ?? 0,
        older365: older365Count ?? 0,
        conversations: totalConversations ?? 0,
      },
    });
  } catch (err) {
    console.error('Failed to get data retention stats:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Database error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/settings/data-retention
 * Permanently deletes messages older than specified days.
 * Body: { days: number } (e.g. 30, 60, 90, 180, 365, or 0 for all messages)
 */
export async function POST(request: Request) {
  const guard = await requireAdminUser();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { admin } = guard;
  const body = (await request.json().catch(() => null)) as { days?: number } | null;

  if (body === null || typeof body.days !== 'number' || body.days < 0) {
    return NextResponse.json(
      { error: 'Valid days number is required (0 for all, or 30, 60, 90, 180, 365)' },
      { status: 400 },
    );
  }

  try {
    let deleteQuery = admin.from('messages').delete({ count: 'exact' });

    if (body.days > 0) {
      const cutoffDate = new Date(Date.now() - body.days * 24 * 60 * 60 * 1000).toISOString();
      deleteQuery = deleteQuery.lt('created_at', cutoffDate);
    } else {
      // days === 0 means delete all messages (neq id to empty matches all rows)
      deleteQuery = deleteQuery.neq('id', '00000000-0000-0000-0000-000000000000');
    }

    const { count, error } = await deleteQuery;
    if (error) throw error;

    return NextResponse.json({
      success: true,
      deletedCount: count ?? 0,
      days: body.days,
    });
  } catch (err) {
    console.error('Failed to delete old messages:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Delete operation failed' },
      { status: 500 },
    );
  }
}
