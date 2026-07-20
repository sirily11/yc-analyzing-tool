CREATE TABLE `yc_companies` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`website` text,
	`batch` text NOT NULL,
	`year` integer NOT NULL,
	`industry` text NOT NULL,
	`subindustry` text NOT NULL,
	`one_liner` text NOT NULL,
	`long_description` text NOT NULL,
	`tags` text NOT NULL,
	`location` text NOT NULL,
	`operating_area` text NOT NULL,
	`target_market` text NOT NULL,
	`ai_linked` integer NOT NULL,
	`hiring` integer NOT NULL,
	`logo` text,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`search_text` text NOT NULL,
	`source_hash` text NOT NULL,
	`embedding_model` text NOT NULL,
	`embedding` F32_BLOB(1536) NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "yc_companies_embedding_shape_check" CHECK(typeof("embedding") = 'blob' AND length("embedding") = 6144)
);
--> statement-breakpoint
CREATE INDEX `yc_companies_slug_idx` ON `yc_companies` (`slug`);--> statement-breakpoint
CREATE INDEX `yc_companies_year_idx` ON `yc_companies` (`year`);--> statement-breakpoint
CREATE INDEX `yc_companies_batch_idx` ON `yc_companies` (`batch`);--> statement-breakpoint
CREATE INDEX `yc_companies_industry_idx` ON `yc_companies` (`industry`);--> statement-breakpoint
CREATE INDEX `yc_companies_target_market_idx` ON `yc_companies` (`target_market`);--> statement-breakpoint
CREATE INDEX `yc_companies_operating_area_idx` ON `yc_companies` (`operating_area`);--> statement-breakpoint
CREATE INDEX `yc_companies_ai_linked_idx` ON `yc_companies` (`ai_linked`);--> statement-breakpoint
CREATE INDEX `yc_companies_hiring_idx` ON `yc_companies` (`hiring`);--> statement-breakpoint
CREATE INDEX `yc_companies_embedding_model_idx` ON `yc_companies` (`embedding_model`);--> statement-breakpoint
CREATE TABLE `yc_dataset_manifest` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`source` text NOT NULL,
	`generated_at` text NOT NULL,
	`first_year` integer NOT NULL,
	`last_year` integer NOT NULL,
	`company_count` integer NOT NULL,
	`batches` text NOT NULL,
	`industries` text NOT NULL,
	`embedding_model` text NOT NULL,
	`embedding_dimensions` integer NOT NULL,
	`updated_at` integer NOT NULL
);
