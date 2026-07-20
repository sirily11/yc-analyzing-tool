CREATE TABLE `yc_semantic_search_rate_limits` (
	`client_key` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`request_count` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `yc_semantic_search_rate_limits_updated_idx` ON `yc_semantic_search_rate_limits` (`updated_at`);