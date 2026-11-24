-- Migration 025: Performance indexes for dashboard, conversations, and broadcasts
-- Created to speed up messages time-range queries and scheduled broadcast sweeps

CREATE INDEX IF NOT EXISTS idx_messages_created_at_sender
  ON messages(created_at, sender_type);

CREATE INDEX IF NOT EXISTS idx_broadcasts_status_scheduled
  ON broadcasts(status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON messages(conversation_id, created_at);
