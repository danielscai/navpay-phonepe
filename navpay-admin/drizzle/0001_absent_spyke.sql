CREATE TABLE `webauthn_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports_json` text,
	`device_name` text,
	`created_at_ms` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at_ms` integer,
	`revoked_at_ms` integer
);
--> statement-breakpoint
CREATE INDEX `webauthn_credentials_user_idx` ON `webauthn_credentials` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `webauthn_credentials_credential_ux` ON `webauthn_credentials` (`credential_id`);--> statement-breakpoint
CREATE INDEX `webauthn_credentials_revoked_idx` ON `webauthn_credentials` (`revoked_at_ms`);