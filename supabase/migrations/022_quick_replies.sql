-- ============================================================
-- 022_quick_replies.sql
--
-- Adds support for Quick Replies & Smart Bot responses:
--   - Shortcuts triggered in inbox via '/' (e.g. /welcome, /starter, /payment)
--   - Rich media attachments: Voice notes (audio), PDF brochures (document), QR codes (image)
--   - Auto-keywords for incoming WhatsApp messages (e.g. '1', 'starter')
--   - Account-level multi-tenancy with RLS
-- ============================================================

CREATE TABLE IF NOT EXISTS quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  shortcut TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT DEFAULT 'none' CHECK (media_type IN ('none', 'image', 'document', 'audio', 'video')),
  media_filename TEXT,
  auto_keywords TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_quick_replies_account_id ON quick_replies(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quick_replies_account_shortcut ON quick_replies(account_id, lower(shortcut));

-- RLS
ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quick_replies_select ON quick_replies;
CREATE POLICY quick_replies_select ON quick_replies FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS quick_replies_insert ON quick_replies;
CREATE POLICY quick_replies_insert ON quick_replies FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS quick_replies_update ON quick_replies;
CREATE POLICY quick_replies_update ON quick_replies FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS quick_replies_delete ON quick_replies;
CREATE POLICY quick_replies_delete ON quick_replies FOR DELETE USING (is_account_member(account_id, 'agent'));

-- 2. Update flow-media storage bucket allowed_mime_types to support voice audio notes
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/png', 'image/jpeg', 'image/webp',
  'video/mp4', 'video/3gpp',
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/wav', 'audio/x-m4a'
]
WHERE id = 'flow-media';
