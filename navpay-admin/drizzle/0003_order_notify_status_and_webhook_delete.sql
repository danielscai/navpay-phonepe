ALTER TABLE `collect_orders` ADD COLUMN `notify_status` text DEFAULT 'PENDING' NOT NULL;
ALTER TABLE `collect_orders` ADD COLUMN `last_notified_at_ms` integer;

ALTER TABLE `payout_orders` ADD COLUMN `notify_status` text DEFAULT 'PENDING' NOT NULL;
ALTER TABLE `payout_orders` ADD COLUMN `last_notified_at_ms` integer;

