-- Ops-facing Payment App management fields
-- - icon_url: optional CDN URL for display
-- - min_supported_version_code: minimum supported version
-- - payout_enabled / collect_enabled: allow ops to toggle flows independently

ALTER TABLE payment_apps ADD COLUMN icon_url text;
ALTER TABLE payment_apps ADD COLUMN min_supported_version_code integer NOT NULL DEFAULT 0;
ALTER TABLE payment_apps ADD COLUMN payout_enabled integer NOT NULL DEFAULT 1;
ALTER TABLE payment_apps ADD COLUMN collect_enabled integer NOT NULL DEFAULT 1;

