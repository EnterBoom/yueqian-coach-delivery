ALTER TABLE `cohorts` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `cohorts` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `cohorts` ADD `archived_by` text;