CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `cloud_browser` (
	`id` text PRIMARY KEY,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`browser_use_profile_id` text,
	`default_region` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_cloud_browser_org_id_org_id_fk` FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `cloud_session` (
	`id` text PRIMARY KEY,
	`cloud_browser_id` text NOT NULL,
	`browser_use_session_id` text,
	`cdp_url` text,
	`proxy_region` text,
	`block_media` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'creating' NOT NULL,
	`last_activity_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_cloud_session_cloud_browser_id_cloud_browser_id_fk` FOREIGN KEY (`cloud_browser_id`) REFERENCES `cloud_browser`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `device_code` (
	`id` text PRIMARY KEY,
	`device_code` text NOT NULL UNIQUE,
	`user_code` text NOT NULL UNIQUE,
	`user_id` text,
	`expires_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_polled_at` integer,
	`polling_interval` integer,
	`client_id` text,
	`scope` text,
	CONSTRAINT `fk_device_code_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `org` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`stripe_customer_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `org_member` (
	`id` text PRIMARY KEY,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_org_member_org_id_org_id_fk` FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_org_member_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`token` text NOT NULL UNIQUE,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `cloud_browser_org_id_idx` ON `cloud_browser` (`org_id`);--> statement-breakpoint
CREATE INDEX `cloud_session_cloud_browser_id_idx` ON `cloud_session` (`cloud_browser_id`);--> statement-breakpoint
CREATE INDEX `device_code_user_id_idx` ON `device_code` (`user_id`);--> statement-breakpoint
CREATE INDEX `org_member_org_id_idx` ON `org_member` (`org_id`);--> statement-breakpoint
CREATE INDEX `org_member_user_id_idx` ON `org_member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `org_member_org_id_user_id_unique` ON `org_member` (`org_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `org_member_user_id_unique` ON `org_member` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);