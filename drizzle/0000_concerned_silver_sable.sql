CREATE TABLE `cohorts` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`pre_start_date` text NOT NULL,
	`offline_start_date` text NOT NULL,
	`post_start_date` text NOT NULL,
	`initialized_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `day_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phase` text NOT NULL,
	`day_number` integer NOT NULL,
	`label` text NOT NULL,
	`title` text NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`deliverable` text DEFAULT '' NOT NULL,
	`acceptance` text DEFAULT '' NOT NULL,
	`due_date` text NOT NULL,
	`sort_order` integer NOT NULL,
	`configured` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_day_plans_phase_day` ON `day_plans` (`phase`,`day_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_day_plans_sort_order` ON `day_plans` (`sort_order`);--> statement-breakpoint
CREATE TABLE `exception_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exception_id` integer NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`exception_id`) REFERENCES `exceptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_exception_events_exception_id` ON `exception_events` (`exception_id`);--> statement-breakpoint
CREATE TABLE `exceptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`learner_id` integer,
	`group_id` integer NOT NULL,
	`day_plan_id` integer,
	`created_by` text NOT NULL,
	`problem` text NOT NULL,
	`request` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text DEFAULT '' NOT NULL,
	`handled_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`day_plan_id`) REFERENCES `day_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_exceptions_group_status` ON `exceptions` (`group_id`,`status`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`coach_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_groups_name` ON `groups` (`name`);--> statement-breakpoint
CREATE INDEX `idx_groups_coach_email` ON `groups` (`coach_email`);--> statement-breakpoint
CREATE TABLE `learners` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`group_id` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_learners_group_name` ON `learners` (`group_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_learners_group_id` ON `learners` (`group_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`email` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_members_user_id` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`learner_id` integer NOT NULL,
	`day_plan_id` integer NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`evidence_url` text DEFAULT '' NOT NULL,
	`evidence_note` text DEFAULT '' NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`day_plan_id`) REFERENCES `day_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_progress_learner_day` ON `progress` (`learner_id`,`day_plan_id`);--> statement-breakpoint
CREATE INDEX `idx_progress_day_status` ON `progress` (`day_plan_id`,`status`);