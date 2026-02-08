CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`meta_json` text,
	`ip` text,
	`user_agent` text,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at_ms`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_user_id`);--> statement-breakpoint
CREATE TABLE `callback_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`request_body` text NOT NULL,
	`response_code` integer,
	`response_body` text,
	`duration_ms` integer,
	`error` text,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `callback_attempts_task_idx` ON `callback_attempts` (`task_id`);--> statement-breakpoint
CREATE TABLE `callback_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`order_type` text NOT NULL,
	`order_id` text NOT NULL,
	`url` text NOT NULL,
	`payload_json` text NOT NULL,
	`signature` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`next_attempt_at_ms` integer NOT NULL,
	`last_error` text,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `callback_tasks_status_idx` ON `callback_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `callback_tasks_next_idx` ON `callback_tasks` (`next_attempt_at_ms`);--> statement-breakpoint
CREATE TABLE `collect_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`merchant_order_no` text NOT NULL,
	`amount` text NOT NULL,
	`fee` text DEFAULT '0' NOT NULL,
	`status` text NOT NULL,
	`notify_url` text NOT NULL,
	`remark` text,
	`channel_type` text DEFAULT 'h5' NOT NULL,
	`payment_app_id` text,
	`h5_site_id` text,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `collect_orders_merchant_idx` ON `collect_orders` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `collect_orders_status_idx` ON `collect_orders` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `collect_orders_merchant_order_ux` ON `collect_orders` (`merchant_id`,`merchant_order_no`);--> statement-breakpoint
CREATE TABLE `h5_sites` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `h5_sites_merchant_idx` ON `h5_sites` (`merchant_id`);--> statement-breakpoint
CREATE TABLE `ip_whitelist` (
	`id` text PRIMARY KEY NOT NULL,
	`ip` text NOT NULL,
	`note` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ip_whitelist_ip_ux` ON `ip_whitelist` (`ip`);--> statement-breakpoint
CREATE INDEX `ip_whitelist_enabled_idx` ON `ip_whitelist` (`enabled`);--> statement-breakpoint
CREATE TABLE `merchant_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`key_id` text NOT NULL,
	`secret_enc` text NOT NULL,
	`secret_hash` text NOT NULL,
	`secret_prefix` text NOT NULL,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`revoked_at_ms` integer
);
--> statement-breakpoint
CREATE INDEX `merchant_api_keys_merchant_idx` ON `merchant_api_keys` (`merchant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_api_keys_key_id_ux` ON `merchant_api_keys` (`key_id`);--> statement-breakpoint
CREATE TABLE `merchant_fees` (
	`merchant_id` text PRIMARY KEY NOT NULL,
	`collect_fee_rate_bps` integer DEFAULT 300 NOT NULL,
	`payout_fee_rate_bps` integer DEFAULT 450 NOT NULL,
	`min_fee` text DEFAULT '0' NOT NULL,
	`updated_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `merchant_limit_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`type` text NOT NULL,
	`min_amount` text DEFAULT '0' NOT NULL,
	`max_amount` text DEFAULT '0' NOT NULL,
	`daily_count_limit` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`note` text,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `merchant_limit_rules_merchant_idx` ON `merchant_limit_rules` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `merchant_limit_rules_type_idx` ON `merchant_limit_rules` (`type`);--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`balance` text DEFAULT '0' NOT NULL,
	`payout_frozen` text DEFAULT '0' NOT NULL,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_code_ux` ON `merchants` (`code`);--> statement-breakpoint
CREATE INDEX `merchants_enabled_idx` ON `merchants` (`enabled`);--> statement-breakpoint
CREATE TABLE `payment_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`package_name` text NOT NULL,
	`version_code` integer DEFAULT 1 NOT NULL,
	`download_url` text NOT NULL,
	`promoted` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_apps_pkg_ux` ON `payment_apps` (`package_name`);--> statement-breakpoint
CREATE INDEX `payment_apps_enabled_idx` ON `payment_apps` (`enabled`);--> statement-breakpoint
CREATE TABLE `payout_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`merchant_order_no` text NOT NULL,
	`amount` text NOT NULL,
	`fee` text DEFAULT '0' NOT NULL,
	`status` text NOT NULL,
	`notify_url` text NOT NULL,
	`remark` text,
	`beneficiary_name` text NOT NULL,
	`bank_name` text,
	`account_no` text NOT NULL,
	`ifsc` text NOT NULL,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payout_orders_merchant_idx` ON `payout_orders` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `payout_orders_status_idx` ON `payout_orders` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `payout_orders_merchant_order_ux` ON `payout_orders` (`merchant_id`,`merchant_order_no`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_key_ux` ON `permissions` (`key`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_permissions_pk` ON `role_permissions` (`role_id`,`permission_id`);--> statement-breakpoint
CREATE INDEX `role_permissions_role_idx` ON `role_permissions` (`role_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_name_ux` ON `roles` (`name`);--> statement-breakpoint
CREATE TABLE `system_configs` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`updated_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usdt_deposits` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text,
	`chain` text DEFAULT 'BSC' NOT NULL,
	`tx_hash` text NOT NULL,
	`amount` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`confirmations` integer DEFAULT 0 NOT NULL,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usdt_deposits_tx_ux` ON `usdt_deposits` (`tx_hash`);--> statement-breakpoint
CREATE INDEX `usdt_deposits_status_idx` ON `usdt_deposits` (`status`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_roles_pk` ON `user_roles` (`user_id`,`role_id`);--> statement-breakpoint
CREATE INDEX `user_roles_user_idx` ON `user_roles` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_roles_role_idx` ON `user_roles` (`role_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`email` text,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_updated_at_ms` integer NOT NULL,
	`totp_enabled` integer DEFAULT false NOT NULL,
	`totp_secret_enc` text,
	`totp_backup_codes_hash_json` text,
	`totp_must_enroll` integer DEFAULT true NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`lock_until_ms` integer,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_ux` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_ux` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`receiver_id` text NOT NULL,
	`headers_json` text NOT NULL,
	`body` text NOT NULL,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_events_receiver_idx` ON `webhook_events` (`receiver_id`);--> statement-breakpoint
CREATE INDEX `webhook_events_created_idx` ON `webhook_events` (`created_at_ms`);--> statement-breakpoint
CREATE TABLE `webhook_receivers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_receivers_created_idx` ON `webhook_receivers` (`created_at_ms`);