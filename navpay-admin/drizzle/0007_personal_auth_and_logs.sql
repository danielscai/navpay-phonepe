CREATE TABLE `personal_api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at_ms` integer,
	`revoked_at_ms` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_api_tokens_hash_ux` ON `personal_api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `personal_api_tokens_person_idx` ON `personal_api_tokens` (`person_id`);--> statement-breakpoint
CREATE INDEX `personal_api_tokens_revoked_idx` ON `personal_api_tokens` (`revoked_at_ms`);--> statement-breakpoint

CREATE TABLE `payment_person_login_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`event` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payment_person_login_logs_person_idx` ON `payment_person_login_logs` (`person_id`);--> statement-breakpoint
CREATE INDEX `payment_person_login_logs_created_idx` ON `payment_person_login_logs` (`created_at_ms`);--> statement-breakpoint

CREATE TABLE `payment_person_report_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`type` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`meta_json` text,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payment_person_report_logs_person_idx` ON `payment_person_report_logs` (`person_id`);--> statement-breakpoint
CREATE INDEX `payment_person_report_logs_created_idx` ON `payment_person_report_logs` (`created_at_ms`);--> statement-breakpoint
