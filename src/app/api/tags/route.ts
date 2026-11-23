import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

async function requireUser(): Promise<
  | { ok: true; userId: string; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; status: number; body: { error: string } }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } };
  }
  return { ok: true, userId: user.id, supabase };
}

/**
 * GET /api/tags — returns all tags belonging to the caller's account.
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status });
  }
  const { userId } = guard;
  const admin = supabaseAdmin();

  const { data: profile } = await admin
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();

  const accountId = profile?.account_id;

  let query = admin.from('tags').select('*').order('name', { ascending: true });
  if (accountId) {
    query = query.eq('account_id', accountId);
  } else {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tags: data ?? [] });
}

/**
 * POST /api/tags — creates or resolves a tag in the caller's account.
 * Body: { name: string, color?: string }
 */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status });
  }
  const { userId } = guard;

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    color?: string;
  } | null;

  if (!body?.name || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
  }

  const trimmedName = body.name.trim();
  const color = body.color?.trim() || '#10b981';
  const admin = supabaseAdmin();

  const { data: profile } = await admin
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();

  const accountId = profile?.account_id;
  if (!accountId) {
    return NextResponse.json({ error: 'Account profile not found' }, { status: 400 });
  }

  // Check if tag with same name already exists in this account (case-insensitive)
  const { data: existing } = await admin
    .from('tags')
    .select('*')
    .eq('account_id', accountId)
    .ilike('name', trimmedName)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ tag: existing, created: false }, { status: 200 });
  }

  const { data: created, error } = await admin
    .from('tags')
    .insert({
      user_id: userId,
      account_id: accountId,
      name: trimmedName,
      color,
    })
    .select('*')
    .single();

  if (error || !created) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to create tag' },
      { status: 500 },
    );
  }

  return NextResponse.json({ tag: created, created: true }, { status: 201 });
}
