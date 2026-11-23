import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  sanitizePhoneForMeta,
  phoneVariants,
  isRecipientNotAllowedError,
  isValidE164,
} from '@/lib/whatsapp/phone-utils';
import { renderTemplateBody } from '@/hooks/use-broadcast-sending';

const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request) {
  return handleCron();
}

export async function POST(request: Request) {
  return handleCron();
}

async function handleCron() {
  const admin = supabaseAdmin();
  const now = new Date().toISOString();

  // Find due scheduled broadcasts
  const { data: dueBroadcasts, error } = await admin
    .from('broadcasts')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(5);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!dueBroadcasts || dueBroadcasts.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let processedCount = 0;

  for (const broadcast of dueBroadcasts) {
    // Atomically claim the broadcast
    const { data: claimed } = await admin
      .from('broadcasts')
      .update({ status: 'sending', updated_at: now })
      .eq('id', broadcast.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle();

    if (!claimed) continue;

    try {
      // Fetch WhatsApp config for this account / user
      let configQuery = admin
        .from('whatsapp_config')
        .select('*');

      if (broadcast.account_id) {
        configQuery = configQuery.eq('account_id', broadcast.account_id);
      } else {
        configQuery = configQuery.eq('user_id', broadcast.user_id);
      }

      const { data: config } = await configQuery.maybeSingle();

      if (!config || !config.access_token || !config.phone_number_id) {
        await admin
          .from('broadcasts')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', broadcast.id);
        continue;
      }

      const accessToken = decrypt(config.access_token);

      // Fetch template details
      const { data: templateRow } = await admin
        .from('message_templates')
        .select('*')
        .eq('name', broadcast.template_name)
        .maybeSingle();

      const templateBody = templateRow?.body_text ?? '';

      // Fetch recipients
      const { data: recipients } = await admin
        .from('broadcast_recipients')
        .select('*, contact:contacts(*)')
        .eq('broadcast_id', broadcast.id);

      if (!recipients || recipients.length === 0) {
        await admin
          .from('broadcasts')
          .update({ status: 'sent', updated_at: new Date().toISOString() })
          .eq('id', broadcast.id);
        processedCount++;
        continue;
      }

      const contactIds = recipients
        .map((r) => r.contact?.id)
        .filter((id): id is string => Boolean(id));

      // Pre-resolve conversations for Inbox Chat Sync
      const convMap = new Map<string, string>();
      if (broadcast.account_id && contactIds.length > 0) {
        const { data: existingConvs } = await admin
          .from('conversations')
          .select('id, contact_id')
          .eq('account_id', broadcast.account_id)
          .in('contact_id', contactIds);

        for (const c of existingConvs ?? []) {
          convMap.set(c.contact_id, c.id);
        }

        const missingCids = contactIds.filter((cid) => !convMap.has(cid));
        if (missingCids.length > 0) {
          const newConvs = missingCids.map((cid) => ({
            account_id: broadcast.account_id,
            user_id: broadcast.user_id,
            contact_id: cid,
            status: 'open',
          }));
          const { data: createdConvs } = await admin
            .from('conversations')
            .insert(newConvs)
            .select('id, contact_id');

          for (const c of createdConvs ?? []) {
            convMap.set(c.contact_id, c.id);
          }
        }
      }

      let failedCount = 0;
      const variables = (broadcast.template_variables as Record<string, { type: string; value: string }>) ?? {};

      for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
        const batch = recipients.slice(i, i + SEND_BATCH_SIZE);
        const messageInserts: {
          conversation_id: string;
          sender_type: 'agent';
          content_type: 'template';
          content_text: string;
          template_name: string;
          message_id: string;
          status: 'sent';
        }[] = [];
        const convUpdates: { id: string; last_message_text: string; last_message_at: string }[] = [];

        for (const recipient of batch) {
          const rawPhone = recipient.contact?.phone;
          if (!rawPhone) {
            failedCount++;
            await admin
              .from('broadcast_recipients')
              .update({ status: 'failed', error_message: 'No phone number on contact' })
              .eq('id', recipient.id);
            continue;
          }

          const sanitized = sanitizePhoneForMeta(rawPhone);
          if (!isValidE164(sanitized)) {
            failedCount++;
            await admin
              .from('broadcast_recipients')
              .update({ status: 'failed', error_message: 'Invalid phone number format' })
              .eq('id', recipient.id);
            continue;
          }

          // Resolve variables for this recipient
          const keys = Object.keys(variables).sort((a, b) => Number(a) - Number(b));
          const params = keys.map((k) => {
            const v = variables[k];
            if (v?.type === 'field' && recipient.contact) {
              const fieldMap: Record<string, string | undefined> = {
                name: recipient.contact.name,
                phone: recipient.contact.phone,
                email: recipient.contact.email,
                company: recipient.contact.company,
              };
              return fieldMap[v.value] || '';
            }
            return v?.value || '';
          });

          const variants = phoneVariants(sanitized);
          let sentMessageId: string | null = null;
          let lastError: string | null = null;

          for (const variant of variants) {
            try {
              const result = await sendTemplateMessage({
                phoneNumberId: config.phone_number_id,
                accessToken,
                to: variant,
                templateName: broadcast.template_name,
                language: broadcast.template_language || 'en_US',
                template: templateRow ?? undefined,
                params,
              });
              sentMessageId = result.messageId;
              lastError = null;
              break;
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : 'Unknown error';
              if (!isRecipientNotAllowedError(errMsg)) {
                lastError = errMsg;
                break;
              }
              lastError = errMsg;
            }
          }

          if (sentMessageId) {
            await admin
              .from('broadcast_recipients')
              .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                whatsapp_message_id: sentMessageId,
                error_message: null,
              })
              .eq('id', recipient.id);

            // Inbox Chat Sync
            const convId = recipient.contact ? convMap.get(recipient.contact.id) : null;
            if (convId) {
              const rendered = renderTemplateBody(templateBody, params);
              messageInserts.push({
                conversation_id: convId,
                sender_type: 'agent',
                content_type: 'template',
                content_text: rendered,
                template_name: broadcast.template_name,
                message_id: sentMessageId,
                status: 'sent',
              });
              convUpdates.push({
                id: convId,
                last_message_text: rendered,
                last_message_at: new Date().toISOString(),
              });
            }
          } else {
            failedCount++;
            await admin
              .from('broadcast_recipients')
              .update({
                status: 'failed',
                error_message: lastError || 'Unknown error',
              })
              .eq('id', recipient.id);
          }
        }

        if (messageInserts.length > 0) {
          await admin.from('messages').insert(messageInserts);
          for (const cu of convUpdates) {
            await admin
              .from('conversations')
              .update({
                last_message_text: cu.last_message_text,
                last_message_at: cu.last_message_at,
                updated_at: cu.last_message_at,
              })
              .eq('id', cu.id);
          }
        }

        if (i + SEND_BATCH_SIZE < recipients.length) {
          await sleep(SEND_BATCH_DELAY_MS);
        }
      }

      const finalStatus = failedCount === recipients.length ? 'failed' : 'sent';
      await admin
        .from('broadcasts')
        .update({ status: finalStatus, updated_at: new Date().toISOString() })
        .eq('id', broadcast.id);

      processedCount++;
    } catch (broadcastErr) {
      console.error(`Error processing scheduled broadcast ${broadcast.id}:`, broadcastErr);
      await admin
        .from('broadcasts')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', broadcast.id);
    }
  }

  return NextResponse.json({ success: true, processed: processedCount });
}
