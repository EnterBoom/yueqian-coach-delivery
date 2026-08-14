CREATE TABLE `day_plan_publications` (
	`day_plan_id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`coach_action` text DEFAULT '' NOT NULL,
	`group_announcement` text DEFAULT '' NOT NULL,
	`materials` text DEFAULT '' NOT NULL,
	`learner_instructions` text DEFAULT '' NOT NULL,
	`reminder` text DEFAULT '' NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`deliverable` text DEFAULT '' NOT NULL,
	`acceptance` text DEFAULT '' NOT NULL,
	`due_date` text NOT NULL,
	`published_by` text NOT NULL,
	`published_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`day_plan_id`) REFERENCES `day_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `day_plans` ADD `coach_action` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `day_plans` ADD `group_announcement` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `day_plans` ADD `materials` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `day_plans` ADD `learner_instructions` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `day_plans` ADD `reminder` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `day_plans` ADD `has_unpublished_changes` integer DEFAULT false NOT NULL;