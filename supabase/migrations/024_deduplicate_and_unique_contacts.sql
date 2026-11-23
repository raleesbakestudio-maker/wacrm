-- Migration 024: Enforce UNIQUE contact phone per account and UNIQUE conversation per contact

-- 1. Unique index on contacts (account_id, clean phone digits)
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_phone_clean
  ON contacts (account_id, regexp_replace(phone, '\D', '', 'g'));

-- 2. Unique index on conversations (account_id, contact_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact
  ON conversations (account_id, contact_id);
