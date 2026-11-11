CREATE TABLE IF NOT EXISTS `admission_cohort_codes` (
	`cohort_id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	FOREIGN KEY (`cohort_id`) REFERENCES `cohorts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_admission_cohort_codes_code` ON `admission_cohort_codes` (`code`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `admission_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`admission_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_admission_events_admission` ON `admission_events` (`admission_id`,`id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `admission_placements` (
	`admission_id` text NOT NULL,
	`cohort_id` integer NOT NULL,
	`learner_id` integer NOT NULL,
	PRIMARY KEY(`admission_id`, `cohort_id`),
	FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cohort_id`) REFERENCES `cohorts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_admission_placements_learner` ON `admission_placements` (`learner_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `admission_sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`lock_owner` text,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`last_success` text,
	`last_error` text DEFAULT '' NOT NULL,
	`pull_offset` integer DEFAULT 0 NOT NULL,
	`refund_offset` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "admission_sync_state_singleton" CHECK("admission_sync_state"."id"=1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `admissions` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` integer,
	`name` text NOT NULL,
	`nickname` text DEFAULT '' NOT NULL,
	`phone` text NOT NULL,
	`sales_name` text NOT NULL,
	`channel` text NOT NULL,
	`registered_on` text NOT NULL,
	`product` text NOT NULL,
	`price_cents` integer NOT NULL,
	`promise` text NOT NULL,
	`status` text DEFAULT '待安排' NOT NULL,
	`cohort_id` integer,
	`group_id` integer,
	`learner_id` integer,
	`original_cohort_id` integer,
	`intended_cohort` text DEFAULT '' NOT NULL,
	`follow_up_owner` text DEFAULT '' NOT NULL,
	`delivery_note` text DEFAULT '' NOT NULL,
	`source_json` text NOT NULL,
	`source_error` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`synced_version` integer DEFAULT 0 NOT NULL,
	`last_mutation` text,
	`return_json` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cohort_id`) REFERENCES `cohorts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`original_cohort_id`) REFERENCES `cohorts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `refund_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`admission_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`sales_name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`explanation` text NOT NULL,
	`attachments_json` text NOT NULL,
	`source_json` text NOT NULL,
	`source_error` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `student_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_student_profiles_identity` ON `student_profiles` (`name`,`phone`);
--> statement-breakpoint
INSERT OR IGNORE INTO admission_sync_state (id) VALUES (1);
