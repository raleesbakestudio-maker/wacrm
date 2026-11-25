-- Migration 027: Track Meta WhatsApp pricing category & billable flag from status webhooks
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS pricing_category TEXT,
  ADD COLUMN IF NOT EXISTS is_billable BOOLEAN;

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS pricing_category TEXT,
  ADD COLUMN IF NOT EXISTS is_billable BOOLEAN;
