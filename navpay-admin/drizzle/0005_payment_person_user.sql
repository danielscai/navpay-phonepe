ALTER TABLE `payment_persons` ADD COLUMN `user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_persons_user_ux` ON `payment_persons` (`user_id`);--> statement-breakpoint
