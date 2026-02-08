ALTER TABLE `users` ADD COLUMN `merchant_id` text;
--> statement-breakpoint
CREATE INDEX `users_merchant_idx` ON `users` (`merchant_id`);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD COLUMN `merchant_id` text;
--> statement-breakpoint
CREATE INDEX `audit_logs_merchant_idx` ON `audit_logs` (`merchant_id`);
--> statement-breakpoint
CREATE TABLE `merchant_ip_whitelist` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`ip` text NOT NULL,
	`note` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `merchant_ip_whitelist_merchant_idx` ON `merchant_ip_whitelist` (`merchant_id`);
--> statement-breakpoint
CREATE INDEX `merchant_ip_whitelist_enabled_idx` ON `merchant_ip_whitelist` (`enabled`);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_ip_whitelist_ux` ON `merchant_ip_whitelist` (`merchant_id`,`ip`);

