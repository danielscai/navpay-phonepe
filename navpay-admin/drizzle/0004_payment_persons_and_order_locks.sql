CREATE TABLE `payment_persons` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`balance` text DEFAULT '0.00' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_persons_name_ux` ON `payment_persons` (`name`);--> statement-breakpoint
CREATE INDEX `payment_persons_enabled_idx` ON `payment_persons` (`enabled`);--> statement-breakpoint

CREATE TABLE `payment_person_balance_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`delta` text NOT NULL,
	`balance_after` text NOT NULL,
	`reason` text NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payment_person_balance_logs_person_idx` ON `payment_person_balance_logs` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_person_balance_logs_ref_ux` ON `payment_person_balance_logs` (`person_id`,`ref_type`,`ref_id`);--> statement-breakpoint

ALTER TABLE `collect_orders` ADD COLUMN `assigned_payment_person_id` text;--> statement-breakpoint
ALTER TABLE `collect_orders` ADD COLUMN `assigned_at_ms` integer;--> statement-breakpoint
CREATE INDEX `collect_orders_assigned_person_idx` ON `collect_orders` (`assigned_payment_person_id`);--> statement-breakpoint

ALTER TABLE `payout_orders` ADD COLUMN `locked_payment_person_id` text;--> statement-breakpoint
ALTER TABLE `payout_orders` ADD COLUMN `lock_mode` text DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE `payout_orders` ADD COLUMN `locked_at_ms` integer;--> statement-breakpoint
ALTER TABLE `payout_orders` ADD COLUMN `lock_expires_at_ms` integer;--> statement-breakpoint
CREATE INDEX `payout_orders_locked_person_idx` ON `payout_orders` (`locked_payment_person_id`);--> statement-breakpoint
CREATE INDEX `payout_orders_lock_expires_idx` ON `payout_orders` (`lock_expires_at_ms`);--> statement-breakpoint
