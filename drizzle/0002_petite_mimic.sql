CREATE TABLE `company_research_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`request` text NOT NULL,
	`company_ids` text NOT NULL,
	`document` text,
	`map_input` text,
	`map` text,
	`model_version` text NOT NULL,
	`dataset_version` text NOT NULL,
	`failure_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `company_research_reports_user_created_idx` ON `company_research_reports` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `company_research_reports_chat_created_idx` ON `company_research_reports` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `report_research_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`kind` text NOT NULL,
	`comparable_company_id` integer,
	`firecrawl_job_id` text NOT NULL,
	`status` text NOT NULL,
	`targets` text NOT NULL,
	`credits_used` integer DEFAULT 0 NOT NULL,
	`failure_code` text,
	`last_checked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_research_jobs_firecrawl_job_id_unique` ON `report_research_jobs` (`firecrawl_job_id`);--> statement-breakpoint
CREATE INDEX `report_research_jobs_report_idx` ON `report_research_jobs` (`report_id`);--> statement-breakpoint
CREATE INDEX `report_research_jobs_firecrawl_idx` ON `report_research_jobs` (`firecrawl_job_id`);--> statement-breakpoint
ALTER TABLE `reports` ADD `source_document_id` text;--> statement-breakpoint
ALTER TABLE `reports` ADD `report_model` text;--> statement-breakpoint
ALTER TABLE `reports` ADD `research_deadline_at` integer;