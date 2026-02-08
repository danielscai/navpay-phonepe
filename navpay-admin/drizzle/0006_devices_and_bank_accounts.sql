CREATE TABLE `payment_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`name` text NOT NULL,
	`online` integer DEFAULT 0 NOT NULL,
	`last_seen_at_ms` integer,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payment_devices_person_idx` ON `payment_devices` (`person_id`);--> statement-breakpoint
CREATE INDEX `payment_devices_online_idx` ON `payment_devices` (`online`);--> statement-breakpoint

CREATE TABLE `payment_device_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`payment_app_id` text NOT NULL,
	`version_code` integer DEFAULT 1 NOT NULL,
	`installed_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_device_apps_ux` ON `payment_device_apps` (`device_id`,`payment_app_id`);--> statement-breakpoint
CREATE INDEX `payment_device_apps_device_idx` ON `payment_device_apps` (`device_id`);--> statement-breakpoint

CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`bank_name` text NOT NULL,
	`alias` text NOT NULL,
	`account_last4` text NOT NULL,
	`ifsc` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bank_accounts_person_idx` ON `bank_accounts` (`person_id`);--> statement-breakpoint
CREATE INDEX `bank_accounts_enabled_idx` ON `bank_accounts` (`enabled`);--> statement-breakpoint

CREATE TABLE `bank_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`direction` text NOT NULL,
	`amount` text NOT NULL,
	`ref` text,
	`details_json` text,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bank_transactions_account_idx` ON `bank_transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `bank_transactions_created_idx` ON `bank_transactions` (`created_at_ms`);--> statement-breakpoint
