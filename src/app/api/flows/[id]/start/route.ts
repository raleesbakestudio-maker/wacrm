import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { startFlowForConversation } from '@/lib/flows/engine'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const conversationId = body?.conversation_id

    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 }
      )
    }

    // Verify conversation exists and fetch its contact
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id, contact_id, account_id')
      .eq('id', conversationId)
      .maybeSingle()

    if (convErr || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    if (!conversation.contact_id) {
      return NextResponse.json(
        { error: 'Conversation has no linked contact' },
        { status: 400 }
      )
    }

    const result = await startFlowForConversation({
      flowId: id,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
      accountId: conversation.account_id,
      userId: user.id,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || 'Failed to start flow' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      run_id: result.run_id,
    })
  } catch (err) {
    console.error('[api/flows/[id]/start] Error starting flow:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}
