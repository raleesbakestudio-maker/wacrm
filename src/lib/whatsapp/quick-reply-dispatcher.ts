import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  sendTextMessage,
  sendMediaMessage,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import type { QuickReply } from '@/types'

export interface QuickReplyDispatchInput {
  accountId: string
  phoneNumberId: string
  accessToken: string
  toPhone: string
  inboundText: string
  conversationId: string
}

/**
 * Checks if incoming text matches any active Quick Reply keyword or shortcut.
 * If matched, sends the response (with voice, brochure, or QR image) and logs
 * the sent message to the database.
 */
export async function matchAndSendQuickReply(
  input: QuickReplyDispatchInput
): Promise<boolean> {
  const clean = input.inboundText.trim().toLowerCase()
  if (!clean) return false

  const { data: replies, error } = await supabaseAdmin()
    .from('quick_replies')
    .select('*')
    .eq('account_id', input.accountId)
    .eq('is_active', true)

  if (error || !replies || replies.length === 0) return false

  // Find match: either exact shortcut or in auto_keywords
  const match = (replies as QuickReply[]).find((r) => {
    const s = r.shortcut.toLowerCase().replace(/^\//, '')
    if (clean === s || clean === `/${s}`) return true
    if (r.auto_keywords && Array.isArray(r.auto_keywords)) {
      return r.auto_keywords.some(
        (k: string) => k.toLowerCase() === clean
      )
    }
    return false
  })

  if (!match) return false

  try {
    const hasMedia = match.media_url && match.media_type && match.media_type !== 'none'

    if (hasMedia) {
      const kind = match.media_type as MediaKind

      if (kind === 'audio') {
        // Send Voice Note / Audio
        const audioRes = await sendMediaMessage({
          phoneNumberId: input.phoneNumberId,
          accessToken: input.accessToken,
          to: input.toPhone,
          kind: 'audio',
          link: match.media_url!,
        })

        await supabaseAdmin().from('messages').insert({
          conversation_id: input.conversationId,
          sender_type: 'bot',
          content_type: 'audio',
          media_url: match.media_url,
          message_id: audioRes.messageId,
          status: 'sent',
        })

        // Send accompanying text explanation if present
        if (match.message?.trim()) {
          const textRes = await sendTextMessage({
            phoneNumberId: input.phoneNumberId,
            accessToken: input.accessToken,
            to: input.toPhone,
            text: match.message.trim(),
          })

          await supabaseAdmin().from('messages').insert({
            conversation_id: input.conversationId,
            sender_type: 'bot',
            content_type: 'text',
            content_text: match.message.trim(),
            message_id: textRes.messageId,
            status: 'sent',
          })
        }
      } else {
        // Image or Document (PDF) with caption
        const mediaRes = await sendMediaMessage({
          phoneNumberId: input.phoneNumberId,
          accessToken: input.accessToken,
          to: input.toPhone,
          kind,
          link: match.media_url!,
          caption: match.message || undefined,
          filename: match.media_filename || undefined,
        })

        await supabaseAdmin().from('messages').insert({
          conversation_id: input.conversationId,
          sender_type: 'bot',
          content_type: kind,
          content_text: match.message || null,
          media_url: match.media_url,
          message_id: mediaRes.messageId,
          status: 'sent',
        })
      }
    } else {
      // Plain text response
      const textRes = await sendTextMessage({
        phoneNumberId: input.phoneNumberId,
        accessToken: input.accessToken,
        to: input.toPhone,
        text: match.message,
      })

      await supabaseAdmin().from('messages').insert({
        conversation_id: input.conversationId,
        sender_type: 'bot',
        content_type: 'text',
        content_text: match.message,
        message_id: textRes.messageId,
        status: 'sent',
      })
    }

    // Update conversation's last message
    await supabaseAdmin()
      .from('conversations')
      .update({
        last_message_text: match.message || `[${match.media_type}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.conversationId)

    return true
  } catch (err) {
    console.error('[matchAndSendQuickReply] Error dispatching quick reply:', err)
    return false
  }
}
