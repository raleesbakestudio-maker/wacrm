-- Migration 026: Add button_flows to broadcasts
-- Maps template quick-reply button text to flow_id for auto-triggering flows on button taps.
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS button_flows JSONB DEFAULT '{}'::jsonb;
