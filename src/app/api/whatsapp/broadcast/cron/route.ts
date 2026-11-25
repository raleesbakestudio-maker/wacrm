import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  sanitizePhoneForMeta,
  phoneVariants,
  isRecipientNotAllowedError,
  isValidE164,
} from '@/lib/whatsapp/phone-utils';
import { renderTemplateBody } from '@/lib/whatsapp/template-render';

const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;
const TIME_BUDGET_MS = 45_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const maxDuration = 60;

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}

async function handleCron(request?: Request) {
  const startTime = Date.now();
  // CRON_SECRET or BROADCAST_CRON_SECRET or AUTOMATION_CRON_SECRET or authenticated user session
  const expectedSecret = process.env.CRON_SECRET || process.env.BROADCAST_CRON_SECRET || process.env.AUTOMATION_CRON_SECRET;
  let authorized = false;

  if (expectedSecret && request) {
    const authHeader = request.headers.get('authorization');
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const customHeader = request.headers.get('x-cron-secret');
    const supplied = bearer || customHeader;

    if (supplied === expectedSecret) {
      authorized = true;
    }
  }

  // If secret not supplied or didn't match, check if caller is an authenticated user session (e.g. dashboard trigger)
  if (!authorized) {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        authorized = true;
      }
    } catch {
      // ignore
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized: Invalid cron secret or unauthenticated' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const now = new Date().toISOString();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // Find due scheduled broadcasts, or broadcasts stalled in 'sending' for > 5 minutes
  const { data: dueBroadcasts, error } = await admin
    .from('broadcasts')
    .select('*')
    .or(`and(status.eq.scheduled,scheduled_at.lte.${now}),and(status.eq.sending,updated_at.lte.${fiveMinAgo})`)
    .order('created_at', { ascending: true })
    .limit(5);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!dueBroadcasts || dueBroadcasts.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let processedCount = 0;

  for (const broadcast of dueBroadcasts) {
    // Atomically claim the broadcast (must still be scheduled, or stale in sending)
    const { data: claimed } = await admin
      .from('broadcasts')
      .update({ status: 'sending', updated_at: now })
      .eq('id', broadcast.id)
      .or(`status.eq.scheduled,and(status.eq.sending,updated_at.lte.${fiveMinAgo})`)
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

      // Pre-resolve existing conversations for Inbox Chat Sync (new ones created only upon successful send)
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
      }

      // Pre-resolve opted-out contacts to prevent sending broadcasts to opted-out contacts
      let optedOutContactIds = new Set<string>();
      if (broadcast.account_id && contactIds.length > 0) {
        const { data: optedOutTags } = await admin
          .from('tags')
          .select('id')
          .eq('account_id', broadcast.account_id)
          .ilike('name', '%opted out%');

        if (optedOutTags && optedOutTags.length > 0) {
          const tagIds = optedOutTags.map((t) => t.id);
          const { data: optedOutRows } = await admin
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', tagIds)
            .in('contact_id', contactIds);
          if (optedOutRows) {
            optedOutContactIds = new Set(optedOutRows.map((r) => r.contact_id));
          }
        }
      }

      let failedCount = 0;
      let timedOut = false;
      const variables = (broadcast.template_variables as Record<string, { type: string; value: string }>) ?? {};

      // Only process recipients that are still pending — never re-send to
      // sent, delivered, read, replied, or failed recipients.
      const pendingRecipients = recipients.filter((r) => r.status === 'pending');

      for (let i = 0; i < pendingRecipients.length; i += SEND_BATCH_SIZE) {
        if (Date.now() - startTime > TIME_BUDGET_MS) {
          timedOut = true;
          break;
        }

        const batch = pendingRecipients.slice(i, i + SEND_BATCH_SIZE);
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

        await Promise.all(
          batch.map(async (recipient) => {
            if (recipient.status !== 'pending') {
              return;
            }

            // If contact opted out, mark recipient failed/opted-out and skip sending
            if (recipient.contact?.id && optedOutContactIds.has(recipient.contact.id)) {
              failedCount++;
              await admin
                .from('broadcast_recipients')
                .update({ status: 'failed', error_message: 'Recipient opted out of broadcasts' })
                .eq('id', recipient.id);
              return;
            }

            try {
              const rawPhone = recipient.contact?.phone;
              if (!rawPhone) {
                failedCount++;
                await admin
                  .from('broadcast_recipients')
                  .update({ status: 'failed', error_message: 'No phone number on contact' })
                  .eq('id', recipient.id);
                return;
              }

              const sanitized = sanitizePhoneForMeta(rawPhone);
              if (!isValidE164(sanitized)) {
                failedCount++;
                await admin
                  .from('broadcast_recipients')
                  .update({ status: 'failed', error_message: 'Invalid phone number format' })
                  .eq('id', recipient.id);
                return;
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

                // Inbox Chat Sync (only for successfully delivered/sent messages)
                let convId = recipient.contact ? convMap.get(recipient.contact.id) : null;
                const rendered = renderTemplateBody(templateBody, params);

                if (!convId && recipient.contact && broadcast.account_id) {
                  const { data: createdConv } = await admin
                    .from('conversations')
                    .upsert(
                      {
                        account_id: broadcast.account_id,
                        user_id: broadcast.user_id,
                        contact_id: recipient.contact.id,
                        status: 'open',
                        last_message_text: rendered,
                        last_message_at: new Date().toISOString(),
                      },
                      { onConflict: 'account_id,contact_id' }
                    )
                    .select('id')
                    .maybeSingle();

                  if (createdConv?.id) {
                    convId = createdConv.id;
                    convMap.set(recipient.contact.id, createdConv.id);
                  }
                }

                if (convId) {
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
            } catch (recErr) {
              console.error(`Error sending broadcast to recipient ${recipient.id}:`, recErr);
              failedCount++;
              await admin
                .from('broadcast_recipients')
                .update({
                  status: 'failed',
                  error_message: recErr instanceof Error ? recErr.message : 'Send error',
                })
                .eq('id', recipient.id);
            }
          })
        );

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

        if (i + SEND_BATCH_SIZE < pendingRecipients.length) {
          await sleep(SEND_BATCH_DELAY_MS);
        }
      }

      if (timedOut) {
        // Leave status='sending' and bump updated_at so the cron resumes
        // remaining pending recipients cleanly on a subsequent run without
        // colliding with concurrent invocations.
        await admin
          .from('broadcasts')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', broadcast.id);
        processedCount++;
        continue;
      }

      // Check overall stats to set final broadcast status
      const { count: totalSent } = await admin
        .from('broadcast_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('broadcast_id', broadcast.id)
        .in('status', ['sent', 'delivered', 'read', 'replied']);

      const finalStatus = (totalSent ?? 0) > 0 ? 'sent' : 'failed';
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
