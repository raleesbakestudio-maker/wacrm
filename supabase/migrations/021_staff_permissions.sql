-- ============================================================
-- 021_staff_permissions.sql — Staff feature permissions
--
-- Adds `allowed_features TEXT[] DEFAULT NULL` to `profiles`.
-- NULL = all features allowed (owner/admin default).
-- If set, restricts access to the specified feature keys:
--   'inbox', 'contacts', 'dashboard', 'broadcasts', 'automations', 'flows', 'settings'
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS allowed_features TEXT[]
    DEFAULT NULL;
