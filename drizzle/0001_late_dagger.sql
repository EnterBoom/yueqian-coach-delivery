DROP INDEX `idx_day_plans_phase_day`;--> statement-breakpoint
DROP INDEX `idx_day_plans_sort_order`;--> statement-breakpoint
ALTER TABLE `day_plans` ADD `cohort_id` integer NOT NULL REFERENCES cohorts(id);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_day_plans_cohort_phase_day` ON `day_plans` (`cohort_id`,`phase`,`day_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_day_plans_cohort_sort_order` ON `day_plans` (`cohort_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_day_plans_cohort_id` ON `day_plans` (`cohort_id`);--> statement-breakpoint
DROP INDEX `idx_groups_name`;--> statement-breakpoint
ALTER TABLE `groups` ADD `cohort_id` integer NOT NULL REFERENCES cohorts(id);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_groups_cohort_name` ON `groups` (`cohort_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_groups_cohort_id` ON `groups` (`cohort_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cohorts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`pre_start_date` text NOT NULL,
	`offline_start_date` text NOT NULL,
	`post_start_date` text NOT NULL,
	`initialized_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_cohorts`("id", "name", "pre_start_date", "offline_start_date", "post_start_date", "initialized_by", "created_at", "updated_at") SELECT "id", "name", "pre_start_date", "offline_start_date", "post_start_date", "initialized_by", "created_at", "updated_at" FROM `cohorts`;--> statement-breakpoint
DROP TABLE `cohorts`;--> statement-breakpoint
ALTER TABLE `__new_cohorts` RENAME TO `cohorts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;